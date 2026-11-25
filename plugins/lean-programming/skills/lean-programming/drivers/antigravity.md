# Lean Programming: Antigravity (`agy`) driver

Ultracave discipline. No filler, no praise, no polling crons. Follow `ponytail` (minimum complete change) and `caveman` (terse output, exact technical identifiers).

## Prerequisites (check once, before Step 0)
| Need | Check | If missing |
|---|---|---|
| `superpowers` plugin | `~/.gemini/config/plugins/superpowers` exists | Stop. Ask the user to install it. |
| `ponytail` plugin, level `full` | `~/.gemini/config/plugins/ponytail` exists; mode is `full` | Level differs: tell the user to run `/ponytail full`. Plugin missing: stop. |
| `caveman` plugin | `~/.gemini/config/plugins/caveman` exists; caveman mode active | Tell the user to run `/caveman`. Plugin missing: stop. |
| `node` >= 20, `git`, `tar` | `node --version` | Stop. Report the missing tool. |
| Reviewer CLIs `claude` (primary) and `codex` (fallback) | `command -v claude codex` | Both missing: stop, the 2nd gate cannot run. One missing: tell the user, continue. |

Never continue without a prerequisite and never substitute another tool for one.

## Step 0: Lock Folder & Plan First
Verify/create before touching code:
```text
docs/superpowers/{specs,plans,reviews,reports}
.superpowers/{sdd,gate,state.md}
```
- Existing plan in another folder: skip `brainstorming` & `writing-plans`; init `docs/superpowers/{plans,reviews,reports}` + `.superpowers/state.md`. Pass its path directly as `<PLAN>` when it has `Task N` headings and at least one `Review Focus` or `Global Constraints` heading or bullet (`- **Review Focus:** ...`). Otherwise import/normalize a copy into `docs/superpowers/plans/` first. The gate exits `2` on a plan with no review criteria.
- No spec yet → run `superpowers:brainstorming`, save to `docs/superpowers/specs/`.
- Spec ready, no plan → run `superpowers:writing-plans`, save to `docs/superpowers/plans/`.
- Ensure `.superpowers/` is in `.gitignore`.
- **Project policy (ask once, before the loop).** The skill is project-agnostic; every project rule lives in the repo. Read the repo rule files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README`, `Makefile`) and write `## Project Policy` into `.superpowers/state.md`:
  - `constraints:` path of the repo rule file (passed to runners and to the gate as `--constraints`), or `none`.
  - `verify:` the exact test/lint/build commands.
  - `allowed:` state-changing commands runners may run unattended (start/restart services, migrate, seed, deploy to a local stack).
  - `forbidden:` commands runners must never run.
  - `merge-into:` the branch releases merge into.
  - `push:` `yes` (after each release push the `merge-into` branch and the release tag to `origin`; never force-push) or `never`. Ask the user; no answer = `never`.
  Ask the user **one** question listing every state-changing command the plans need, and record the answer under `allowed:` / `forbidden:`. A command in neither list is forbidden. Runners return `blocked` naming the command; they never ask and never guess.

## Step 1: Continuous Multi-Release Loop
Never run 2+ plans or releases in this chat loop.

One release, always in this order, then the next release starts by itself until the last plan:
`develop → verify → 1st review → fix → 2nd gate (claude/codex) → fix → screenshots → merge, tag, push → next release`

Queue format in `.superpowers/state.md`, under `## Queue`, one line per release, in execution order:
```text
<slug> | <plan path> | <build|gate-only> | <standard|high> | pending
<slug> | done | <sha7> | <tag> | <tests> | shots=<n>
```

1. **Queue.** No `## Queue` yet: write one `pending` line for every release plan in scope, in order, through the last plan. `gate-only` = implementation already committed; `build` = nothing implemented yet. `high` only for auth, crypto, authorization or concurrency/SQL-race releases.
2. **Run.** Execute `run_workflow` on `<skill-dir>/scripts/run_lean_releases.py` with `skill_dir` = `<skill-dir>` and `items` = every `pending` Queue line, in order (`name`, `plan`, `risk`, `mode`). Always pass both; never rely on the script's built-in default list. Each release runs inside one disposable `agent()` that frees 100% of its context before the next starts.
3. **End.** The workflow continues release after release without asking the user. It ends only when every item returned `done`, or on the first `blocked`/`disputed` receipt. Then report `<=3` lines. Finishing one release is never a reason to stop.
4. **Resume.** New session or the user says "continue": re-read `.superpowers/state.md` and go to 2 with the remaining `pending` lines. Never re-run a `done` line.

## Step 2: Mandatory Subagent Model Routing
Always set `Model` explicitly on `invoke_subagent` (never omit for simple/mechanical work):

