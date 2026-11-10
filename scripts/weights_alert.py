#!/usr/bin/env python3
"""SN71 missed-weight alerting on the official stateful subnet epoch.

Runs from cron on the validator box (deployed copy:
/home/ec2-user/weights_alert.py, executed with the box's alert venv).
Checks the primary validator and the audit validators against the official
subnet epoch authority — ``SubnetEpochIndex`` anchored by ``LastEpochBlock``
with the on-chain ``Tempo`` — the same authority the dashboard uses, NOT the
legacy ``block // 360`` bucket. A validator is stale when its ``last_update``
predates the start of the most recently completed official epoch. The worker
waits for the epoch boundary before deciding that the epoch was missed.

Posts one combined message when a problem is first observed, then one reminder
for every newly completed official epoch until it recovers. Notification state
advances only after the configured webhook confirms delivery, so webhook
failures remain eligible for retry. Late problems discovered after an epoch's
combined message can still page without re-sending incidents already delivered
in that epoch.
Webhook URL lives in WEBHOOK_FILE (one line); empty/missing file = retryable
delivery failure.

Usage: weights_alert.py [--test]   (--test posts a labeled test message)
"""

import json
import os
import re
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit
from typing import Optional

# Watched validators are pinned to reviewed hotkey/coldkey pairs in
# validator_registry.json, shared with the dashboard UI. UIDs and on-chain
# display names resolve live, but a display name is used only while the
# current coldkey matches the expected coldkey. A key rotation remains a
# deliberate reviewed registry edit. Registry entries absent from the live
# metagraph are not eligible for alerting.
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
    """Return a bounded, single-line identity name safe for chat text."""
    name = " ".join(str(value or "").split())
    # Prevent an on-chain display name from creating a mention or link in
    # either supported webhook provider.
    name = name[:80]
    name = name.replace("@", "@\u200b").replace("<", "‹").replace(">", "›")
    name = re.sub(
        r"(?i)https?://",
        lambda match: match.group(0).replace("://", "\u200b://"),
        name,
    )
    name = re.sub(
        r"(?i)www\.",
        lambda match: f"{match.group(0)[0]}\u200b{match.group(0)[1:]}",
        name,
    )
    return name


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
WEBHOOK_FILE = os.path.expanduser("~/.config/leadpoet/weights_alert_webhook")
WEBHOOK_ENV = "WEIGHTS_ALERT_WEBHOOK"
WEBHOOK_ROLLBACK_FILE = WEBHOOK_FILE + ".before-slack"
STATE_FILE = os.path.expanduser("~/.config/leadpoet/weights_alert_state.json")
LOG_FILE = os.path.expanduser("~/weights_alert.log")
LAST_ALERT_EPOCH_KEY = "__last_alert_epoch__"
EPOCH_OBSERVATION_KEY = "__epoch_observation__"
INCIDENT_DELIVERY_EPOCHS_KEY = "__incident_delivery_epochs__"
HEARTBEAT_KEY = "__heartbeat__"
STATE_SCHEMA_VERSION_KEY = "__schema_version__"
STATE_SCHEMA_VERSION = 2


