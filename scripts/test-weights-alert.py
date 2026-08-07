#!/usr/bin/env python3

import sys
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
                "id": "leadpoet-primary",
                "role": "primary",
                "label": "primary (Leadpoet)",
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
                    "post_discord",
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

    def test_active_state_keeps_same_incident_key_across_epoch_boundary(self):
        state = {}
        stale_incident = ["weight_update_stale:1000"]

        self.assertTrue(update_incident_state(state, "leadpoet-primary", stale_incident))
        self.assertFalse(
            update_incident_state(state, "leadpoet-primary", stale_incident),
            "active-state identity must remain stable when only age and epoch change",
        )

    def test_delivery_state_reminds_once_per_completed_epoch(self):
        deliveries = {}
        incident_keys = ["weight_update_stale:1000"]

        self.assertTrue(
            incidents_due_for_epoch(deliveries, "leadpoet-primary", incident_keys, 24_172)
        )
        mark_incidents_delivered(
            deliveries, "leadpoet-primary", incident_keys, 24_172
        )
        self.assertFalse(
            incidents_due_for_epoch(deliveries, "leadpoet-primary", incident_keys, 24_172),
            "a successful delivery must not repeat during the same completed epoch",
        )
        self.assertTrue(
            incidents_due_for_epoch(deliveries, "leadpoet-primary", incident_keys, 24_173),
            "an unresolved incident must remind after the next epoch completes",
        )

    def test_late_same_epoch_problem_does_not_redeliver_prior_incident_key(self):
        deliveries = {
            "leadpoet-primary": {"weight_update_stale:1000": 24_172}
        }
        incident_keys = ["validator_inactive", "weight_update_stale:1000"]

        self.assertEqual(
            incident_keys_due_for_epoch(
                deliveries,
                "leadpoet-primary",
                incident_keys,
                24_172,
            ),
            ["validator_inactive"],
        )

    def test_legacy_active_incidents_seed_delivery_epoch_without_replay(self):
        state = {
            "leadpoet-primary": ["weight_update_stale:1000"],
            LAST_ALERT_EPOCH_KEY: 24_172,
        }

        deliveries = incident_delivery_epochs(state)

        self.assertEqual(
            deliveries,
            {"leadpoet-primary": {"weight_update_stale:1000": 24_172}},
        )
        self.assertEqual(state[INCIDENT_DELIVERY_EPOCHS_KEY], deliveries)
        self.assertFalse(
            incidents_due_for_epoch(
                deliveries,
                "leadpoet-primary",
                ["weight_update_stale:1000"],
                24_172,
            )
        )
        self.assertTrue(
            incidents_due_for_epoch(
                deliveries,
                "leadpoet-primary",
                ["weight_update_stale:1000"],
                24_173,
            )
        )

    def test_recovery_prunes_delivery_state_for_recurrence(self):
        deliveries = {
            "leadpoet-primary": {"weight_update_stale:1000": 24_172}
        }

        sync_incident_delivery_epochs(deliveries, "leadpoet-primary", [])
        self.assertNotIn("leadpoet-primary", deliveries)

        sync_incident_delivery_epochs(
            deliveries,
            "leadpoet-primary",
            ["weight_update_stale:1000"],
        )
        self.assertTrue(
            incidents_due_for_epoch(
                deliveries,
                "leadpoet-primary",
                ["weight_update_stale:1000"],
                24_172,
            ),
            "a recovered incident that recurs must page even in the same epoch",
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
                return types.SimpleNamespace(name="Leadpoet")

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
                    "post_discord",
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
            state[INCIDENT_DELIVERY_EPOCHS_KEY]["leadpoet-primary"],
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
                return types.SimpleNamespace(name="Leadpoet")

        registry = [
            {
                "id": "leadpoet-primary",
                "role": "primary",
                "label": "primary (Leadpoet)",
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
                patch.object(weights_alert, "post_discord", side_effect=deliver)
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
                state[INCIDENT_DELIVERY_EPOCHS_KEY]["leadpoet-primary"],
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
            state[INCIDENT_DELIVERY_EPOCHS_KEY]["leadpoet-primary"],
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
                "id": "leadpoet-primary",
                "role": "primary",
                "label": "primary (Leadpoet)",
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
                    "post_discord",
                    side_effect=lambda content: messages.append(content) or True,
                )
            )
            stack.enter_context(patch.object(weights_alert, "log"))
            self.assertEqual(weights_alert.main(), 0)
            self.assertEqual(weights_alert.main(), 0)

        self.assertEqual(len(messages), 2)
        self.assertIn("primary (Leadpoet)", messages[0])
        self.assertNotIn("auditor ·", messages[0])
        self.assertIn("auditor · current UID 1", messages[1])
        self.assertIn("validator inactive", messages[1])
        self.assertNotIn("primary (Leadpoet)", messages[1])
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
