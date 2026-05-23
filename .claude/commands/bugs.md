---
description: Grab unprocessed in-app bug reports from bugs/, list them newest-first, then triage + fix/delegate each.
argument-hint: "(optional) 'list' to only list; or a bug id to process just that one; empty = list + triage all unprocessed"
allowed-tools: Read, Bash, Edit, Write, Agent, Task
---

# /bugs

Grab the bug reports the owner filed via the in-app reporter and act on them.

## Where bug reports live
- Each report = a dir `bugs/bug-<timestamp>-<id>/` containing `report.md` (header with **Filed/Route/URL**, then the owner's free-text message at the bottom) and usually `screenshot.png`.
- **Unprocessed = no `_processed.md`** in that dir. A `_processed.md` (with `status:` frontmatter + triage notes) means it was already handled.
- `bugs/` is gitignored (local artifacts) — do not commit it.

## Steps for the model

1. **Grab + list unprocessed reports, newest first:**
   ```bash
   cd /home/chenz/project/holon-engineering
   for d in $(ls -td bugs/bug-* 2>/dev/null); do
     [ -f "$d/_processed.md" ] && continue
     ts=$(grep -m1 "Filed:" "$d/report.md" | sed 's/.*Filed:\*\* //')
     route=$(grep -m1 "Route:" "$d/report.md" | sed 's/.*Route:\*\* //')
     echo "▶ $d | $route | $ts"; echo "   $(tail -1 "$d/report.md")"
   done
   ```
   Show this list to the owner. If `$ARGUMENTS` is `list`, STOP here (just list).

2. **Pick scope:** if `$ARGUMENTS` is a specific bug id, process only that one; otherwise process all unprocessed (newest first). Read each `report.md` in full; `Read` the `screenshot.png` when the text alone is ambiguous (UI/layout bugs usually need the screenshot).

3. **Triage each** — diagnose the real root cause in the code (grep/read the relevant files; don't guess). Honor the owner's exact wording (e.g. 连接 not 连接器, 你/我 not 老板) and conventions in CLAUDE.md.

4. **Fix or delegate** per the manager rules (CLAUDE.md § 7×24 / "Stay online"):
   - Trivial single-file / string / config fix → do it inline.
   - Anything >~10s of work or multi-file/hard → dispatch **Codex** (hard work) or a **sub-agent** (mechanical/parallel). Never block the main thread on a long task.
   - Needs an owner decision (irreversible / UX direction) → surface it, don't guess.

5. **Verify** before claiming done — typecheck + the actual failing user flow (not just curl 200). Owner tests the RELEASE build; Claude tests dev (use `NEXT_DIST_DIR=.next-dev` so dev never clobbers the prod `.next`).

6. **Record + close the loop:** write a concise `_processed.md` in each bug dir (`status: fixed|triaged|wontfix`, root cause, what changed, commit). Per owner directive, **commit fixes to `main` and push** so the Windows packaging side can pull. Do NOT touch the Windows copy's git.

7. **Report** a tight summary: each bug → root cause → action (fixed inline / Codex dispatched / owner-decision) → status. List both Codex tasks and sub-agents in flight.
