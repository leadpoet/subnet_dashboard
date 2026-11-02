#!/usr/bin/env bash
# Forward a local port to SSH on an EC2 instance through Session Manager.
# Production security groups have no inbound port 22; deploys reach sshd only
# through this IAM-authorized tunnel.
#
#   ssm-ssh-tunnel.sh open <instance-id> <local-port>
#   ssm-ssh-tunnel.sh close
set -euo pipefail

state_dir="${SSM_TUNNEL_STATE_DIR:-${RUNNER_TEMP:-/tmp}/ssm-ssh-tunnel}"
log="$state_dir/session.log"
pid_file="$state_dir/session.pid"

ssh_banner() {
  timeout 5 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1" && IFS= read -r line <&3 && printf "%s" "$line"' _ "$1" 2>/dev/null
}

open_tunnel() {
  local instance_id="$1" local_port="$2" tunnel_pid banner
  mkdir -p "$state_dir"
  session-manager-plugin --version
  aws ssm start-session \
    --target "$instance_id" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "portNumber=22,localPortNumber=$local_port" \
    >"$log" 2>&1 </dev/null &
  tunnel_pid="$!"
  printf '%s\n' "$tunnel_pid" >"$pid_file"

  for _ in $(seq 1 30); do
    banner="$(ssh_banner "$local_port" || true)"
    if [[ "$banner" == SSH-2.0-* ]]; then
      echo "SSH on $instance_id answers through Session Manager at 127.0.0.1:$local_port"
      return 0
    fi
    if ! kill -0 "$tunnel_pid" 2>/dev/null; then
      echo "The Session Manager tunnel to $instance_id exited"
      cat "$log"
      return 1
    fi
    sleep 2
  done
  echo "SSH on $instance_id did not answer through the Session Manager tunnel"
  cat "$log"
  return 1
}

close_tunnel() {
  local session_id
  [ -f "$pid_file" ] || return 0
  session_id="$(sed -n 's/^Starting session with SessionId: //p' "$log" | head -n 1 | tr -d '\r')"
  if [ -n "$session_id" ]; then
    aws ssm terminate-session --session-id "$session_id" >/dev/null || \
      echo "Could not terminate Session Manager session $session_id"
  fi
  kill "$(cat "$pid_file")" 2>/dev/null || true
  rm -rf "$state_dir"
}

case "${1:-}" in
  open)
    [ "$#" -eq 3 ] || { echo "usage: $0 open <instance-id> <local-port>" >&2; exit 2; }
    open_tunnel "$2" "$3"
    ;;
  close)
    close_tunnel
    ;;
  *)
    echo "usage: $0 open <instance-id> <local-port> | close" >&2
    exit 2
    ;;
esac
