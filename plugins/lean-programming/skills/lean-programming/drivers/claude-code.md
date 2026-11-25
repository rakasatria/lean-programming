# Lean Programming: `Claude Code` driver

Ultracave discipline. No filler, no praise, no polling crons. Follow `ponytail` (minimum complete change) and `caveman` (terse output, exact technical identifiers).

## Prerequisites (check once, before Step 0)
| Need | Check | If missing |
|---|---|---|
| `superpowers` plugin | `superpowers:*` skills are listed | Stop. Ask the user to install it. |
| `ponytail` plugin, level `full` | Session shows `PONYTAIL MODE ACTIVE — level: full` | Level differs: tell the user to run `/ponytail full`. Plugin missing: stop. |
| `caveman` plugin | Session shows `CAVEMAN MODE ACTIVE` | Tell the user to run `/caveman`. Plugin missing: stop. |
| `node` >= 20, `git`, `tar` | `node --version` | Stop. Report the missing tool. |
| Reviewer CLIs `agy` (primary) and `codex` (fallback) | `command -v agy codex` | Both missing and env `GATE_SAME_VENDOR` is not `1`: stop, the 2nd gate cannot run. Both missing and `GATE_SAME_VENDOR=1`: continue; the 2nd gate is a fresh headless Fable session (`claude -p`, read-only). One missing: tell the user, continue. |

Never continue without a prerequisite and never substitute another tool for one.

## Step 0: Lock Folder & Plan First
Verify/create before touching code:
```text
docs/superpowers/{specs,plans,reviews,reports}
.superpowers/{sdd,gate,state.md}
```
- Ensure `.superpowers/` is in `.gitignore`.
- No spec yet → invoke `superpowers:brainstorming`, save to `docs/superpowers/specs/`.
- Spec ready, no plan → invoke `superpowers:writing-plans`, save to `docs/superpowers/plans/`.
- Existing plan in another folder: skip `brainstorming` & `writing-plans`. Pass its path directly as `<PLAN>` when it has `Task N` headings and at least one `Review Focus` or `Global Constraints` heading or bullet (`- **Review Focus:** ...`). Otherwise import/normalize a copy into `docs/superpowers/plans/` first. The gate exits `2` on a plan with no review criteria.
- **Project policy (ask once, before the loop).** The skill is project-agnostic; every project rule lives in the repo. Read the repo rule files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README`, `Makefile`) and write `## Project Policy` into `.superpowers/state.md`:
  - `constraints:` path of the repo rule file (passed to runners and to the gate as `--constraints`), or `none`.
  - `verify:` the exact test/lint/build commands.
  - `allowed:` state-changing commands runners may run unattended (start/restart services, migrate, seed, deploy to a local stack).
  - `forbidden:` commands runners must never run.
  - `merge-into:` the branch releases merge into.
  - `push:` `yes` (after each release push the `merge-into` branch and the release tag to `origin`; never force-push) or `never`. Ask the user; no answer = `never`.
  Ask the user **one** question listing every state-changing command the plans need, and record the answer under `allowed:` / `forbidden:`. A command in neither list is forbidden. Runners return `blocked` naming the command; they never ask and never guess.

## Step 1: Continuous Controller Loop
Never execute a release inline in the main chat. The controller only keeps the queue, dispatches runners and reads receipts.

One release, always in this order, then the next release starts by itself until the last plan:
`develop → verify → 1st review (Fable) → fix → 2nd gate (agy, else codex, else fresh Fable) → fix → screenshots → merge, tag, push → next release`

Queue format in `.superpowers/state.md`, under `## Queue`, one line per release, in execution order:
```text
<slug> | <plan path> | <build|gate-only> | <standard|high> | pending
<slug> | done | <sha7> | <tag> | <tests> | shots=<n>
```

1. **Queue.** No `## Queue` yet: write one `pending` line for every release plan in scope, in order, through the last plan. `gate-only` = implementation already committed; `build` = nothing implemented yet. `high` only for auth, crypto, authorization or concurrency/SQL-race releases.
2. **Dispatch.** Take the first `pending` line. Dispatch **one fresh `lean-programming:release-runner` (`sonnet`)** via `Agent`. Pass ONLY: `skill-dir`, slug, plan path, `.superpowers/state.md` path, repo constraints path (if any), `mode`, `risk`.
3. **Receipt.** Wait for the runner. Act on its `status` only:

| `status` | Meaning | Controller action |
|---|---|---|
| `done` | Gate approved, merged, tagged, pushed (when policy `push: yes`). The runner replaced its Queue line with the `done` form. | Go to 2 at once. Do not ask the user. Do not summarize between releases. |
| `blocked` | A tool, permission, prerequisite or forbidden command stopped the runner. | Stop. Report `<=3` lines with the exact error line. |
| `disputed` | Findings still open after Round 2, or a finding needs a design decision. | Stop. Report `<=3` lines. |

