#!/usr/bin/env bash

# Source this file from the canonical deploy. The install runs with the same
# package manifests and npm lifecycle scripts, away from the live node_modules.
production_deps_move() {
  node -e '
    const fs = require("node:fs");
    const [source, target] = process.argv.slice(1);
    try {
      fs.lstatSync(target);
      throw new Error(`Refusing to replace existing dependency path: ${target}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    fs.renameSync(source, target);
  ' "$1" "$2"
}

production_deps_stage() {
  local app_root="$1" stage="$2"
  cp "$app_root/package.json" "$app_root/package-lock.json" "$stage/"
  if [ -f "$app_root/.npmrc" ]; then
    cp "$app_root/.npmrc" "$stage/.npmrc"
  fi
  npm ci --omit=dev --no-audit --no-fund --prefix "$stage"
  npm ls --omit=dev --depth=0 --prefix "$stage" >/dev/null
}

production_deps_activate() {
  local app_root="$1" stage="$2" rollback="$3"
  if [ -e "$rollback" ] || [ ! -d "$app_root/node_modules" ] || [ ! -d "$stage/node_modules" ]; then
    echo "Cannot switch production dependencies without both complete trees" >&2
    return 1
  fi
  production_deps_move "$app_root/node_modules" "$rollback"
  production_deps_move "$stage/node_modules" "$app_root/node_modules"
}

production_deps_restore() {
  local app_root="$1" rollback="$2" discarded
  if [ ! -e "$rollback" ]; then
    return 0
  fi
  discarded="$(mktemp -d "$app_root/.node-modules-discard.XXXXXXXX")"
  if [ -e "$app_root/node_modules" ]; then
    production_deps_move "$app_root/node_modules" "$discarded/node_modules"
  fi
  if ! production_deps_move "$rollback" "$app_root/node_modules"; then
    if [ -e "$discarded/node_modules" ]; then
      production_deps_move "$discarded/node_modules" "$app_root/node_modules" || true
    fi
    echo "Could not restore the saved production dependency tree" >&2
    return 1
  fi
  rm -rf "$discarded"
}
