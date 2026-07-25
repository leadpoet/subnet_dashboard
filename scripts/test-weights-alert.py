#!/usr/bin/env python3

import sys
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import weights_alert
from weights_alert import update_incident_state


class WeightsAlertIncidentStateTest(unittest.TestCase):
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

        state = {}
        messages = []
        registry = [
            {
                "id": "leadpoet-primary",
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
        self.assertIn("404 blocks since last set", messages[0])
        self.assertEqual(
            state["leadpoet-primary"],
            ["weight_update_stale:1000"],
        )

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
