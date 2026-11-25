#!/usr/bin/env bash
# Checks the machine-level prerequisites of lean-programming. Changes nothing.
bad=0
has() { command -v "$1" >/dev/null 2>&1; }
need() { if has "$1"; then echo "ok       $1"; else echo "MISSING  $1  ($2)"; bad=1; fi; }
need git "version control"
need tar "gate snapshot"
need uv "release screenshots; then: uv run --with playwright python3 -m playwright install chromium"
if has node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then echo "ok       node >= 20"; else echo "MISSING  node >= 20  (gate script)"; bad=1; fi
n=0
for cli in claude agy codex; do
  if has "$cli"; then echo "ok       $cli"; n=$((n + 1)); else echo "absent   $cli"; fi
done
if [ "$n" -eq 0 ]; then echo "MISSING  a driver: install claude, agy or codex"; bad=1; fi
if [ "$n" -eq 1 ]; then echo "note     one CLI only: set GATE_SAME_VENDOR=1 (see README) so a fresh session of it is the 2nd gate"; fi
exit $bad
