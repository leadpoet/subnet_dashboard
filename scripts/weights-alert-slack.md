# SN71 missed-weight alerts in Slack

This monitor reads public Bittensor on-chain epoch and validator data. It does
not inspect the gateway to decide whether a validator missed an epoch.
The existing validator cron runs `~/weights_alert.py` using
`~/alert_venv/bin/python`. Keep one monitor, one schedule and its existing
incident state.

## Destination and secret

The destination is private **#lab-bugs** (`C0CFNCTKN3V`) in Leadpoet workspace
`T09LJDCSA4W`. **Leadpoet Lab Alerts** needs only `incoming-webhook`; it does not
need message history, member access or a bot token. Verify the app's incoming
webhook table names this private channel before configuring it.

Store that approved URL as the **WEIGHTS_ALERT_WEBHOOK** Actions repository
secret in `leadpoet/subnet_dashboard`. Use GitHub's secret UI or the
[GitHub CLI's secret input](https://cli.github.com/manual/gh_secret_set).
Never place the URL in source, a PR, logs or a shell command argument.
The existing deployment already has the approved host credentials; no local
AWS profile, SSH key, new IAM permissions or separate relay is required.

## Normal deployment

1. Review and merge the change through the normal PR process. Subnet merges
   still require the user's approval.
2. The existing **Deploy weights alert to validator** job installs the exact
   reviewed script and registry on validator `i-07ab2b90c537d0f28`, AWS account
   `493765492819`, `us-east-1`, through its existing SSH-over-SSM connection.
3. The optional secret is passed as an environment variable to the reviewed
   configuration command. An absent or unchanged secret is a no-op and sends
   no test. A changed candidate must be an official Slack webhook for the
   configured workspace.
4. The monitor sends one clearly labelled connection test. Only Slack's
   successful acknowledgement permits the atomic mode-0600 destination switch.
   The immediately previous destination is retained in a protected rollback
   file. A failed test keeps the current destination and fails the job.
5. Verify the job succeeded for the approved release and that the test appears
   under **Leadpoet Lab Alerts** in private **#lab-bugs**. Do not call the
   migration complete based only on CI success.

Later webhook rotations use the same repository secret and normal deployment.
The monitor reads `~/.config/leadpoet/weights_alert_webhook` on each pass, so it
needs no service restart. The deployment leaves cron, chain reads, registry
contents and incident state unchanged.

Previously delivered Discord incidents are not replayed. The next newly
completed epoch with an unresolved miss produces the next reminder in Slack.
Do not delete state or fabricate an incident to force a message.

## Delivery checks and rollback

The configuration path already sends the one migration test. For a separately
requested later test, `~/alert_venv/bin/python ~/weights_alert.py --test` returns
nonzero on failure and does not change incident state.

If activation fails before the destination switch, the compatible sender keeps
using the prior destination. Diagnose the named failed workflow step without
printing credentials. Do not repeatedly rerun a failed test without changing
its failed prerequisite.

For an explicitly authorized rollback after a completed switch, first remove
or replace the Actions secret so a later deployment does not undo the rollback.
An existing approved LabOperator can restore the protected local backup through
the production-access runbook in `leadpoet/leadpoet/docs/production-access.md`.
As ec2-user on the validator:

```bash
set -euo pipefail
cd ~/.config/leadpoet
test -f weights_alert_webhook.before-slack
test ! -L weights_alert_webhook.before-slack
install -m 0600 weights_alert_webhook.before-slack weights_alert_webhook.rollback
mv weights_alert_webhook.rollback weights_alert_webhook
```

Leave cron, registry, state and validator services unchanged. Never print the
backup URL or include it in an incident report.