def log(msg: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(LOG_FILE, "a") as handle:
        handle.write(f"{stamp} {msg}\n")


def load_state() -> dict:
    try:
        with open(STATE_FILE) as handle:
            state = json.load(handle)
        return state if isinstance(state, dict) else {}
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
    validator's unchanged last-set block. The delivery-state layer separately
    decides whether that active incident needs an epoch reminder.

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


def claim_epoch_alert(state: dict, epoch_index: int, delivery_succeeded: bool) -> bool:
    """Record a successful epoch delivery for legacy state compatibility.

    Per-incident delivery epochs decide whether a message is due. This global
    marker remains in the state file so older deployed copies can read the
    upgraded state without replaying the latest successful notification.
    """
    if not delivery_succeeded or state.get(LAST_ALERT_EPOCH_KEY) == epoch_index:
        return False
    state[LAST_ALERT_EPOCH_KEY] = epoch_index
    return True


def incident_delivery_epochs(state: dict) -> dict:
    """Return sanitized per-incident successful-delivery epochs.

    State written before schema v2 only had active incident keys and one global
    last-alert epoch. Seed those active keys with the legacy epoch so deploying
    this version does not immediately replay a message already delivered in the
    same completed epoch.
    """
    raw = state.get(INCIDENT_DELIVERY_EPOCHS_KEY)
    deliveries = {}
    if isinstance(raw, dict):
        for validator_id, incident_epochs in raw.items():
            if not isinstance(validator_id, str) or not isinstance(incident_epochs, dict):
                continue
            valid = {
                key: epoch
                for key, epoch in incident_epochs.items()
                if (
                    isinstance(key, str)
                    and isinstance(epoch, int)
                    and not isinstance(epoch, bool)
                )
            }
            if valid:
                deliveries[validator_id] = valid
    else:
        legacy_epoch = state.get(LAST_ALERT_EPOCH_KEY)
        if isinstance(legacy_epoch, int) and not isinstance(legacy_epoch, bool):
            for validator_id, incident_keys in state.items():
                if not isinstance(validator_id, str) or validator_id.startswith("__"):
                    continue
                if isinstance(incident_keys, list):
                    valid_keys = [key for key in incident_keys if isinstance(key, str)]
                    if valid_keys:
                        deliveries[validator_id] = {
                            key: legacy_epoch for key in valid_keys
                        }

    state[INCIDENT_DELIVERY_EPOCHS_KEY] = deliveries
    state[STATE_SCHEMA_VERSION_KEY] = STATE_SCHEMA_VERSION
    return deliveries


def sync_incident_delivery_epochs(
    deliveries: dict,
    validator_id: str,
    incident_keys: list,
    legacy_validator_epoch=None,
) -> None:
    """Prune recovered incidents and seed the pre-v2 per-validator format."""
    current = {key for key in incident_keys if isinstance(key, str)}
    if not current:
        deliveries.pop(validator_id, None)
        return

    validator_deliveries = deliveries.get(validator_id)
    if not isinstance(validator_deliveries, dict):
        validator_deliveries = {}
    validator_deliveries = {
        key: epoch
        for key, epoch in validator_deliveries.items()
        if key in current and isinstance(epoch, int) and not isinstance(epoch, bool)
    }
    if (
        isinstance(legacy_validator_epoch, int)
        and not isinstance(legacy_validator_epoch, bool)
    ):
        for key in current:
            validator_deliveries.setdefault(key, legacy_validator_epoch)
    deliveries[validator_id] = validator_deliveries


def incident_keys_due_for_epoch(
    deliveries: dict, validator_id: str, incident_keys: list, epoch_index: int
) -> list:
    """Return active incident keys lacking successful delivery for this epoch."""
    validator_deliveries = deliveries.get(validator_id)
    if not isinstance(validator_deliveries, dict):
        validator_deliveries = {}
    return [
        key
        for key in incident_keys
        if (
            not isinstance(validator_deliveries.get(key), int)
            or isinstance(validator_deliveries.get(key), bool)
            or validator_deliveries[key] < epoch_index
        )
    ]


def incidents_due_for_epoch(
    deliveries: dict, validator_id: str, incident_keys: list, epoch_index: int
) -> bool:
    """Return whether any active incident lacks delivery for this epoch."""
    return bool(
        incident_keys_due_for_epoch(
            deliveries, validator_id, incident_keys, epoch_index
        )
    )


def mark_incidents_delivered(
    deliveries: dict, validator_id: str, incident_keys: list, epoch_index: int
) -> None:
    validator_deliveries = deliveries.setdefault(validator_id, {})
    for key in incident_keys:
        if isinstance(key, str):
            validator_deliveries[key] = epoch_index


def heartbeat_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def record_heartbeat(state: dict, status: str, **details) -> None:
    """Persist a bounded operational summary for external freshness checks."""
    previous = state.get(HEARTBEAT_KEY)
    heartbeat = {
        "last_run_at": heartbeat_timestamp(),
        "status": status,
        **details,
    }
    if isinstance(previous, dict):
        for key in ("last_successful_delivery_at", "last_successful_delivery_epoch"):
            if key in previous:
                heartbeat[key] = previous[key]
    if status == "alert_delivered":
        heartbeat["last_successful_delivery_at"] = heartbeat["last_run_at"]
        heartbeat["last_successful_delivery_epoch"] = details.get(
            "completed_epoch_index"
        )
    state[HEARTBEAT_KEY] = heartbeat


def observe_completed_epoch(
    state: dict, epoch_index: int, last_epoch_block: int, tempo: int
) -> tuple:
    """Return the completed epoch and its exact observed start block.

    Persisting the live epoch start lets the next pass handle owner-triggered
    early rollovers without assuming every epoch lasted exactly ``tempo``.
    The tempo fallback covers the first pass after deploying this state format.
    """
    completed_epoch_index = epoch_index - 1
    completed_epoch_start = max(0, last_epoch_block - tempo)
    previous = state.get(EPOCH_OBSERVATION_KEY)
    if isinstance(previous, dict):
        if (
            previous.get("epoch_index") == epoch_index
            and previous.get("completed_epoch_index") == completed_epoch_index
            and isinstance(previous.get("completed_epoch_start"), int)
        ):
            completed_epoch_start = previous["completed_epoch_start"]
        elif (
            previous.get("epoch_index") == completed_epoch_index
            and isinstance(previous.get("start_block"), int)
            and 0 <= previous["start_block"] < last_epoch_block
        ):
            completed_epoch_start = previous["start_block"]

    state[EPOCH_OBSERVATION_KEY] = {
        "epoch_index": epoch_index,
        "start_block": last_epoch_block,
        "completed_epoch_index": completed_epoch_index,
        "completed_epoch_start": completed_epoch_start,
    }
    return completed_epoch_index, completed_epoch_start


def webhook_url() -> str:
    try:
        with open(WEBHOOK_FILE) as handle:
            return handle.read().strip()
    except Exception:
        return ""


SLACK_WEBHOOK_HOSTS = frozenset(("hooks.slack.com", "hooks.slack-gov.com"))
DISCORD_WEBHOOK_HOSTS = frozenset(
    ("discord.com", "discordapp.com", "www.discord.com", "www.discordapp.com")
)


def webhook_provider(url: str) -> str:
    """Return the provider for an exact official HTTPS webhook URL."""
    if not isinstance(url, str) or not url:
        return ""
    try:
        parts = urlsplit(url)
        host = parts.hostname.lower() if parts.hostname else ""
        port = parts.port
    except (TypeError, ValueError):
        return ""
    if (
        parts.scheme.lower() != "https"
        or not host
        or port is not None
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
    ):
        return ""

    segments = parts.path.split("/")
    if host in SLACK_WEBHOOK_HOSTS and len(segments) == 5 and segments[1] == "services":
        return "slack" if all(segments[2:]) else ""
    if (
        host in DISCORD_WEBHOOK_HOSTS
        and len(segments) == 5
        and segments[1:3] == ["api", "webhooks"]
    ):
        return "discord" if all(segments[3:]) else ""
    return ""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep provider acknowledgement tied to the configured endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _open_webhook(request):
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=15)


