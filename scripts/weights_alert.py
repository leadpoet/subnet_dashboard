#!/usr/bin/env python3
"""SN71 missed-weight alerting on the official stateful subnet epoch.

Runs from cron on the validator box (deployed copy:
/home/ec2-user/weights_alert.py, executed with the box's alert venv).
Checks the primary validator and the audit validators against the official
subnet epoch authority — ``SubnetEpochIndex`` anchored by ``LastEpochBlock``
with the on-chain ``Tempo`` — the same authority the dashboard uses, NOT the
legacy ``block // 360`` bucket. A validator is stale when its ``last_update``
is more than one full tempo (plus a submission grace) behind the chain head.

Posts one combined message to the Discord webhook for each newly observed
validator problem. Persistent problems are deduped in STATE_FILE until they
recover; crossing an epoch boundary alone never re-pages the same incident.
Webhook URL lives in WEBHOOK_FILE (one line); empty/missing file = log-only
mode.

Usage: weights_alert.py [--test]   (--test posts a labeled test message)
"""

import json
import os
import sys
import time
import urllib.request

# Watched validators are pinned to reviewed hotkey/coldkey pairs in
# validator_registry.json, shared with the dashboard UI. UIDs and on-chain
# display names resolve live, but a display name is used only while the
# current coldkey matches the expected coldkey. A key rotation remains a
# deliberate reviewed registry edit.
REGISTRY_ENV = "WEIGHTS_ALERT_REGISTRY"
REGISTRY_CANDIDATES = (
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "validator_registry.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "validator_registry.json"),
    os.path.expanduser("~/validator_registry.json"),
)


def load_registry() -> list:
    paths = [os.environ.get(REGISTRY_ENV, "")] if os.environ.get(REGISTRY_ENV) else []
    paths.extend(REGISTRY_CANDIDATES)
    for candidate in paths:
        try:
            with open(candidate) as handle:
                doc = json.load(handle)
            validators = doc.get("validators")
            if isinstance(validators, list) and validators:
                return validators
        except Exception:
            continue
    return []


def safe_identity_name(value) -> str:
    """Return a bounded, single-line identity name safe for Discord text."""
    name = " ".join(str(value or "").split())
    # Prevent an on-chain display name from creating a Discord mention.
    return name[:80].replace("@", "@\u200b")


def query_identity_name(subtensor, coldkey: str) -> str:
    """Best-effort on-chain name lookup with a static-label fallback."""
    if not coldkey:
        return ""
    try:
        query_identity = getattr(subtensor, "query_identity", None)
        if not callable(query_identity):
            return ""
        identity = query_identity(coldkey)
        if isinstance(identity, dict):
            return safe_identity_name(identity.get("name"))
        return safe_identity_name(getattr(identity, "name", ""))
    except Exception:
        return ""


def display_label(role: str, fallback_label: str, identity_name: str) -> str:
    role = " ".join(str(role or "").split())[:32]
    return f"{role} ({identity_name})" if role and identity_name else fallback_label


NETUID = 71
# A validator that submits every epoch is at most tempo + a few submission
# blocks behind the head. The grace mirrors the dashboard's weights watch.
SUBMISSION_GRACE_BLOCKS = 20
WEBHOOK_FILE = os.path.expanduser("~/.config/leadpoet/weights_alert_webhook")
STATE_FILE = os.path.expanduser("~/.config/leadpoet/weights_alert_state.json")
LOG_FILE = os.path.expanduser("~/weights_alert.log")