| Tier | `Model` / `TypeName` | Use ONLY for |
|---|---|---|
| **T1 — Fast / Mechanical** | `Model: "flash"` (`cavecrew-builder`, `research`, `self`) | File/caller scouting, 1–2 file edits, i18n, chart/version bumps, docs/reports |
| **T2 — Standard Wave** | `Model: "inherit"` or `"flash"` (`self`) | Batched wave of 2–4 coupled tasks; reads `task-brief` files only |
| **T3 — High-Rigor Review** | `Model: "pro"` (`research`, read-only) | 1st-pass diff review on auth/crypto/SQL-race releases, or fixes stuck after 2 tries |

## Step 3: Wave Build (Single Plan / Single Release)
1. Init SDD workspace once:
   `bash ~/.gemini/config/plugins/superpowers/skills/subagent-driven-development/scripts/sdd-workspace <PLAN>`
2. Batch independent/coupled tasks into **2–3 waves** (not 1 subagent per minor task).
3. Slice each task with `task-brief <PLAN> <N>` and pass ONLY: brief path, `## Global Constraints`, exact interfaces, and `.superpowers/sdd/<slug>/` report path. Never pass full spec or chat history.
4. Record `BASE_SHA` before Wave 1 (`git rev-parse HEAD`). Commit per logical wave/task.

## Step 4: Verification + 1st Review
1. Run every command in the policy's `verify:` list (`superpowers:verification-before-completion`: tests, vet, codegen/templ, live DB). A suite that skips its tests (no database, no service) counts as not run: start what it needs with an `allowed:` command and run it again. Repeat the full list after every fix round, before each gate round.
2. Generate diff file:
   `bash ~/.gemini/config/plugins/superpowers/skills/subagent-driven-development/scripts/review-package <PLAN> <BASE_SHA> HEAD`
