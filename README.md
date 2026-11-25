# lean-programming

A release workflow for coding agents. You keep a queue of plans. Each release runs the same steps, then the next one starts by itself:

`develop → verify → 1st review → fix → 2nd gate → fix → screenshots → merge, tag, push`

- **Three drivers:** Claude Code, Antigravity (`agy`) and Codex. One skill, one driver file each.
- **Model-tiered subagents:** small models scout and do mechanical edits, a mid model writes code, the strongest model reviews.
- **Two reviews:** a 1st review inside the run, then a 2nd gate by another vendor. The gate runs headless and read-only on a snapshot with no `.git`.
- **Project-agnostic:** every project rule (test commands, allowed and forbidden commands, push or not) is asked once and stored in `.superpowers/state.md` in your repo.

| Driver | Status |
|---|---|
| Claude Code | Used for real releases. |
| Antigravity | Used for real releases. |
| Codex | New. Gate script is tested; a full release run is not yet proven. |

## Install

The marketplace also lists the three plugins the workflow needs (`superpowers`, `ponytail`, `caveman`). They are the unmodified upstream projects at pinned commits. This project is not affiliated with them. If you already have them from another marketplace, skip those lines.

**Claude Code** (2.1 or newer), in a shell:

```bash
claude plugin marketplace add rakasatria/lean-programming
claude plugin install superpowers@lean-programming
claude plugin install ponytail@lean-programming
claude plugin install caveman@lean-programming
claude plugin install lean-programming@lean-programming
```

**Codex**, in a shell:

```bash
codex plugin marketplace add rakasatria/lean-programming
codex plugin add superpowers@lean-programming
codex plugin add ponytail@lean-programming
codex plugin add caveman@lean-programming
codex plugin add lean-programming@lean-programming
```

Codex also needs multi-agent tools: set `multi_agent = true` under `[features]` in `~/.codex/config.toml`.

**Antigravity**, in a shell:

```bash
git clone https://github.com/rakasatria/lean-programming
agy plugin install ./lean-programming/plugins/lean-programming
```

Install `superpowers`, `ponytail` and `caveman` for Antigravity from their own projects.

Restart the CLI after installing. The skill checks its prerequisites itself. If it stops on ponytail or caveman, run `/ponytail full` and `/caveman`.

## Machine prerequisites

Clone this repo and run `bash doctor.sh`. It only checks; it changes nothing.

| Need | Why |
|---|---|
| `git`, `tar`, `node` >= 20 | gate script |
| At least one of `claude`, `agy`, `codex` | the driver |
| A second one of them | the cross-vendor 2nd gate |
| `uv`, plus `uv run --with playwright python3 -m playwright install chromium` once | release screenshots |

## The 2nd gate

The 2nd gate must be a different vendor from the one that wrote the code. The script picks the reviewer:

| Driver | Reviewer, in order |
|---|---|
| Claude Code | `agy`, then `codex` |
| Antigravity | `claude`, then `codex` |
| Codex | `claude`, then `agy` |

If you have only one of the three CLIs, opt in to a same-vendor gate by setting the env variable `GATE_SAME_VENDOR=1`. In Claude Code, put this in your project's `.claude/settings.local.json` and restart the session:

```json
{ "env": { "GATE_SAME_VENDOR": "1" } }
```

Then a fresh headless session of your own CLI is the last fallback. It shares no conversation context with the session that wrote the code. Every review file names its reviewer in `Reviewer-Model:`.

## Use

Type these in your agent, in your repo root.

**New work from an idea:**
```
Use the lean-programming skill. I want to build: <one paragraph>. Brainstorm a spec into docs/superpowers/specs/, write the plan into docs/superpowers/plans/ (Task N headings, Global Constraints and Review Focus), add it to `## Queue` in .superpowers/state.md, then run the queue.
```

**Run plans that already exist:**
```
Use the lean-programming skill and `.superpowers/state.md` to complete the remaining pending releases in `## Queue` sequentially.
```

**Resume** after a crash, compaction or a new session:
```
Use the lean-programming skill: continue.
```

On the first run the skill asks one question about your project (test commands, what it may run unattended, push or not) and writes the answer to `.superpowers/state.md`.

## When it stops

- `done`: the release is merged and tagged (and pushed when your policy says `push: yes`). The next release starts.
- `blocked`: a tool, permission or forbidden command stopped it. The exact error line is shown. Fix the cause, then resume.
- `disputed`: findings are still open after the review rounds, or one needs a design decision. Decide, write the decision into your repo rule file, then resume.

## Layout

```
plugins/lean-programming/
  skills/lean-programming/SKILL.md      picks the driver
  skills/lean-programming/drivers/      claude-code.md, antigravity.md, codex.md
  skills/lean-programming/scripts/      gate-review.mjs, capture-screenshots.py, run_lean_releases.py
  claude-agents/                        role prompts (Claude Code agents; Codex reads them as text)
```

## Self-test

```bash
node --test plugins/lean-programming/skills/lean-programming/scripts/gate-review.test.mjs
```
