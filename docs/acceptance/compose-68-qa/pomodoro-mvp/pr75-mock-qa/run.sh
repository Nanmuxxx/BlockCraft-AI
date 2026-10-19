#!/bin/zsh
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
SNAP='/tmp/bc-qa-pr75-vsZnGw'
for view in desktop mobile; do
 env PATH="$PATH" HOME="$(mktemp -d)" TMPDIR="${TMPDIR:-/tmp}" NODE_OPTIONS="--import=$ROOT/../integrated-gateway-mock/deny-external.mjs" QA_SNAPSHOT="/tmp/bc-qa-pr75-vsZnGw" QA_VIEWPORT="$view" QA_EVIDENCE="$ROOT/$view" node "$ROOT/gateway-browser.mjs" >"$ROOT/$view.log" 2>&1
 echo "$view:$?"
done
