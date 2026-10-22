#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/production-dependencies.sh"
fixture="$(mktemp -d "$(pwd)/.production-deps-test.XXXXXXXX")"
live_pid=""
cleanup() {
  if [ -n "$live_pid" ]; then
    kill "$live_pid" 2>/dev/null || true
    wait "$live_pid" 2>/dev/null || true
  fi
  rm -rf "$fixture"
}
trap cleanup EXIT

app="$fixture/app"
rollback="$app/.subnet-dashboard-rollback-node-modules"
mkdir -p "$app/node_modules" "$fixture/bin"
printf '{"name":"fixture","version":"1.0.0"}\n' > "$app/package.json"
printf '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n' > "$app/package-lock.json"
printf 'old-tree\n' > "$app/node_modules/identity"
printf 'blue\n' > "$app/active-slot"
printf 'old-node\n' > "$app/active-runtime"

cat > "$fixture/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
command="$1"
shift
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then
    prefix="$2"
    break
  fi
  shift
done
if [ "$command" = ci ]; then
  if [ "${INJECT_INSTALL_FAILURE:-}" = 1 ]; then
    exit 17
  fi
  mkdir -p "$prefix/node_modules/next"
  printf 'new-tree\n' > "$prefix/node_modules/identity"
  printf '{"name":"next","version":"fixture"}\n' > "$prefix/node_modules/next/package.json"
elif [ "$command" = ls ]; then
  test -f "$prefix/node_modules/next/package.json"
else
  exit 2
fi
EOF
chmod 700 "$fixture/bin/npm"
export PATH="$fixture/bin:$PATH"

# A failed private install must leave the active tree and process untouched.
node -e 'setInterval(() => {}, 1000)' &
live_pid="$!"
failed_stage="$fixture/failed-install"
mkdir "$failed_stage"
if INJECT_INSTALL_FAILURE=1 production_deps_stage "$app" "$failed_stage"; then
  echo "Injected npm ci failure unexpectedly passed" >&2
  exit 1
fi
test "$(cat "$app/node_modules/identity")" = old-tree
test ! -e "$rollback"
kill -0 "$live_pid"
test "$(cat "$app/active-slot")" = blue
test "$(cat "$app/active-runtime")" = old-node

# A failed promotion restores the original tree before the old slot/runtime.
for attempt in 1 2; do
  stage="$fixture/stage-$attempt"
  mkdir "$stage"
  production_deps_stage "$app" "$stage"
  production_deps_activate "$app" "$stage" "$rollback"
  test "$(cat "$app/node_modules/identity")" = new-tree
  test "$(cat "$rollback/identity")" = old-tree
  printf 'green\n' > "$app/active-slot"
  printf 'new-node\n' > "$app/active-runtime"
  production_deps_restore "$app" "$rollback"
  printf 'blue\n' > "$app/active-slot"
  printf 'old-node\n' > "$app/active-runtime"
  test "$(cat "$app/node_modules/identity")" = old-tree
  test "$(cat "$app/active-slot")" = blue
  test "$(cat "$app/active-runtime")" = old-node
  test ! -e "$rollback"
  kill -0 "$live_pid"
done

echo "production-dependencies: failed install, failed promotion, and same-slot retry passed"
