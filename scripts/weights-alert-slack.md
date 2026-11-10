# SN71 missed-weight alerts in Slack

The validator's existing cron monitor is `~/weights_alert.py`, run by
`~/alert_venv/bin/python`. It reads one destination from
`~/.config/leadpoet/weights_alert_webhook`. It supports official Slack incoming
webhooks and the existing Discord webhooks. It does not send to both.

The Leadpoet destination is private **#lab-bugs** (`C0CFNCTKN3V`) in workspace
`T09LJDCSA4W`. The dedicated **Leadpoet Lab Alerts** app needs only
`incoming-webhook`; it needs no message history, member access, or bot token.
An authorized workspace member selects this private channel during installation.
Keep the generated URL out of Git, tickets, chat, terminal history and logs.

## Deploy the sender

1. Review and merge the sender change through the repository's normal PR process.
   Subnet merges require the user's approval. The existing `Deploy` workflow's
   **Deploy weights alert to validator** job installs the monitor atomically and
   preserves its webhook, cron schedule and incident state.
2. Verify that job passed for the intended release. From a clean checkout of that
   release, calculate `sha256sum scripts/weights_alert.py`.
3. Use the existing approved LabOperator access in AWS account `493765492819`,
   `us-east-1`, and the validator's Session Manager/SSH path
   (`i-07ab2b90c537d0f28`). Follow the production-access runbook in
   `leadpoet/leadpoet/docs/production-access.md`; do not change IAM or use root.
   Run the following as **ec2-user** on the validator, not the dashboard host.
4. Verify `~/weights_alert_deploy_sha` equals the approved release and
   `sha256sum ~/weights_alert.py` equals the clean release's digest. Confirm the
   existing cron still invokes `~/alert_venv/bin/python ~/weights_alert.py`.

## Test and switch one destination

The following procedure sends one labelled test to the candidate Slack webhook
before replacing the active URL. A failed test leaves the Discord destination
unchanged. It writes a protected rollback copy and never edits incident state.
Paste the URL only at the hidden prompt; do not place it in a shell argument.
If a rollback file already exists, stop and inspect the prior switch first.

```bash
cd /home/ec2-user
~/alert_venv/bin/python - <<'PY'
import getpass
import os
from pathlib import Path
import tempfile
import warnings
import weights_alert as monitor

warnings.simplefilter("error", getpass.GetPassWarning)
if getpass.getuser() != "ec2-user":
    raise SystemExit("Run as ec2-user on the validator.")
target = Path(monitor.WEBHOOK_FILE)
backup = target.with_name(target.name + ".before-slack")
if target.is_symlink() or not target.is_file() or backup.exists():
    raise SystemExit("Expected an existing regular webhook file and no prior backup.")
previous = target.read_text().strip()
if not monitor.webhook_provider(previous):
    raise SystemExit("Existing destination is not a supported webhook; stop and inspect.")
candidate = getpass.getpass("Slack webhook for private #lab-bugs (hidden): ").strip()
if monitor.webhook_provider(candidate) != "slack":
    raise SystemExit("Not a supported Slack webhook.")
if candidate.split("/")[4] != "T09LJDCSA4W":
    raise SystemExit("Webhook is not for the Leadpoet workspace.")
if not monitor.post_alert(
    "SN71 missed-weight monitor — connection test only. "
    "This verifies delivery to private #lab-bugs; no incident was generated.",
    url=candidate,
):
    raise SystemExit("Slack did not acknowledge the test; destination unchanged.")

fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write(previous + "\n")
    handle.flush()
    os.fsync(handle.fileno())
fd, pending = tempfile.mkstemp(prefix=".weights-webhook-", dir=target.parent)
try:
    with os.fdopen(fd, "w") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(candidate + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(pending, target)
finally:
    if os.path.exists(pending):
        os.unlink(pending)
print("Slack acknowledged the test; destination switched. Incident state preserved.")
PY
```

Verify the labelled test appears in **#lab-bugs** under **Leadpoet Lab Alerts**.
Check the next normal cron run's heartbeat and log without exposing the webhook.
`weights_alert_state.json` retains its incident delivery epochs, so a reminder
already delivered to Discord is not replayed immediately. The next newly
completed epoch with unresolved misses produces the next reminder in Slack.
Do not delete state or fabricate a missed-weight incident to force a test.

`~/alert_venv/bin/python ~/weights_alert.py --test` is available for subsequent
explicitly requested delivery checks. It returns nonzero if delivery fails and
does not change incident state.

## Rollback

Keep the compatible sender code deployed. As ec2-user on the validator, verify
the protected `weights_alert_webhook.before-slack` file exists, then restore the
previous destination atomically:

```bash
set -euo pipefail
cd ~/.config/leadpoet
test -f weights_alert_webhook.before-slack
test ! -L weights_alert_webhook.before-slack
install -m 0600 weights_alert_webhook.before-slack weights_alert_webhook.rollback
mv weights_alert_webhook.rollback weights_alert_webhook
```

Leave cron, registry, state and validator services unchanged. Do not post the
backup URL or its contents in an incident report.
