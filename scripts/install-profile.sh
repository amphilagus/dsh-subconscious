#!/usr/bin/env bash
# Install (or update) this bundle into a dsh profile through `dsh plugin`,
# and copy the 双重意识 preset into $DSH_HOME/.agent-presets/double-conscious.
#
# Usage: scripts/install-profile.sh [profile-name]   (default: web)
set -euo pipefail
PROFILE="${1:-web}"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$PLUGIN_DIR/lib/index.mjs" ]; then
  echo "lib/index.mjs missing — building first..."
  (cd "$PLUGIN_DIR" && pnpm run build)
fi

copy_preset() {
  local home="${DSH_HOME:-}"
  if [ -z "$home" ]; then
    if [ -d "$PLUGIN_DIR/../.dsh" ]; then
      home="$(cd "$PLUGIN_DIR/../.dsh" && pwd)"
    else
      home="$HOME/.dsh"
    fi
  fi
  local dest="$home/.agent-presets/double-conscious"
  mkdir -p "$dest"
  cp -R "$PLUGIN_DIR/preset/." "$dest/"
  echo "preset copied -> $dest"
}

if ! command -v dsh >/dev/null 2>&1; then
  if [ -n "${DSH_CHECKOUT:-}" ]; then
    DSH_CHECKOUT="$(cd "$DSH_CHECKOUT" && pwd)"
  elif [ -f "$PLUGIN_DIR/../deepseek-harness/package.json" ]; then
    DSH_CHECKOUT="$(cd "$PLUGIN_DIR/../deepseek-harness" && pwd)"
  elif [ -f "$PLUGIN_DIR/../../../dc-harness/deepseek-harness/package.json" ]; then
    DSH_CHECKOUT="$(cd "$PLUGIN_DIR/../../../dc-harness/deepseek-harness" && pwd)"
  else
    DSH_CHECKOUT=""
  fi
  if [ -n "$DSH_CHECKOUT" ] && [ -f "$DSH_CHECKOUT/package.json" ]; then
    echo "linking $PLUGIN_DIR into profile '$PROFILE' (via DSH checkout launcher)..."
    # tsx lives in the checkout's node_modules; resolve from there, not this package.
    (cd "$DSH_CHECKOUT" && pnpm dsh plugin --profile "$PROFILE" add "link:$PLUGIN_DIR")
    copy_preset
    exit 0
  fi
  echo "error: 'dsh' not found on PATH and no DSH checkout beside this package" >&2
  exit 127
fi

echo "linking $PLUGIN_DIR into profile '$PROFILE'..."
dsh plugin --profile "$PROFILE" add "link:$PLUGIN_DIR"
copy_preset