4. **End.** The loop ends only when no `pending` line is left (report one line per release from the Queue) or on `blocked`/`disputed`. Finishing one release is never a reason to stop.
5. **Resume.** New session, fork, compaction, a runner that vanished without a receipt, or the user says "continue": re-read `.superpowers/state.md` and go to 2. Never re-run a `done` line. A `pending` line whose branch already has commits is re-dispatched as it is; the new runner continues from the committed state.

A runner message starting `interim:` is not a receipt: ignore it and keep waiting. When a runner's "finished" notification arrives without a terminal receipt, read its Queue line; still `pending`: message that runner once for its receipt, then go to 2.

Waiting for a runner's receipt is not a stop: the controller's turn ends and it resumes on the runner's notification. No runner and no gate process alive while a line is `pending` = the loop died; go to 2.

A runner cannot grant permissions. When it reports a denied tool or permission, ask the user; never retry with a bypass flag and never do the denied action yourself.

## Step 2: Mandatory Subagent Model Routing (this plugin's `claude-agents/`)
Inside each `lean-programming:release-runner`, pin subagents strictly by tier:

| Tier | Agent (`model:`) | Use ONLY for |
|---|---|---|
| **T1 — Scout** | `lean-programming:scout` (`haiku`, read-only) | Locate files/symbols/callers (`path:line` output) |
| **T1 — Mechanical** | `lean-programming:mech` (`haiku`) | 1–2 file spec'd edits, i18n, chart/version bumps, docs/reports |
| **T2 — Wave Coder** | `lean-programming:coder` (`sonnet`) | Wave of 2–4 coupled tasks reading `task-brief` files + TDD |
| **T3 — 1st Reviewer** | `lean-programming:reviewer` (`fable`) | 1st review of a `standard` release & re-check of its fixes |
| **T3 — 1st Security Reviewer** | `lean-programming:sec-reviewer` (`fable`) | 1st review of a `high` release (auth/crypto/authorization/concurrency) & re-check of its fixes |

## Step 3: Runner Procedure (executed by `lean-programming:release-runner`, one release)
SDD scripts: `{sdd-workspace,task-brief,review-package}` in the superpowers plugin's `skills/subagent-driven-development/scripts/`. Find the folder with `ls -dt ~/.claude/plugins/cache/*/superpowers/*/skills/subagent-driven-development/scripts | head -1`.

