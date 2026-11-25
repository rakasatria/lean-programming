# lean-programming

A release workflow for Claude Code. You keep a queue of plans. Each release runs the same steps, then the next one starts by itself:

`develop → verify → 1st review (Fable) → fix → 2nd gate → fix → screenshots → merge, tag, push`

- **Model-pinned subagents:** runner and coder on Sonnet, scout and mechanical edits on Haiku, reviewers on Fable.
- **Two reviews:** a Fable 1st review inside the run, then an independent 2nd gate that runs headless and read-only on a snapshot with no `.git`.
- **Project-agnostic:** every project rule (test commands, allowed and forbidden commands, push or not) is asked once and stored in `.superpowers/state.md` in your repo.

## Install

In Claude Code:

```
/plugin marketplace add rakasatria/lean-programming
/plugin install superpowers@lean-programming
/plugin install ponytail@lean-programming
/plugin install caveman@lean-programming
/plugin install lean-programming@lean-programming
```

The first three are prerequisites, pinned to the versions this workflow was tested with. If you already have them from another marketplace, skip those lines.

Restart Claude Code. The session start must show `PONYTAIL MODE ACTIVE — level: full` and `CAVEMAN MODE ACTIVE`. If it does not, run `/ponytail full` and `/caveman`.

## Machine prerequisites

Clone this repo and run `bash doctor.sh`. It only checks; it changes nothing.

| Need | Why |
|---|---|
| `git`, `tar`, `node` >= 20 | gate script |
| `claude` CLI with access to Fable (`claude-fable-5-2`) | both reviewers |
| `uv`, plus `uv run --with playwright python3 -m playwright install chromium` once | release screenshots |
| `agy` and/or `codex` (optional) | cross-vendor 2nd gate |

## The 2nd gate

By default the 2nd gate must be a different vendor from the one that wrote the code: `agy` first, `codex` as fallback. A Claude reviewer is refused.

If you only have Claude Code, opt in to a same-vendor gate. Put this in your project's `.claude/settings.local.json`:

```json
{ "env": { "GATE_SAME_VENDOR": "1" } }
```

Then a fresh headless Fable session is the last fallback after `agy` and `codex`. It shares no context with the session that wrote the code. Every review file names its reviewer in `Reviewer-Model:`.

## Use

Type these in Claude Code, in your repo root.

**New work from an idea:**
```
Use the lean-programming skill. I want to build: <one paragraph>. Brainstorm a spec into docs/superpowers/specs/, write the plan into docs/superpowers/plans/ (Task N headings, Global Constraints and Review Focus), add it to `## Queue` in .superpowers/state.md, then run the queue.
```

**Run plans that already exist:**
```
Use the lean-programming skill and `.superpowers/state.md` to complete the remaining pending releases in `## Queue` sequentially.
```

**Resume** after a crash, compaction or a new session: `continue`.

On the first run the skill asks one question about your project (test commands, what it may run unattended, push or not) and writes the answer to `.superpowers/state.md`.

## When it stops

- `done`: the release is merged and tagged (and pushed when your policy says `push: yes`). The next release starts.
- `blocked`: a tool, permission or forbidden command stopped it. The exact error line is shown. Fix the cause, then say `continue`.
- `disputed`: findings are still open after the review rounds, or one needs a design decision. Decide, write the decision into your repo rule file, then say `continue`.

## Self-test

```
node --test plugins/lean-programming/skills/lean-programming/scripts/gate-review.test.mjs
```
