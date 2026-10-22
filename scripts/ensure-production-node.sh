#!/usr/bin/env bash
set -Eeuo pipefail

# Keep the dashboard worker on one verified Node release. Never replace an
# installed runtime: PM2 rollback may still need the previous application slot.
node_version=22.23.4
if [ "$(uname -s)" != Linux ]; then
  echo "Production Node installer requires Linux" >&2
  exit 1
fi
case "$(uname -m)" in
  x86_64)
    node_arch=x64
    archive_sha256=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
    ;;
  aarch64)
    node_arch=arm64
    archive_sha256=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b
    ;;
  *)
    echo "Unsupported production Node architecture" >&2
    exit 1
    ;;
esac

runtime_root="${NODE_RUNTIME_ROOT:-$HOME/.local/leadpoet-node}"
runtime_dir="$runtime_root/v${node_version}-linux-${node_arch}"
node_bin="$runtime_dir/bin/node"
mkdir -p "$runtime_root"
# A retried deploy may overlap an earlier SSH action. Only one installer may
# publish this immutable runtime, and the lock applies to this release only.
exec 9>"$runtime_root/.v${node_version}-linux-${node_arch}.lock"
flock -w 180 9
if [ -e "$runtime_dir" ]; then
  if [ ! -x "$node_bin" ] || [ "$("$node_bin" --version)" != "v$node_version" ]; then
    echo "Existing production Node runtime is invalid: $runtime_dir" >&2
    exit 1
  fi
  printf '%s\n' "$node_bin"
  exit 0
fi

staging="$(mktemp -d "$runtime_root/.node-v${node_version}.XXXXXXXX")"
trap 'rm -rf -- "$staging"' EXIT
archive="node-v${node_version}-linux-${node_arch}.tar.xz"
curl --fail --location --silent --show-error --retry 3 \
  --connect-timeout 10 --max-time 180 \
  "https://nodejs.org/dist/v${node_version}/${archive}" \
  --output "$staging/$archive"
printf '%s  %s\n' "$archive_sha256" "$staging/$archive" | sha256sum --check --status
mkdir "$staging/runtime"
tar -xJf "$staging/$archive" -C "$staging/runtime" --strip-components=1
if [ "$("$staging/runtime/bin/node" --version)" != "v$node_version" ]; then
  echo "Verified archive did not provide Node v$node_version" >&2
  exit 1
fi
# -T prevents a raced destination from nesting the extracted tree inside it.
# -n leaves any existing published runtime intact for verification below.
mv -Tn "$staging/runtime" "$runtime_dir"
if [ ! -x "$node_bin" ] || [ "$("$node_bin" --version)" != "v$node_version" ]; then
  echo "Production Node installation failed" >&2
  exit 1
fi
printf '%s\n' "$node_bin"
