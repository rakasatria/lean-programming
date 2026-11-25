---
name: lean-programming
description: >
  Use when executing a multi-task feature, release plan, or roadmap that needs
  low-token, model-tiered subagent execution with an independent second-gate
  review before merge and tag. Works under Claude Code, Antigravity (agy) and Codex.
---

# Lean Programming

One workflow, three drivers. The driver is the agent CLI you are running in. Each driver has its own file, because the tools for subagents differ.

`<skill-dir>` = the folder this `SKILL.md` was loaded from. Under Claude Code that is `${CLAUDE_SKILL_DIR}`, also shown as `Base directory for this skill:`. Pass it to every subagent as `skill-dir`.

## Pick your driver

Read exactly ONE file, then follow it as this skill. Do not read the other two.

| You are running in | How to tell | Read |
|---|---|---|
| Claude Code | you have the `Agent` tool; env `CLAUDECODE` is set | `<skill-dir>/drivers/claude-code.md` |
| Antigravity (`agy`) | you have `invoke_subagent` and `run_workflow`; env `ANTIGRAVITY_TRAJECTORY_ID` is set | `<skill-dir>/drivers/antigravity.md` |
| Codex | you have `spawn_agent`; env `CODEX_THREAD_ID` is set | `<skill-dir>/drivers/codex.md` |

None of the three matches: stop and tell the user this skill has no driver for this CLI.

## The same in every driver

- Release order: `develop → verify → 1st review → fix → 2nd gate → fix → screenshots → merge, tag, push → next release`.
- State: `.superpowers/state.md` in the repo holds `## Project Policy` and `## Queue`. Specs, plans, reviews and reports live in `docs/superpowers/`.
- 2nd gate: `node <skill-dir>/scripts/gate-review.mjs`. It picks a reviewer from another vendor by itself. Its last `GateStatus:` line is the only result.
- Receipt per release: `status | release | commit | tag | tests | shots | gate_rounds | notes`, with `status` one of `done`, `blocked`, `disputed`.
