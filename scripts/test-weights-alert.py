#!/usr/bin/env python3

import sys
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import weights_alert
from weights_alert import (
    EPOCH_OBSERVATION_KEY,
    LAST_ALERT_EPOCH_KEY,
    claim_epoch_alert,
    display_label,
    observe_completed_epoch,
    query_identity_name,
    safe_identity_name,
    update_incident_state,
)


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
                "id": "leadpoet-primary",
                "role": "primary",
                "label": "primary (Leadpoet)",
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
                    "post_discord",
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
        self.assertIn("primary (Leadpoet)", messages[0])
        self.assertIn("auditor (TAO.com)", messages[0])
        self.assertIn("426 blocks since last set", messages[0])
        self.assertIn("427 blocks since last set", messages[0])
        self.assertEqual(state[LAST_ALERT_EPOCH_KEY], 24_172)

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

    def test_main_does_not_realert_404_to_430_block_epoch_transition(self):
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
                return types.SimpleNamespace(name="Leadpoet")

        state = {}
        messages = []
        registry = [
            {
                "id": "leadpoet-primary",
                "role": "primary",
                "label": "primary (Leadpoet)",
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
                    "post_discord",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 1)
        self.assertIn("official epoch 24090 completed", messages[0])
        self.assertIn("430 blocks since last set", messages[0])
        self.assertIn("primary (Leadpoet)", messages[0])
        self.assertEqual(
            state["leadpoet-primary"],
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
                    "post_discord",
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

    def test_stale_update_does_not_realert_after_epoch_boundary(self):
        state = {}
        stale_incident = ["weight_update_stale:1000"]

        self.assertTrue(update_incident_state(state, "leadpoet-primary", stale_incident))
        self.assertFalse(
            update_incident_state(state, "leadpoet-primary", stale_incident),
            "the same last-set block must stay deduped when only its age and epoch change",
        )

    def test_new_last_set_block_creates_a_new_stale_episode(self):
        state = {"leadpoet-primary": ["weight_update_stale:1000"]}

        self.assertTrue(
            update_incident_state(
                state,
                "leadpoet-primary",
                ["weight_update_stale:1360"],
            )
        )

    def test_recovery_clears_incident_for_a_later_recurrence(self):
        state = {"leadpoet-primary": ["weight_update_stale:1000"]}

        self.assertFalse(update_incident_state(state, "leadpoet-primary", []))
        self.assertNotIn("leadpoet-primary", state)
        self.assertTrue(
            update_incident_state(
                state,
                "leadpoet-primary",
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
        state = {"leadpoet-primary": 24091}

        self.assertFalse(
            update_incident_state(
                state,
                "leadpoet-primary",
                ["weight_update_stale:1000"],
            )
        )
        self.assertEqual(
            state["leadpoet-primary"],
            ["weight_update_stale:1000"],
        )


if __name__ == "__main__":
    unittest.main()
