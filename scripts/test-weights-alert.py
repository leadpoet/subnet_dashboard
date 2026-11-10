#!/usr/bin/env python3

import json
import os
import stat
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import weights_alert
from weights_alert import (
    EPOCH_OBSERVATION_KEY,
    HEARTBEAT_KEY,
    INCIDENT_DELIVERY_EPOCHS_KEY,
    LAST_ALERT_EPOCH_KEY,
    claim_epoch_alert,
    display_label,
    incident_delivery_epochs,
    incident_keys_due_for_epoch,
    incidents_due_for_epoch,
    mark_incidents_delivered,
    observe_completed_epoch,
    query_identity_name,
    record_heartbeat,
    safe_identity_name,
    sync_incident_delivery_epochs,
    update_incident_state,
)


class _FakeResponse:
    def __init__(self, status, body=b""):
        self.status = status
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self, _limit):
        return self._body


class WeightsAlertWebhookTest(unittest.TestCase):
    def _config_paths(self, directory):
        target = os.path.join(directory, "weights_alert_webhook")
        rollback = target + ".before-slack"
        return target, rollback

    def test_webhook_provider_requires_exact_official_https_endpoint(self):
        self.assertEqual(
            weights_alert.webhook_provider(
                "https://hooks.slack.com/services/T000/B000/secret"
            ),
            "slack",
        )
        self.assertEqual(
            weights_alert.webhook_provider(
                "https://discord.com/api/webhooks/123/secret"
            ),
            "discord",
        )
        for url in (
            "http://hooks.slack.com/services/T000/B000/secret",
            "https://example.com/services/T000/B000/secret",
            "https://hooks.slack.com/services/T000/B000/secret?wait=true",
            "https://hooks.slack.com:443/services/T000/B000/secret",
            "https://hooks.slack.com/services/T000/B000/secret/extra",
        ):
            with self.subTest(url=url):
                self.assertEqual(weights_alert.webhook_provider(url), "")

    def test_slack_requires_http_200_and_plain_ok_acknowledgement(self):
        slack_url = "https://hooks.slack.com/services/T000/B000/secret"
        for status, body, expected in ((200, b"ok", True), (200, b"error", False), (204, b"ok", False)):
            with self.subTest(status=status, body=body):
                response = _FakeResponse(status, body)
                with patch.object(weights_alert, "_open_webhook", return_value=response) as open_webhook:
                    self.assertEqual(
                        weights_alert.post_alert("SN71 alert", slack_url), expected
                    )
                request = open_webhook.call_args.args[0]
                self.assertEqual(
                    json.loads(request.data),
                    {
                        "text": "SN71 alert",
                        "mrkdwn": False,
                        "link_names": False,
                        "parse": "none",
                        "unfurl_links": False,
                        "unfurl_media": False,
                    },
                )

    def test_discord_legacy_webhook_accepts_success_status_without_body(self):
        discord_url = "https://discord.com/api/webhooks/123/secret"
        response = _FakeResponse(204)
        with patch.object(weights_alert, "_open_webhook", return_value=response) as open_webhook:
            self.assertTrue(weights_alert.post_alert("SN71 alert", discord_url))
        request = open_webhook.call_args.args[0]
        self.assertEqual(json.loads(request.data), {"content": "SN71 alert"})

    def test_redirects_are_not_followed(self):
        self.assertIsNone(
            weights_alert._NoRedirect().redirect_request(
                None, None, 302, "Found", {}, "https://example.com/redirect"
            )
        )

    def test_webhook_errors_redact_url_and_unsupported_urls_are_not_opened(self):
        slack_url = "https://hooks.slack.com/services/T000/B000/secret"
        logs = []
        with ExitStack() as stack:
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "_open_webhook",
                    side_effect=RuntimeError(f"failed {slack_url} secret token"),
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "log", side_effect=logs.append)
            )
            self.assertFalse(weights_alert.post_alert("SN71 alert", slack_url))
        self.assertNotIn(slack_url, logs[0])
        self.assertNotIn("secret", logs[0])
        self.assertIn("RuntimeError", logs[0])

        with patch.object(weights_alert, "_open_webhook") as open_webhook, patch.object(
            weights_alert, "log", side_effect=logs.append
        ):
            self.assertFalse(
                weights_alert.post_alert(
                    "SN71 alert", "https://untrusted.example/hooks/secret"
                )
            )
        open_webhook.assert_not_called()

    def test_test_mode_returns_nonzero_when_provider_rejects_message(self):
        with patch.object(weights_alert, "post_alert", return_value=False):
            with patch.object(sys, "argv", ["weights_alert.py", "--test"]):
                self.assertEqual(weights_alert.main(), 1)

    def test_configure_webhook_noops_without_sending_when_already_current(self):
        candidate = "https://hooks.slack.com/services/T09LJDCSA4W/B000/secret"
        with tempfile.TemporaryDirectory() as directory:
            target, rollback = self._config_paths(directory)
            with open(target, "w") as handle:
                handle.write(candidate + "\n")
            with ExitStack() as stack:
                stack.enter_context(patch.object(weights_alert, "WEBHOOK_FILE", target))
                stack.enter_context(
                    patch.object(weights_alert, "WEBHOOK_ROLLBACK_FILE", rollback)
                )
                stack.enter_context(
                    patch.dict(os.environ, {weights_alert.WEBHOOK_ENV: candidate})
                )
                sender = stack.enter_context(patch.object(weights_alert, "post_alert"))
                self.assertEqual(
                    weights_alert.configure_webhook_from_env("T09LJDCSA4W"),
                    "no-op",
                )
            sender.assert_not_called()
            self.assertFalse(os.path.exists(rollback))

    def test_configure_webhook_failed_ack_keeps_active_destination(self):
        previous = "https://discord.com/api/webhooks/123/oldtoken"
        candidate = "https://hooks.slack.com/services/T09LJDCSA4W/B000/secret"
        with tempfile.TemporaryDirectory() as directory:
            target, rollback = self._config_paths(directory)
            with open(target, "w") as handle:
                handle.write(previous + "\n")
            with ExitStack() as stack:
                stack.enter_context(patch.object(weights_alert, "WEBHOOK_FILE", target))
                stack.enter_context(
                    patch.object(weights_alert, "WEBHOOK_ROLLBACK_FILE", rollback)
                )
                stack.enter_context(
                    patch.dict(os.environ, {weights_alert.WEBHOOK_ENV: candidate})
                )
                stack.enter_context(patch.object(weights_alert, "post_alert", return_value=False))
                with self.assertRaisesRegex(RuntimeError, "did not acknowledge"):
                    weights_alert.configure_webhook_from_env("T09LJDCSA4W")
            with open(target) as handle:
                self.assertEqual(handle.read(), previous + "\n")
            self.assertFalse(os.path.exists(rollback))

    def test_configure_webhook_success_writes_private_rollback_and_replaces_atomically(self):
        previous = "https://discord.com/api/webhooks/123/oldtoken"
        candidate = "https://hooks.slack.com/services/T09LJDCSA4W/B000/secret"
        with tempfile.TemporaryDirectory() as directory:
            target, rollback = self._config_paths(directory)
            with open(target, "w") as handle:
                handle.write(previous + "\n")
            with ExitStack() as stack:
                stack.enter_context(patch.object(weights_alert, "WEBHOOK_FILE", target))
                stack.enter_context(
                    patch.object(weights_alert, "WEBHOOK_ROLLBACK_FILE", rollback)
                )
                stack.enter_context(
                    patch.dict(os.environ, {weights_alert.WEBHOOK_ENV: candidate})
                )
                sender = stack.enter_context(
                    patch.object(weights_alert, "post_alert", return_value=True)
                )
                self.assertEqual(
                    weights_alert.configure_webhook_from_env("T09LJDCSA4W"),
                    "switched",
                )
            sender.assert_called_once()
            self.assertEqual(sender.call_args.kwargs["url"], candidate)
            with open(target) as handle:
                self.assertEqual(handle.read(), candidate + "\n")
            with open(rollback) as handle:
                self.assertEqual(handle.read(), previous + "\n")
            rotated = "https://hooks.slack.com/services/T09LJDCSA4W/C000/newsecret"
            with ExitStack() as stack:
                stack.enter_context(patch.object(weights_alert, "WEBHOOK_FILE", target))
                stack.enter_context(
                    patch.object(weights_alert, "WEBHOOK_ROLLBACK_FILE", rollback)
                )
                stack.enter_context(
                    patch.dict(os.environ, {weights_alert.WEBHOOK_ENV: rotated})
                )
                with patch.object(weights_alert, "post_alert", return_value=True) as sender:
                    self.assertEqual(
                        weights_alert.configure_webhook_from_env("T09LJDCSA4W"),
                        "switched",
                    )
            sender.assert_called_once()
            with open(target) as handle:
                self.assertEqual(handle.read(), rotated + "\n")
            with open(rollback) as handle:
                self.assertEqual(handle.read(), candidate + "\n")
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(os.stat(target).st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(os.stat(rollback).st_mode), 0o600)

    def test_configure_webhook_rejects_unsafe_or_wrong_workspace_without_sending(self):
        previous = "https://discord.com/api/webhooks/123/oldtoken"
        candidates = (
            "http://hooks.slack.com/services/T09LJDCSA4W/B000/secret",
            "https://hooks.slack.com/services/T09LJDCSA4W/B000/secret?x=1",
            "https://hooks.slack.com/services/T999/B000/secret",
            "https://untrusted.example/services/T09LJDCSA4W/B000/secret",
        )
        for candidate in candidates:
            with self.subTest(candidate=candidate), tempfile.TemporaryDirectory() as directory:
                target, rollback = self._config_paths(directory)
                with open(target, "w") as handle:
                    handle.write(previous + "\n")
                with ExitStack() as stack:
                    stack.enter_context(patch.object(weights_alert, "WEBHOOK_FILE", target))
                    stack.enter_context(
                        patch.object(weights_alert, "WEBHOOK_ROLLBACK_FILE", rollback)
                    )
                    stack.enter_context(
                        patch.dict(os.environ, {weights_alert.WEBHOOK_ENV: candidate})
                    )
                    sender = stack.enter_context(patch.object(weights_alert, "post_alert"))
                    with self.assertRaises(ValueError):
                        weights_alert.configure_webhook_from_env("T09LJDCSA4W")
                sender.assert_not_called()
                with open(target) as handle:
                    self.assertEqual(handle.read(), previous + "\n")

    def test_configure_webhook_rejects_unsupported_previous_destination(self):
        candidate = "https://hooks.slack.com/services/T09LJDCSA4W/B000/secret"
        with tempfile.TemporaryDirectory() as directory:
            target, rollback = self._config_paths(directory)
            with open(target, "w") as handle:
                handle.write("not-a-webhook\n")
            with ExitStack() as stack:
                stack.enter_context(patch.object(weights_alert, "WEBHOOK_FILE", target))
                stack.enter_context(
                    patch.object(weights_alert, "WEBHOOK_ROLLBACK_FILE", rollback)
                )
                stack.enter_context(
                    patch.dict(os.environ, {weights_alert.WEBHOOK_ENV: candidate})
                )
                sender = stack.enter_context(patch.object(weights_alert, "post_alert"))
                with self.assertRaisesRegex(RuntimeError, "unsupported"):
                    weights_alert.configure_webhook_from_env("T09LJDCSA4W")
            sender.assert_not_called()
            self.assertFalse(os.path.exists(rollback))