def post_alert(content: str, url: Optional[str] = None) -> bool:
    """Post to the configured official Slack or legacy Discord webhook."""
    url = webhook_url() if url is None else url
    if not url:
        log("log-only (no webhook configured)")
        return False
    provider = webhook_provider(url)
    if not provider:
        log("webhook rejected (unsupported endpoint)")
        return False
    if provider == "slack":
        payload = {
            "text": content,
            "mrkdwn": False,
            "link_names": False,
            "parse": "none",
            "unfurl_links": False,
            "unfurl_media": False,
        }
    else:
        payload = {"content": content}
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "sn71-weights-watch/1.0",
        },
    )
    try:
        with _open_webhook(request) as response:
            if provider == "slack":
                acknowledgement = (
                    response.read(4096).decode("utf-8", "replace").strip()
                )
                return response.status == 200 and acknowledgement == "ok"
            return 200 <= response.status < 300
    except Exception as exc:
        # A dead webhook must not crash the pass. The caller retains the
        # incident's previous delivery epoch so the next cron tick retries it.
        status = getattr(exc, "code", None)
        if isinstance(status, int):
            log(f"{provider} post failed (HTTPError, status={status})")
        else:
            log(f"{provider} post failed ({type(exc).__name__})")
        return False


def webhook_workspace(url: str) -> str:
    """Return the Slack workspace segment for a validated Slack webhook."""
    if webhook_provider(url) != "slack":
        return ""
    return urlsplit(url).path.split("/")[2]


def _replace_private_file(path: str, content: str) -> None:
    """Write content privately and replace the target atomically."""
    directory = os.path.dirname(path) or "."
    fd, pending = tempfile.mkstemp(prefix=".weights-webhook-", dir=directory)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as handle:
            fd = None
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(pending, path)
    finally:
        if fd is not None:
            os.close(fd)
        if os.path.exists(pending):
            os.unlink(pending)


