"""Auto-compacting sequential release runner for Antigravity run_workflow.

Each release/plan runs inside one fresh, single-use agent() so 100% of working
context is freed between releases.
"""

RECEIPT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "status",
        "item",
        "commit",
        "tag",
        "tests",
        "screenshots",
        "gate_rounds",
        "notes",
    ],
    "properties": {
        "status": {"type": "string", "enum": ["done", "disputed", "blocked"]},
        "item": {"type": "string"},
        "commit": {"type": "string"},
        "tag": {"type": "string"},
        "tests": {"type": "string"},
        "screenshots": {"type": "string"},
        "gate_rounds": {"type": "integer"},
        "notes": {"type": "string"},
    },
}

# Project-agnostic: the caller passes the pending Queue lines of .superpowers/state.md.
items = args.get("items") or []
if not items:
    log("HALTED: pass args['items'] = pending Queue lines (name, plan, risk, mode). No default list.")
context_file = args.get("context_file")  # repo constraints file (AGENTS.md, ...), optional
agent_type = args.get("type_name", "self")
skill_dir = args.get("skill_dir")  # folder that holds SKILL.md; the caller passes it
if not skill_dir:
    log("HALTED: pass args['skill_dir'] = the lean-programming skill folder.")
    items = []

for raw in items:
    item = (
        {"name": raw, "mode": "release", "plan": raw, "risk": "standard"}
        if isinstance(raw, str)
        else raw
    )
    name = item["name"]
    plan = item["plan"]
    risk = item.get("risk", "standard")
    mode = item.get("mode", "release")
    review = item.get("review", f"docs/superpowers/reviews/{name}-review.md")

    phase(f"Release {name}")

    extra_rule = (
        f"Fix open/disputed findings in {review} on branch fix/{name}, move local tag, then run delta gate Round 2."
        if mode == "fix_review"
        else f"{plan} is already implemented and committed: skip the build waves. Run screenshots, verification, 1st review and Claude 2nd gate (--risk {risk})."
        if mode == "gate-only"
        else f"Implement {plan} via lean-programming wave batching, 1st review, verification, and Claude 2nd gate (--risk {risk})."
    )

    prompt = f"""Execute ONLY {name} in {WORKSPACES[0] if WORKSPACES else '.'}.
Read first:
1. {skill_dir}/drivers/antigravity.md (scripts are in {skill_dir}/scripts/)
2. .superpowers/state.md
3. {context_file or "repo rule files at the repo root (AGENTS.md, GEMINI.md), if any"} (repo constraints only)
4. {plan} (and {review} if present)

Job:
{extra_rule}

Rules:
- Use tiered subagents (flash for mechanical/scouting, inherit for core waves, pro only for high-risk review).
- If UI/views/routes/docs changed, capture Playwright screenshots (1440x900 + 390x844) via capture-screenshots.py into docs/assets/releases/<version>/, inspect PNGs, link in README/docs, and commit them with the release so images ship when pushed. (Backend-only: screenshots='n/a'.)
- 1st review: one read-only `research` subagent (`Model: "pro"`) against the seven-pillar checklist (repo `docs/superpowers/specs/audits/*seven-pillar*.md`, else the skill's `references/seven-pillar-review.md`); every finding has an exact path:line with quoted code, an exact fix naming every file to touch, and a test name + assertion.
- Fix protocol for every finding: reproduce first (the test must FAIL; else mark `not-reproduced` and send back, no code change), name the violated invariant in one line, list every site where it applies, fix once in the shared code that enforces it, extend the test to a table over all sites and input forms, then have the reviewer check the planned fixes for completeness BEFORE committing.
- Round budget: pre-gate pass by the 1st reviewer; at most 3 gate delta rounds; if a round only finds narrower variants of a fixed class, or the same root cause returns after 2 attempts, return status='disputed' with a one-line scope question.
- If the Project Policy sets `gate-reviewer:`, pass `--reviewer <that>` to gate-review.mjs.
- Never skip full verification suite or the 2nd gate (gate-review.mjs; omit --reviewer so claude-fable-5-2 -> gpt-6.2-astra fallback applies). Its last "GateStatus:" line is the only result; on "GateStatus: error" return status='blocked' with the Error line.
- Order is fixed: develop, verify, 1st review, fix, 2nd gate, fix, screenshots, merge (--no-ff), tag, push. Push the merge-into branch and the tag only when the Project Policy says push: yes; never force-push.
- Obey the "## Project Policy" section of .superpowers/state.md: run only its allowed commands; if a forbidden or unlisted state-changing command is needed, return status='blocked' naming it.
- Replace this release's Queue line in .superpowers/state.md with its done form and write <=20-line report to docs/superpowers/reports/{name}.md.
- If disputed/blocked after Round 2, return status='disputed' or 'blocked' with <=3-line notes.
"""

    receipt = await agent(
        prompt=prompt,
        schema=RECEIPT_SCHEMA,
        role=f"Lean Runner {name}",
        type_name=agent_type,
        model="inherit",
    )
    log(
        f"{receipt['item']}: status={receipt['status']} commit={receipt['commit']} "
        f"tag={receipt['tag']} shots={receipt['screenshots']} "
        f"rounds={receipt['gate_rounds']} ({receipt['notes']})"
    )
    if receipt["status"] != "done":
        log(f"HALTED on {name}: {receipt['notes']}")
        break