class WeightsAlertIncidentStateTest(unittest.TestCase):
    def test_completed_epoch_uses_observed_start_after_early_rollover(self):
        state = {}

        self.assertEqual(observe_completed_epoch(state, 100, 10_000, 360), (99, 9_640))
        self.assertEqual(
            observe_completed_epoch(state, 101, 10_200, 360),
            (100, 10_000),
            "an owner-triggered early rollover must use the observed epoch start",
        )
        self.assertEqual(
            observe_completed_epoch(state, 101, 10_200, 360),
            (100, 10_000),
            "later passes in the same epoch must retain the completed start",
        )
        self.assertEqual(state[EPOCH_OBSERVATION_KEY]["start_block"], 10_200)

    def test_epoch_alert_can_only_be_claimed_once(self):
        state = {}

        self.assertTrue(claim_epoch_alert(state, 24_169, True))
        self.assertFalse(claim_epoch_alert(state, 24_169, True))
        self.assertEqual(state[LAST_ALERT_EPOCH_KEY], 24_169)

    def test_main_waits_for_rollover_then_posts_once_for_completed_epoch(self):
        class Metagraph:
            hotkeys = [
                "hotkey-primary",
                "hotkey-tao",
                "hotkey-yuma",
                "hotkey-unconfirmed",
            ]
            coldkeys = [
                "coldkey-primary",
                "coldkey-tao",
                "coldkey-yuma",
                "coldkey-unconfirmed",
            ]
            validator_permit = [True, True, True, True]
            active = [True, True, True, True]
            last_update = [9948, 9947, 9948, 9947]

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                return Metagraph()

            def query_identity(self, coldkey):
                return types.SimpleNamespace(name="")

        state = {}
        messages = []
        registry = [
            {
                "id": "sn71-primary",
                "role": "primary",
                "label": "primary (Subnet 71)",
                "hotkey": "hotkey-primary",
                "expectedColdkey": "coldkey-primary",
            },
            {
                "id": "tao-auditor",
                "role": "auditor",
                "label": "auditor (TAO.com)",
                "hotkey": "hotkey-tao",
                "expectedColdkey": "coldkey-tao",
            },
            {
                "id": "yuma-auditor",
                "role": "auditor",
                "label": "auditor (Yuma)",
                "hotkey": "hotkey-yuma",
                "expectedColdkey": "coldkey-yuma",
            },
            {
                "id": "unconfirmed-auditor",
                "role": "auditor",
                "label": "auditor (identity unconfirmed)",
                "hotkey": "hotkey-unconfirmed",
                "expectedColdkey": "coldkey-unconfirmed",
            },
        ]
        epoch_snapshots = [
            (24_172, 10_000, 360, 10_349),
            (24_173, 10_360, 360, 10_374),
            (24_173, 10_360, 360, 10_399),
        ]
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    side_effect=epoch_snapshots,
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "post_alert",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(messages, [], "must not page before epoch 24172 ends")
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 1)
        self.assertIn("official epoch 24172 completed", messages[0])
        self.assertIn("checked at epoch 24173, block 14/360", messages[0])
        self.assertIn("primary (Subnet 71)", messages[0])
        self.assertIn("auditor (TAO.com)", messages[0])
        self.assertIn("426 blocks since last set", messages[0])
        self.assertIn("427 blocks since last set", messages[0])
        self.assertEqual(state[LAST_ALERT_EPOCH_KEY], 24_172)

    def test_main_ignores_unregistered_validators_and_prunes_prior_incident(self):
        class Metagraph:
            hotkeys = ["hotkey-primary"]
            coldkeys = ["coldkey-primary"]
            validator_permit = [True]
            active = [True]
            last_update = [10_050]

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                return Metagraph()

            def query_identity(self, coldkey):
                return types.SimpleNamespace(name="")

        registry = [
            {
                "id": "sn71-primary",
                "role": "primary",
                "label": "primary (Subnet 71)",
                "hotkey": "hotkey-primary",
                "expectedColdkey": "coldkey-primary",
            },
            {
                "id": "retired-auditor",
                "role": "auditor",
                "label": "auditor (retired)",
                "hotkey": "hotkey-retired",
                "expectedColdkey": "coldkey-retired",
            },
        ]
        state = {
            "retired-auditor": ["hotkey_not_registered"],
            INCIDENT_DELIVERY_EPOCHS_KEY: {
                "retired-auditor": {"hotkey_not_registered": 24_171}
            },
        }
        messages = []
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    return_value=(24_173, 10_360, 360, 10_374),
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "post_alert",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(messages, [])
        self.assertNotIn("retired-auditor", state)
        self.assertNotIn(
            "retired-auditor", state[INCIDENT_DELIVERY_EPOCHS_KEY]
        )
        self.assertEqual(state[HEARTBEAT_KEY]["active_incident_count"], 0)
        self.assertEqual(state[HEARTBEAT_KEY]["due_validator_count"], 0)

    def test_identity_name_replaces_fallback_for_verified_coldkey(self):
        identity = types.SimpleNamespace(name="Rizzo (Insured)")
        subtensor = types.SimpleNamespace(query_identity=lambda coldkey: identity)

        name = query_identity_name(subtensor, "coldkey-rizzo")

        self.assertEqual(
            display_label("auditor", "auditor (Rizzo)", name),
            "auditor (Rizzo (Insured))",
        )

    def test_identity_lookup_failure_keeps_trusted_fallback(self):
        def unavailable(_coldkey):
            raise RuntimeError("RPC unavailable")

        subtensor = types.SimpleNamespace(query_identity=unavailable)

        self.assertEqual(query_identity_name(subtensor, "coldkey-rizzo"), "")
        self.assertEqual(
            display_label("auditor", "auditor (Rizzo)", ""),
            "auditor (Rizzo)",
        )

    def test_identity_name_is_bounded_single_line_and_cannot_mention(self):
        unsafe = "  @everyone\n" + ("x" * 100)

        name = safe_identity_name(unsafe)

        self.assertNotIn("\n", name)
        self.assertNotIn("@everyone", name)
        self.assertLessEqual(len(name), 81)

    def test_identity_name_breaks_mentions_and_links(self):
        name = safe_identity_name("<@U123> https://evil.example/x www.evil.example")

        self.assertNotIn("<@U123>", name)
        self.assertNotIn("https://", name)
        self.assertNotIn("www.", name)

    def test_main_waits_for_completed_epoch_at_404_to_430_block_transition(self):
        class Metagraph:
            hotkeys = ["hotkey-primary"]
            coldkeys = ["coldkey-primary"]
            validator_permit = [True]
            active = [True]
            last_update = [1000]

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                self.netuid = netuid
                return Metagraph()

            def query_identity(self, coldkey):
                return types.SimpleNamespace(name="Subnet 71")

        state = {}
        messages = []
        registry = [
            {
                "id": "sn71-primary",
                "role": "primary",
                "label": "primary (Subnet 71)",
                "hotkey": "hotkey-primary",
                "expectedColdkey": "coldkey-primary",
            }
        ]
        epoch_snapshots = [
            (24090, 1049, 360, 1404),
            (24091, 1409, 360, 1430),
        ]
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    side_effect=epoch_snapshots,
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "post_alert",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 1)
        self.assertIn("official epoch 24090 completed", messages[0])
        self.assertIn("430 blocks since last set", messages[0])
        self.assertIn("primary (Subnet 71)", messages[0])
        self.assertEqual(
            state["sn71-primary"],
            ["weight_update_stale:1000"],
        )

    def test_main_does_not_trust_identity_when_coldkey_changes(self):
        class Metagraph:
            hotkeys = ["hotkey-rizzo"]
            coldkeys = ["coldkey-unrelated"]
            validator_permit = [True]
            active = [True]
            last_update = [1000]

        queried_coldkeys = []

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                return Metagraph()

            def query_identity(self, coldkey):
                queried_coldkeys.append(coldkey)
                return types.SimpleNamespace(name="Spoofed Rizzo")

        registry = [
            {
                "id": "rizzo",
                "role": "auditor",
                "label": "auditor (Rizzo)",
                "hotkey": "hotkey-rizzo",
                "expectedColdkey": "coldkey-rizzo",
            }
        ]
        messages = []
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    return_value=(24091, 1049, 360, 1404),
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value={})
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "post_alert",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(queried_coldkeys, [])
        self.assertEqual(len(messages), 1)
        self.assertIn("auditor (Rizzo)", messages[0])
        self.assertNotIn("Spoofed Rizzo", messages[0])
        self.assertIn("unexpected coldkey", messages[0])

    def test_active_state_keeps_same_incident_key_across_epoch_boundary(self):
        state = {}
        stale_incident = ["weight_update_stale:1000"]

        self.assertTrue(update_incident_state(state, "sn71-primary", stale_incident))
        self.assertFalse(
            update_incident_state(state, "sn71-primary", stale_incident),
            "active-state identity must remain stable when only age and epoch change",
        )

    def test_delivery_state_reminds_once_per_completed_epoch(self):
        deliveries = {}
        incident_keys = ["weight_update_stale:1000"]

        self.assertTrue(
            incidents_due_for_epoch(deliveries, "sn71-primary", incident_keys, 24_172)
        )
        mark_incidents_delivered(
            deliveries, "sn71-primary", incident_keys, 24_172
        )
        self.assertFalse(
            incidents_due_for_epoch(deliveries, "sn71-primary", incident_keys, 24_172),
            "a successful delivery must not repeat during the same completed epoch",
        )
        self.assertTrue(
            incidents_due_for_epoch(deliveries, "sn71-primary", incident_keys, 24_173),
            "an unresolved incident must remind after the next epoch completes",
        )

    def test_late_same_epoch_problem_does_not_redeliver_prior_incident_key(self):
        deliveries = {
            "sn71-primary": {"weight_update_stale:1000": 24_172}
        }
        incident_keys = ["validator_inactive", "weight_update_stale:1000"]

        self.assertEqual(
            incident_keys_due_for_epoch(
                deliveries,
                "sn71-primary",
                incident_keys,
                24_172,
            ),
            ["validator_inactive"],
        )

    def test_legacy_active_incidents_seed_delivery_epoch_without_replay(self):
        state = {
            "sn71-primary": ["weight_update_stale:1000"],
            LAST_ALERT_EPOCH_KEY: 24_172,
        }

        deliveries = incident_delivery_epochs(state)

        self.assertEqual(
            deliveries,
            {"sn71-primary": {"weight_update_stale:1000": 24_172}},
        )
        self.assertEqual(state[INCIDENT_DELIVERY_EPOCHS_KEY], deliveries)
        self.assertFalse(
            incidents_due_for_epoch(
                deliveries,
                "sn71-primary",
                ["weight_update_stale:1000"],
                24_172,
            )
        )
        self.assertTrue(
            incidents_due_for_epoch(
                deliveries,
                "sn71-primary",
                ["weight_update_stale:1000"],
                24_173,
            )
        )

    def test_recovery_prunes_delivery_state_for_recurrence(self):
        deliveries = {
            "sn71-primary": {"weight_update_stale:1000": 24_172}
        }

        sync_incident_delivery_epochs(deliveries, "sn71-primary", [])
        self.assertNotIn("sn71-primary", deliveries)

        sync_incident_delivery_epochs(
            deliveries,
            "sn71-primary",
            ["weight_update_stale:1000"],
        )
        self.assertTrue(
            incidents_due_for_epoch(
                deliveries,
                "sn71-primary",
                ["weight_update_stale:1000"],
                24_172,
            ),
            "a recovered incident that recurs must page even in the same epoch",
        )

    def test_new_last_set_block_creates_a_new_stale_episode(self):
        state = {"sn71-primary": ["weight_update_stale:1000"]}

        self.assertTrue(
            update_incident_state(
                state,
                "sn71-primary",
                ["weight_update_stale:1360"],
            )
        )

    def test_recovery_clears_incident_for_a_later_recurrence(self):
        state = {"sn71-primary": ["weight_update_stale:1000"]}

        self.assertFalse(update_incident_state(state, "sn71-primary", []))
        self.assertNotIn("sn71-primary", state)
        self.assertTrue(
            update_incident_state(
                state,
                "sn71-primary",
                ["weight_update_stale:1000"],
            )
        )

    def test_new_problem_alerts_while_resolved_problem_does_not(self):
        state = {"auditor": ["validator_inactive"]}

        self.assertTrue(
            update_incident_state(
                state,
                "auditor",
                ["validator_inactive", "validator_permit_lost"],
            )
        )
        self.assertFalse(
            update_incident_state(state, "auditor", ["validator_permit_lost"]),
            "removing a resolved incident must not page as a new problem",
        )

    def test_legacy_epoch_state_migrates_without_replaying(self):
        state = {"sn71-primary": 24091}

        self.assertFalse(
            update_incident_state(
                state,
                "sn71-primary",
                ["weight_update_stale:1000"],
            )
        )
        self.assertEqual(
            state["sn71-primary"],
            ["weight_update_stale:1000"],
        )

    def test_main_delivers_one_reminder_for_each_new_completed_epoch(self):
        class Metagraph:
            hotkeys = ["hotkey-primary"]
            coldkeys = ["coldkey-primary"]
            validator_permit = [True]
            active = [True]
            last_update = [9948]

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                return Metagraph()

            def query_identity(self, coldkey):
                return types.SimpleNamespace(name="Subnet 71")

        registry = [
            {
                "id": "sn71-primary",
                "role": "primary",
                "label": "primary (Subnet 71)",
                "hotkey": "hotkey-primary",
                "expectedColdkey": "coldkey-primary",
            }
        ]
        epoch_snapshots = [
            (24_173, 10_360, 360, 10_374),
            (24_173, 10_360, 360, 10_399),
            (24_174, 10_720, 360, 10_734),
        ]
        state = {}
        messages = []
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    side_effect=epoch_snapshots,
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "post_alert",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 2)
        self.assertIn("official epoch 24172 completed", messages[0])
        self.assertNotIn("reminder", messages[0])
        self.assertIn("missed weight set reminder", messages[1])
        self.assertIn("official epoch 24173 completed", messages[1])
        self.assertEqual(
            state[INCIDENT_DELIVERY_EPOCHS_KEY]["sn71-primary"],
            {"weight_update_stale:9948": 24_173},
        )
        self.assertEqual(state[LAST_ALERT_EPOCH_KEY], 24_173)
        self.assertEqual(state[HEARTBEAT_KEY]["status"], "alert_delivered")
        self.assertEqual(
            state[HEARTBEAT_KEY]["last_successful_delivery_epoch"],
            24_173,
        )

    def test_main_retries_failed_delivery_without_consuming_incident(self):
        class Metagraph:
            hotkeys = ["hotkey-primary"]
            coldkeys = ["coldkey-primary"]
            validator_permit = [True]
            active = [True]
            last_update = [9948]

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                return Metagraph()

            def query_identity(self, coldkey):
                return types.SimpleNamespace(name="Subnet 71")

        registry = [
            {
                "id": "sn71-primary",
                "role": "primary",
                "label": "primary (Subnet 71)",
                "hotkey": "hotkey-primary",
                "expectedColdkey": "coldkey-primary",
            }
        ]
        state = {}
        messages = []
        logs = []
        delivery_results = iter([False, True])
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        def deliver(content):
            messages.append(content)
            return next(delivery_results)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    side_effect=[
                        (24_173, 10_360, 360, 10_374),
                        (24_173, 10_360, 360, 10_399),
                    ],
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(weights_alert, "post_alert", side_effect=deliver)
            )
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "log",
                    side_effect=lambda message: logs.append(message),
                )
            )
            self.assertEqual(weights_alert.main(), 0)
            self.assertNotIn(LAST_ALERT_EPOCH_KEY, state)
            self.assertEqual(
                state[INCIDENT_DELIVERY_EPOCHS_KEY]["sn71-primary"],
                {},
                "a failed webhook must leave the incident pending",
            )
            self.assertEqual(state[HEARTBEAT_KEY]["status"], "delivery_failed")
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 2)
        self.assertTrue(any(message.startswith("DELIVERY_FAILED:") for message in logs))
        self.assertTrue(any(message.startswith("ALERTED:") for message in logs))
        self.assertEqual(state[LAST_ALERT_EPOCH_KEY], 24_172)
        self.assertEqual(
            state[INCIDENT_DELIVERY_EPOCHS_KEY]["sn71-primary"],
            {"weight_update_stale:9948": 24_172},
        )
        self.assertEqual(state[HEARTBEAT_KEY]["status"], "alert_delivered")

    def test_main_delivers_late_same_epoch_incident_without_repeating_prior_validator(self):
        class FirstMetagraph:
            hotkeys = ["hotkey-primary", "hotkey-auditor"]
            coldkeys = ["coldkey-primary", "coldkey-auditor"]
            validator_permit = [True, True]
            active = [True, True]
            last_update = [9948, 10_050]

        class SecondMetagraph:
            hotkeys = ["hotkey-primary", "hotkey-auditor"]
            coldkeys = ["coldkey-primary", "coldkey-auditor"]
            validator_permit = [True, True]
            active = [True, False]
            last_update = [9948, 10_050]

        metagraphs = iter([FirstMetagraph(), SecondMetagraph()])

        class Subtensor:
            def __init__(self, network):
                self.network = network

            def metagraph(self, netuid):
                return next(metagraphs)

            def query_identity(self, coldkey):
                return types.SimpleNamespace(name="")

        registry = [
            {
                "id": "sn71-primary",
                "role": "primary",
                "label": "primary (Subnet 71)",
                "hotkey": "hotkey-primary",
                "expectedColdkey": "coldkey-primary",
            },
            {
                "id": "auditor",
                "role": "auditor",
                "label": "auditor",
                "hotkey": "hotkey-auditor",
                "expectedColdkey": "coldkey-auditor",
            },
        ]
        state = {}
        messages = []
        fake_bittensor = types.SimpleNamespace(Subtensor=Subtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "official_epoch_state",
                    side_effect=[
                        (24_173, 10_360, 360, 10_374),
                        (24_173, 10_360, 360, 10_399),
                    ],
                )
            )
            stack.enter_context(
                patch.object(weights_alert, "load_registry", return_value=registry)
            )
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(
                patch.object(
                    weights_alert,
                    "post_alert",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 2)
        self.assertIn("primary (Subnet 71)", messages[0])
        self.assertNotIn("auditor ·", messages[0])
        self.assertIn("auditor · current UID 1", messages[1])
        self.assertIn("validator inactive", messages[1])
        self.assertNotIn("primary (Subnet 71)", messages[1])
        self.assertEqual(
            state[INCIDENT_DELIVERY_EPOCHS_KEY]["auditor"],
            {"validator_inactive": 24_172},
        )

    def test_chain_failure_writes_heartbeat_without_erasing_delivery_history(self):
        class FailingSubtensor:
            def __init__(self, network):
                raise RuntimeError("RPC unavailable\nretry later")

        state = {
            HEARTBEAT_KEY: {
                "last_successful_delivery_at": "2026-07-30T20:00:00Z",
                "last_successful_delivery_epoch": 24_171,
            }
        }
        fake_bittensor = types.SimpleNamespace(Subtensor=FailingSubtensor)

        with ExitStack() as stack:
            stack.enter_context(patch.dict(sys.modules, {"bittensor": fake_bittensor}))
            stack.enter_context(
                patch.object(weights_alert, "load_state", return_value=state)
            )
            stack.enter_context(patch.object(weights_alert, "save_state"))
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)

        heartbeat = state[HEARTBEAT_KEY]
        self.assertEqual(heartbeat["status"], "chain_query_failed")
        self.assertFalse(heartbeat["chain_read_ok"])
        self.assertEqual(heartbeat["error"], "RPC unavailable retry later")
        self.assertEqual(
            heartbeat["last_successful_delivery_at"],
            "2026-07-30T20:00:00Z",
        )
        self.assertEqual(heartbeat["last_successful_delivery_epoch"], 24_171)

    def test_alert_heartbeat_preserves_delivery_timestamp_on_quiet_pass(self):
        state = {}

        with patch.object(
            weights_alert,
            "heartbeat_timestamp",
            side_effect=["2026-07-30T20:00:00Z", "2026-07-30T20:05:00Z"],
        ):
            record_heartbeat(
                state,
                "alert_delivered",
                completed_epoch_index=24_172,
            )
            record_heartbeat(
                state,
                "unresolved_already_delivered",
                completed_epoch_index=24_172,
            )

        heartbeat = state[HEARTBEAT_KEY]
        self.assertEqual(heartbeat["last_run_at"], "2026-07-30T20:05:00Z")
        self.assertEqual(
            heartbeat["last_successful_delivery_at"],
            "2026-07-30T20:00:00Z",
        )
        self.assertEqual(heartbeat["last_successful_delivery_epoch"], 24_172)


if __name__ == "__main__":
    unittest.main()