def configure_webhook_from_env(expected_slack_workspace: str) -> str:
    """Safely switch the active destination when the deployment secret exists.

    The candidate is read only from ``WEIGHTS_ALERT_WEBHOOK``. A missing
    candidate is a no-op so ordinary releases preserve the current destination.
    A candidate is tested before a private rollback copy and atomic replacement.
    """
    candidate = os.environ.get(WEBHOOK_ENV, "").strip()
    if not candidate:
        return "no-op"
    if webhook_provider(candidate) != "slack":
        raise ValueError("candidate is not an official Slack webhook")
    if webhook_workspace(candidate) != expected_slack_workspace:
        raise ValueError("candidate Slack webhook has the wrong workspace")

    target = WEBHOOK_FILE
    if os.path.islink(target) or not os.path.isfile(target):
        raise RuntimeError("active webhook file is missing or unsafe")
    previous = webhook_url()
    if not webhook_provider(previous):
        raise RuntimeError("active webhook is missing or unsupported")
    if previous == candidate:
        return "no-op"
    rollback = WEBHOOK_ROLLBACK_FILE
    if os.path.lexists(rollback) and (
        os.path.islink(rollback) or not os.path.isfile(rollback)
    ):
        raise RuntimeError("rollback copy is unsafe")

    test_message = (
        "SN71 missed-weight monitor — connection test only. "
        "This verifies the configured alert destination; no incident was generated."
    )
    if not post_alert(test_message, url=candidate):
        raise RuntimeError("candidate webhook did not acknowledge the test")

    _replace_private_file(rollback, previous + "\n")
    _replace_private_file(target, candidate + "\n")
    return "switched"


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
    if "--configure-webhook" in sys.argv:
        expected_workspace = ""
        try:
            index = sys.argv.index("--expected-slack-workspace")
            expected_workspace = sys.argv[index + 1]
            status = configure_webhook_from_env(expected_workspace)
        except Exception as exc:
            log(f"webhook configuration failed ({type(exc).__name__})")
            print(
                f"webhook configuration failed ({type(exc).__name__})",
                file=sys.stderr,
            )
            return 1
        print(f"webhook configuration: {status}")
        return 0

    if "--test" in sys.argv:
        sent = post_alert(
            "✅ SN71 weights watch: test message (official-epoch alerting is wired up)"
        )
        if sent:
            print("test message sent")
            return 0
        print("test message failed", file=sys.stderr)
        return 1

    state = load_state()
    deliveries = incident_delivery_epochs(state)
    try:
        import bittensor as bt

        st = bt.Subtensor(network="finney")
        epoch_index, last_epoch_block, tempo, block = official_epoch_state(st)
        mg = st.metagraph(NETUID)
    except Exception as exc:
        # A flaky chain endpoint must not produce false pages; the next cron
        # run retries in five minutes.
        error = " ".join(str(exc).split())[:240]
        log(f"chain query failed (skipping this pass): {error}")
        record_heartbeat(
            state,
            "chain_query_failed",
            chain_read_ok=False,
            error=error,
            active_incident_count=None,
            due_validator_count=None,
            delivery_attempted=False,
            delivery_succeeded=None,
        )
        save_state(state)
        return 0

    if tempo <= 0:
        log(f"invalid tempo {tempo} (skipping this pass)")
        record_heartbeat(
            state,
            "invalid_tempo",
            chain_read_ok=True,
            official_epoch_index=epoch_index,
            current_block=block,
            tempo=tempo,
            active_incident_count=None,
            due_validator_count=None,
            delivery_attempted=False,
            delivery_succeeded=None,
        )
        save_state(state)
        return 0

    validators = load_registry()
    if not validators:
        log("no validator registry found (skipping this pass)")
        record_heartbeat(
            state,
            "registry_unavailable",
            chain_read_ok=True,
            official_epoch_index=epoch_index,
            current_block=block,
            tempo=tempo,
            active_incident_count=None,
            due_validator_count=None,
            delivery_attempted=False,
            delivery_succeeded=None,
        )
        save_state(state)
        return 0

    if epoch_index <= 0 or last_epoch_block <= 0:
        log(
            "invalid completed epoch boundary "
            f"(epoch={epoch_index}, last_epoch_block={last_epoch_block}, tempo={tempo}); "
            "skipping this pass"
        )
        record_heartbeat(
            state,
            "invalid_epoch_boundary",
            chain_read_ok=True,
            official_epoch_index=epoch_index,
            current_block=block,
            last_epoch_block=last_epoch_block,
            tempo=tempo,
            active_incident_count=None,
            due_validator_count=None,
            delivery_attempted=False,
            delivery_succeeded=None,
        )
        save_state(state)
        return 0

    completed_epoch_index, completed_epoch_start = observe_completed_epoch(
        state, epoch_index, last_epoch_block, tempo
    )
    hotkeys = list(mg.hotkeys)
    hotkey_to_uid = {hk: i for i, hk in enumerate(hotkeys)}
    misses = []
    active_incident_count = 0
    for validator in validators:
        vid = str(validator.get("id") or validator.get("hotkey") or "")[:64]
        fallback_label = str(validator.get("label") or vid)
        role = str(validator.get("role") or "")
        hotkey = str(validator.get("hotkey") or "")
        expected_coldkey = str(validator.get("expectedColdkey") or "")
        if not vid or not hotkey:
            continue
        previous_validator_state = state.get(vid)
        problems = []
        incident_keys = []
        uid = hotkey_to_uid.get(hotkey)
        last_set_block = None
        blocks_since = None
        if uid is None:
            update_incident_state(state, vid, [])
            sync_incident_delivery_epochs(deliveries, vid, [])
            continue
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
        # Do not page while the official epoch is still in progress. Once
        # it rolls over, a last_update older than that completed epoch's
        # start proves the validator did not submit anywhere in the epoch.
        if last_set_block < completed_epoch_start:
            problems.append(
                f"weight update missed completed epoch {completed_epoch_index} "
                f"({blocks_since} blocks since last set)"
            )
            incident_keys.append(f"weight_update_stale:{last_set_block}")
        # Deduplicate by stable validator identity and incident evidence, never
        # by epoch or UID. Resolved incidents are removed from state so a later
        # recurrence can alert again.
        update_incident_state(state, vid, incident_keys)
        legacy_validator_epoch = (
            previous_validator_state
            if (
                isinstance(previous_validator_state, int)
                and not isinstance(previous_validator_state, bool)
            )
            else None
        )
        sync_incident_delivery_epochs(
            deliveries,
            vid,
            incident_keys,
            legacy_validator_epoch=legacy_validator_epoch,
        )
        active_incident_count += len(set(incident_keys))
        due_incident_keys = incident_keys_due_for_epoch(
            deliveries, vid, incident_keys, completed_epoch_index
        )
        if due_incident_keys:
            due_key_set = set(due_incident_keys)
            due_problems = [
                problem
                for problem, incident_key in zip(problems, incident_keys)
                if incident_key in due_key_set
            ]
            misses.append(
                (
                    vid,
                    label,
                    uid,
                    last_set_block,
                    blocks_since,
                    due_problems,
                    due_incident_keys,
                )
            )

    epoch_block = max(0, block - last_epoch_block)
    delivery_attempted = bool(misses)
    delivery_succeeded = None
    status = "healthy" if active_incident_count == 0 else "unresolved_already_delivered"
    if delivery_attempted:
        is_reminder = any(
            any(
                isinstance(deliveries.get(vid, {}).get(key), int)
                and not isinstance(deliveries.get(vid, {}).get(key), bool)
                for key in incident_keys
            )
            for vid, *_, incident_keys in misses
        )
        alert_label = "missed weight set reminder" if is_reminder else "missed weight set"
        lines = [
            f"🚨 SN71 {alert_label} "
            f"(official epoch {completed_epoch_index} completed; checked at "
            f"epoch {epoch_index}, block {epoch_block}/{tempo})"
        ]
        for (
            vid,
            label,
            uid,
            last_set_block,
            behind,
            problems,
            _incident_keys,
        ) in misses:
            uid_text = f"current UID {uid}" if uid is not None else "not registered"
            set_text = (
                f", last set {behind} blocks ago" if behind is not None else ""
            )
            lines.append(f"• {label} · {uid_text}{set_text}: " + "; ".join(problems))
        if any(vid == "sn71-primary" for vid, *_ in misses):
            lines.append(
                "Primary miss ⇒ auditors have no bundle to copy; check gateway "
                "/weights/submit responses and the validator log."
            )
        delivery_succeeded = post_alert("\n".join(lines))
        if delivery_succeeded:
            for vid, *_, incident_keys in misses:
                mark_incidents_delivered(
                    deliveries, vid, incident_keys, completed_epoch_index
                )
            claim_epoch_alert(state, completed_epoch_index, True)
            status = "alert_delivered"
            log(f"ALERTED: {[(m[0], m[5]) for m in misses]}")
        else:
            status = "delivery_failed"
            log(
                f"DELIVERY_FAILED: completed official epoch {completed_epoch_index}; "
                f"pending incidents: {[(m[0], m[5]) for m in misses]}"
            )

    record_heartbeat(
        state,
        status,
        chain_read_ok=True,
        official_epoch_index=epoch_index,
        completed_epoch_index=completed_epoch_index,
        current_block=block,
        last_epoch_block=last_epoch_block,
        completed_epoch_start=completed_epoch_start,
        epoch_block=epoch_block,
        tempo=tempo,
        active_incident_count=active_incident_count,
        due_validator_count=len(misses),
        delivery_attempted=delivery_attempted,
        delivery_succeeded=delivery_succeeded,
    )
    save_state(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