1. **Read.** `.superpowers/state.md` (its `## Project Policy` binds you), the plan, and the repo constraints file. Run only `allowed:` state-changing commands; when a `forbidden:` or unlisted one is needed, return `blocked` naming it.
2. **Develop** (`mode: build` only; `gate-only` skips this step). Run `sdd-workspace <PLAN>`, record `BASE_SHA=$(git rev-parse HEAD)`, batch tasks into 2–3 waves, pass each coder only its `task-brief` path. Commit per task.
3. **Verify.** Run every command in the policy's `verify:` list (`superpowers:verification-before-completion`) + `review-package`. Red = fix, re-run. A suite that skips its tests (no database, no service) counts as not run: start what it needs with an `allowed:` command and run it again. Repeat the full list after every fix round, before each gate round.
4. **1st review (Fable).** `lean-programming:sec-reviewer` for `risk: high`, else `lean-programming:reviewer`. Give the reviewer the diff and the seven-pillar checklist (the repo's `docs/superpowers/specs/audits/*seven-pillar*.md` if present, else `<skill-dir>/references/seven-pillar-review.md`); every finding must follow its unambiguous format (exact `path:line`, quoted code, exact fix naming every file to touch, test name + assertion). Fix every finding with a regression test, re-verify, then have the same reviewer check only the fix delta. Repeat fix and delta check while findings remain. Return `disputed` only when: a finding needs a design decision; or you disagree with a finding; or the same finding is still open after 3 fix attempts; or 3 delta checks are used. A security finding is never deferred.
5. **2nd gate (other vendor).** Run the Gate Contract below: round 1, then delta rounds until `approved` (limits in the contract).
6. **Screenshots** (after `GateStatus: approved`), if UI/views/routes/docs changed: capture desktop (`1440x900`) + mobile (`390x844`) into `docs/assets/releases/<version>/` via `uv run --offline --with playwright python3 <skill-dir>/scripts/capture-screenshots.py --check-overflow`, inspect the PNGs, link them in `README.md`, commit. Backend-only release: record `shots=n/a`. Note the PID of every server you start and stop each one with `kill <pid>` before you report; never `pkill`/`killall` by pattern. A screenshot that shows a bug needing a code change: fix it with a test, then run the gate's next round on that delta (no round left: return `disputed`).
7. **Release.** Write a `<=20-line` report to `docs/superpowers/reports/<slug>.md`, merge `--no-ff` locally into the policy's `merge-into:` branch, create the annotated tag. Policy `push: yes`: `git push origin <merge-into> <tag>` (never force); a failed push = `blocked` with the error line. Then replace this release's Queue line in `.superpowers/state.md` with its `done` form and remove `.superpowers/sdd/<slug>`.

`GateStatus: approved` must cover the last code commit. After approval only screenshot, README, report and receipt commits may follow; any other change needs a new gate round.

Return `<=10` lines: `status | release | commit | tag | tests | shots | gate_rounds | notes`, with `status` one of `done`, `blocked`, `disputed`.

## Gate Contract (`gate-review.mjs`)
```bash
node <skill-dir>/scripts/gate-review.mjs \
  --plan <PLAN> --base <BASE_SHA> --head HEAD \
  --out docs/superpowers/reviews/<slug>-review.md --round 1 --risk <standard|high> \
  [--constraints <repo rule file>]
```
- Cross-vendor rule: the driver never reviews its own work. Do not pass `--reviewer`; the script picks it. Under Claude Code: `agy` reviews on model `gemini-4-carbon-high` (Carbon); the fallback `codex` reviews on `gpt-6.2-astra` (Astra). The script pins both models and writes `Reviewer-Model:` into the review file. If `agy` cannot review (missing, permission denied, timeout, no structured output), the script falls back to `codex` by itself, prints `ReviewerFailed: agy: ...` and notes it in the review file. A review by `codex` counts the same as one by `agy`. The script refuses a Claude reviewer (exit `2`), except when env `GATE_SAME_VENDOR=1` is set (a Claude-Code-only user, see this plugin's README): then a fresh headless read-only Fable session (`claude-fable-5-2`) is the last fallback after `agy` and `codex`, and its review counts the same.
- If `## Project Policy` sets `gate-reviewer: <claude|agy|codex>`, pass `--reviewer <that>` (owner's choice; the script still refuses the driver's own vendor unless `GATE_SAME_VENDOR=1`).
- **Fix protocol: find the real issue, fix it once (owner, 2026-11-26).** Every finding, from either review, goes through these steps before any code changes: (1) **Reproduce:** write the finding's test first and run it; it must FAIL on the current code. A finding whose test cannot be made to fail is not real as stated: mark it `not-reproduced`, attach the test and output, and send it back to the reviewer to restate or drop; never "fix" it. (2) **Root cause:** name the violated invariant in one line (e.g. "every restore target must be verified empty before the first write"), not the symptom. (3) **Blast radius:** use the scout to list EVERY site where that invariant applies (grep the pattern, callers, sibling code paths, other drivers or protocols). (4) **Fix once at the choke point:** fix the shared code that enforces the invariant, not each call site; keep validation and error handling. (5) **Variant test:** extend the test to a table over every site and input form found in step 3; all must pass. (6) Fable fix-completeness check, then commit. Report per finding: invariant | sites | test.
- **Round budget (owner, 2026-11-26): converge, never loop.** (1) Before gate round 1, the Fable 1st reviewer does a pre-gate pass: re-read its own findings and the fixes against the seven pillars and close each finding as a *class*, not an instance (every input form, call site and sibling path, with a table/property test covering the variants). (2) Before each fix round, the Fable reviewer checks the planned fixes for completeness (all sites, tests, docs, config) BEFORE they are committed, so a fix never needs a second round. (3) Hard cap: at most 3 gate delta rounds per release. (4) Escalate instead of looping: when a delta round only reports narrower variants of a class already fixed, or the same root cause comes back after 2 attempts, stop and return `disputed` with a one-line scope question (e.g. "restrict input X to form Y?"); never start another fix round on it.
- Use `--risk high` **only** for auth, crypto, authorization, or concurrency/SQL-race releases.
- A review takes 5–25 minutes. Run it with `Bash` `timeout: 600000`; if it is still running, re-run it with `run_in_background: true` and wait for the notification. Never poll.
- The last `GateStatus:` line on stdout is the only result:

| Line | Do exactly this |
|---|---|
| `GateStatus: approved` | Continue with procedure step 6. |
| `GateStatus: changes_requested`, Round 1 | Fix every critical/high/medium finding in the review file, add its test, re-verify (refresh screenshots if UI changed), then run the same command with `--round 2 --risk standard`. It reviews only the delta since Round 1. |
| `GateStatus: changes_requested`, a delta round | Fix, test, re-verify and run `--round 2` again (each run reviews the delta since the previous review). Return `disputed` with the open IDs only when: a finding needs a design decision; or you disagree with a finding; or the same ID is still open after 2 fix attempts; or 3 delta rounds are used. |
| `GateStatus: error` | Return `blocked` with the `Error:` line verbatim. No review file was written; ignore any older one. |

- After the operator resolves a `disputed` release: write the decision into the repo rule file (so the reviewer sees it as binding), fix with tests, re-verify, then continue the delta rounds with `--round 2`.
- Every finding in the review file has five parts: **Where** (`path:line`), **Wrong** (what fails), **Expected** (correct behavior), **Fix** (exact change), **Test** (name + assertion). A fix is complete only when its test proves the Expected line.
- On `error`: do not edit the script, do not switch `--reviewer`, do not add permission-bypass flags.
- Full reference (inputs, exit codes, logs): `node <skill-dir>/scripts/gate-review.mjs --help`.
- Script self-test (offline): `node --test <skill-dir>/scripts/gate-review.test.mjs`.