def log(msg: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(LOG_FILE, "a") as handle:
        handle.write(f"{stamp} {msg}\n")


def load_state() -> dict:
    try:
        with open(STATE_FILE) as handle:
            return json.load(handle)
    except Exception:
        return {}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as handle:
        json.dump(state, handle)
    os.replace(tmp, STATE_FILE)


def update_incident_state(
    state: dict, validator_id: str, incident_keys: list
) -> bool:
    """Record active incidents and return whether any incident is newly active.

    Incident keys contain stable evidence, never the current epoch or changing
    block age. For example, a stale-weight incident is anchored to the
    validator's unchanged last-set block, so it survives an epoch boundary
    without paging twice.

    The previous state format stored an integer epoch per validator. Treat that
    as an already-alerted condition on the first upgraded pass and replace it
    with the current incident keys, avoiding a deployment-time replay.
    """
    current = sorted(set(incident_keys))
    previous = state.get(validator_id)
    if not current:
        state.pop(validator_id, None)
        return False

    if isinstance(previous, list):
        previous_keys = {key for key in previous if isinstance(key, str)}
        should_alert = bool(set(current) - previous_keys)
    elif isinstance(previous, int) and not isinstance(previous, bool):
        should_alert = False
    else:
        should_alert = True

    state[validator_id] = current
    return should_alert


def webhook_url() -> str:
    try:
        with open(WEBHOOK_FILE) as handle:
            return handle.read().strip()
    except Exception:
        return ""


def post_discord(content: str) -> bool:
    url = webhook_url()
    if not url:
        log(f"log-only (no webhook): {content!r}")
        return False
    body = json.dumps({"content": content}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        # Discord's edge rejects the default Python-urllib user agent (403),
        # so identify as the monitor explicitly.
        headers={
            "Content-Type": "application/json",
            "User-Agent": "leadpoet-sn71-weights-watch/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return 200 <= response.status < 300
    except Exception as exc:
        # A dead webhook must not crash the pass: alert state still saves so
        # a later repaired webhook does not replay every old miss at once.
        log(f"discord post failed: {exc}")
        return False


def _scale(value):
    inner = getattr(value, "value", value)
    return int(inner or 0)


def official_epoch_state(subtensor):
    """(subnet_epoch_index, last_epoch_block, tempo, block) at one block hash.

    Every storage field is read at the same block hash so the snapshot is
    coherent, matching the dashboard's official epoch authority.
    """
    substrate = subtensor.substrate
    block_hash = substrate.get_chain_head()
    block = _scale(
        substrate.query(
            module="System", storage_function="Number", block_hash=block_hash
        )
    )
    fields = {}
    for name in ("SubnetEpochIndex", "LastEpochBlock", "Tempo"):
        fields[name] = _scale(
            substrate.query(
                module="SubtensorModule",
                storage_function=name,
                params=[NETUID],
                block_hash=block_hash,
            )
        )
    return fields["SubnetEpochIndex"], fields["LastEpochBlock"], fields["Tempo"], block


def main() -> int:
    if "--test" in sys.argv:
        sent = post_discord(
            "✅ SN71 weights watch: test message (official-epoch alerting is wired up)"
        )
        print("test message sent" if sent else "log-only (no webhook configured)")
        return 0

    try:
        import bittensor as bt

        st = bt.Subtensor(network="finney")
        epoch_index, last_epoch_block, tempo, block = official_epoch_state(st)
        mg = st.metagraph(NETUID)
    except Exception as exc:
        # A flaky chain endpoint must not produce false pages; the next cron
        # run retries in five minutes.
        log(f"chain query failed (skipping this pass): {exc}")
        return 0

    if tempo <= 0:
        log(f"invalid tempo {tempo} (skipping this pass)")
        return 0

    validators = load_registry()
    if not validators:
        log("no validator registry found (skipping this pass)")
        return 0

    state = load_state()
    stale_blocks = tempo + SUBMISSION_GRACE_BLOCKS
    hotkeys = list(mg.hotkeys)
    hotkey_to_uid = {hk: i for i, hk in enumerate(hotkeys)}
    misses = []
    for validator in validators:
        vid = str(validator.get("id") or validator.get("hotkey") or "")[:64]
        fallback_label = str(validator.get("label") or vid)
        role = str(validator.get("role") or "")
        hotkey = str(validator.get("hotkey") or "")
        expected_coldkey = str(validator.get("expectedColdkey") or "")
        if not vid or not hotkey:
            continue
        problems = []
        incident_keys = []
        uid = hotkey_to_uid.get(hotkey)
        last_set_block = None
        blocks_since = None
        if uid is None:
            problems.append("hotkey no longer registered")
            incident_keys.append("hotkey_not_registered")
        else:
            coldkey = str(mg.coldkeys[uid])
            coldkey_mismatch = bool(expected_coldkey and coldkey != expected_coldkey)
            coldkey_verified = bool(expected_coldkey and coldkey == expected_coldkey)
            if coldkey_mismatch:
                problems.append("unexpected coldkey")
                incident_keys.append("unexpected_coldkey")
            identity_name = (
                query_identity_name(st, coldkey) if coldkey_verified else ""
            )
            label = display_label(role, fallback_label, identity_name)
            if not bool(mg.validator_permit[uid]):
                problems.append("validator permit lost")
                incident_keys.append("validator_permit_lost")
            if not bool(mg.active[uid]):
                problems.append("validator inactive")
                incident_keys.append("validator_inactive")
            last_set_block = int(mg.last_update[uid])
            blocks_since = block - last_set_block
            if blocks_since > stale_blocks:
                problems.append(
                    f"weight update stale ({blocks_since} blocks since last set)"
                )
                incident_keys.append(f"weight_update_stale:{last_set_block}")
        if uid is None:
            label = fallback_label
        # Deduplicate by stable validator identity and incident evidence, never
        # by epoch or UID. Resolved incidents are removed from state so a later
        # recurrence can alert again.
        if update_incident_state(state, vid, incident_keys):
            misses.append((vid, label, uid, last_set_block, blocks_since, problems))

    if misses:
        epoch_block = max(0, block - last_epoch_block)
        lines = [
            f"🚨 **SN71 missed weight set** "
            f"(official epoch {epoch_index}, block {epoch_block}/{tempo} into it)"
        ]
        for vid, label, uid, last_set_block, behind, problems in misses:
            uid_text = f"current UID {uid}" if uid is not None else "not registered"
            set_text = (
                f", last set {behind} blocks ago" if behind is not None else ""
            )
            lines.append(f"• {label} · {uid_text}{set_text}: " + "; ".join(problems))
        if any(vid == "leadpoet-primary" for vid, *_ in misses):
            lines.append(
                "Primary miss ⇒ auditors have no bundle to copy; check gateway "
                "/weights/submit responses and the validator log."
            )
        post_discord("\n".join(lines))
        log(f"ALERTED: {[(m[0], m[5]) for m in misses]}")
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