3. Dispatch **1** read-only `research` subagent (`Model: "flash"` for UI/ops/docs, `"pro"` for auth/crypto/concurrency) against the seven-pillar checklist (the repo's `docs/superpowers/specs/audits/*seven-pillar*.md` if present, else `<skill-dir>/references/seven-pillar-review.md`) using `caveman-review` format (`path:line: <sev>: <what is wrong>. Expected: <correct behavior>. Fix: <exact change>. Test: <name + assertion>`, all five parts in every finding, 0 praise). Fix all real bugs locally with a regression test, re-verify, then have the reviewer check only the fix delta. Repeat fix and delta check while findings remain. Return `disputed` only when: a finding needs a design decision; or you disagree with a finding; or the same finding is still open after 3 fix attempts; or 3 delta checks are used. A security finding is never deferred.

## Step 5: 2nd Gate (`Fable` + `Astra` Fallback: Round 1 + Delta Rounds)
Run (`BypassSandbox: true`, standalone command):
```bash
node <skill-dir>/scripts/gate-review.mjs \
  --plan <PLAN> --base <BASE_SHA> --head HEAD \
  --out docs/superpowers/reviews/<slug>-review.md --round 1 --risk <standard|high> \
  [--constraints <repo rule file>]
```
- Cross-vendor rule: the driver never reviews its own work. Do not pass `--reviewer`; the script picks it. Under Antigravity (`agy`): `claude` reviews on model `claude-fable-5-2` (Fable); the fallback `codex` reviews on `gpt-6.2-astra` (Astra). The script pins both models and writes `Reviewer-Model:` into the review file. If `claude` cannot review (missing, permission denied, timeout, no structured output), the script falls back to `codex` by itself, prints `ReviewerFailed: claude: ...` and notes it in the review file. A review by `codex` counts the same as one by `claude`. The script refuses an `agy` reviewer (exit `2`).
- If `## Project Policy` sets `gate-reviewer: <claude|agy|codex>`, pass `--reviewer <that>` (owner's choice; the script still refuses the driver's own vendor unless `GATE_SAME_VENDOR=1`).
- **Fix protocol: find the real issue, fix it once (owner, 2026-11-26).** Every finding, from either review, goes through these steps before any code changes: (1) **Reproduce:** write the finding's test first and run it; it must FAIL on the current code. A finding whose test cannot be made to fail is not real as stated: mark it `not-reproduced`, attach the test and output, and send it back to the reviewer to restate or drop; never "fix" it. (2) **Root cause:** name the violated invariant in one line (e.g. "every restore target must be verified empty before the first write"), not the symptom. (3) **Blast radius:** use the scout to list EVERY site where that invariant applies (grep the pattern, callers, sibling code paths, other drivers or protocols). (4) **Fix once at the choke point:** fix the shared code that enforces the invariant, not each call site; keep validation and error handling. (5) **Variant test:** extend the test to a table over every site and input form found in step 3; all must pass. (6) Fable fix-completeness check, then commit. Report per finding: invariant | sites | test.
- **Round budget (owner, 2026-11-26): converge, never loop.** (1) Before gate round 1, the Fable 1st reviewer does a pre-gate pass: re-read its own findings and the fixes against the seven pillars and close each finding as a *class*, not an instance (every input form, call site and sibling path, with a table/property test covering the variants). (2) Before each fix round, the Fable reviewer checks the planned fixes for completeness (all sites, tests, docs, config) BEFORE they are committed, so a fix never needs a second round. (3) Hard cap: at most 3 gate delta rounds per release. (4) Escalate instead of looping: when a delta round only reports narrower variants of a class already fixed, or the same root cause comes back after 2 attempts, stop and return `disputed` with a one-line scope question (e.g. "restrict input X to form Y?"); never start another fix round on it.
- Use `--risk high` **only** for auth, crypto, authorization, or concurrency/SQL-race releases.
- A review takes 5–25 minutes. Give the command a long timeout and wait. Never poll.
- The last `GateStatus:` line on stdout is the only result:

| Line | Do exactly this |
|---|---|
| `GateStatus: approved` | Continue with Step 6. |
| `GateStatus: changes_requested`, Round 1 | Fix every critical/high/medium finding in the review file, add its regression test (`Test<ID>_*`), re-verify (refresh screenshots if UI changed), then run the same command with `--round 2 --risk standard`. Round 2 reviews only the delta since Round 1. |
| `GateStatus: changes_requested`, a delta round | Fix, test, re-verify and run `--round 2` again (each run reviews the delta since the previous review). Stop and return `disputed` with the open IDs (`<=3` lines) only when: a finding needs a design decision; or you disagree with a finding; or the same ID is still open after 2 fix attempts; or 3 delta rounds are used. |
| `GateStatus: error` | Stop. Return `blocked` with the `Error:` line verbatim. No review file was written; ignore any older one. |

- After the operator resolves a `disputed` release: write the decision into the repo rule file (so the reviewer sees it as binding), fix with tests, re-verify, then continue the delta rounds with `--round 2`.
- Every finding in the review file has five parts: **Where** (`path:line`), **Wrong** (what fails), **Expected** (correct behavior), **Fix** (exact change), **Test** (name + assertion). A fix is complete only when its test proves the Expected line.
- On `error`: do not edit the script, do not switch `--reviewer`, do not add permission-bypass flags.
- Never merge or tag without `GateStatus: approved` for the current HEAD.
- Full reference (inputs, exit codes, logs): `node <skill-dir>/scripts/gate-review.mjs --help`.
- Script self-test (offline): `node --test <skill-dir>/scripts/gate-review.test.mjs`.

## Step 6: Screenshots + Merge, Tag, Push + Auto-Compact Receipt
Only after `GateStatus: approved`. `approved` must cover the last code commit; after it only screenshot, README, report and receipt commits may follow. A screenshot that shows a bug needing a code change: fix it with a test, then run the gate's next round on that delta (no round left: return `disputed`).

- **Visual capture (when UI/views/routes/docs changed):**
   - Run the app in a scratch dir and capture screenshots via Playwright:
     `uv run --offline --with playwright python3 <skill-dir>/scripts/capture-screenshots.py --manifest <shots.json> --out-dir docs/assets/releases/<version> --check-overflow`
   - Capture desktop (`1440x900`) + mobile (`390x844`) for every changed/new view (plus theme/i18n variants if plan asks). Inspect the PNGs with `read_file` and fix layout/overflow bugs before gating.
   - Pure backend/internal-only changes with zero UI impact: skip and note `screenshots=n/a (backend-only)`.
   - Note the PID of every server you start and stop each one with `kill <pid>` before you report; never `pkill`/`killall` by pattern.
Follow `superpowers:finishing-a-development-branch`:
- Stage & commit captured images (`docs/assets/releases/<version>/*.png`) and `README.md` / release-note links so every screenshot is part of the merged branch/tag ready to push (or pushed when user/workflow authorizes push).
- Merge `--no-ff` locally into the policy's `merge-into:` branch and create the annotated tag. Policy `push: yes`: `git push origin <merge-into> <tag>` (never force); a failed push = `blocked` with the error line.
- Write `<=20-line` caveman report to `docs/superpowers/reports/<slug>.md`.
- Replace this release's Queue line in `.superpowers/state.md` with its `done` form (`<id> | done | <sha7> | <tag> | <tests> | shots=<n>`).
- Remove `.superpowers/sdd/<slug>` scratch dir and return `<=10-line` receipt.
