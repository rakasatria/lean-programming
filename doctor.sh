#!/usr/bin/env bash
# Checks the machine-level prerequisites of lean-programming. Changes nothing.
bad=0
need() { command -v "$1" >/dev/null 2>&1 && echo "ok       $1" || { echo "MISSING  $1  ($2)"; bad=1; }; }
opt()  { command -v "$1" >/dev/null 2>&1 && echo "ok       $1" || echo "optional $1  ($2)"; }
need git "version control"
need tar "gate snapshot"
need claude "Claude Code CLI; also the 2nd-gate reviewer when GATE_SAME_VENDOR=1"
need uv "release screenshots; then: uv run --with playwright python3 -m playwright install chromium"
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then echo "ok       node >= 20"; else echo "MISSING  node >= 20"; bad=1; fi
opt agy "cross-vendor 2nd gate, first choice"
opt codex "cross-vendor 2nd gate, fallback"
if ! command -v agy >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1; then
  echo "note     no agy/codex: set GATE_SAME_VENDOR=1 (see README) so a fresh Fable session is the 2nd gate"
fi
exit $bad
