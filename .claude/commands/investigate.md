---
description: Run the Investigation→Decision→Build pipeline on a topic — research (incl. usable OSS), gap analysis, architecture impact, feasibility, tech-debt+priority, then phased build.
argument-hint: <topic> (e.g. "budget-aware agent orchestration", "voice STT connector")
allowed-tools: Read, Bash, WebSearch, WebFetch, Edit, Write, Agent, Task
---

# /investigate $ARGUMENTS

Turn an open feature/optimization/architecture question into shipped work via the 6-stage pipeline
(CLAUDE.md § "Investigation → Decision → Build Methodology"). Do NOT jump to code.

## Steps for the model

1. **调研 / Research.** WebSearch the current SOTA for `$ARGUMENTS`. Cite real sources (paper/repo/issues),
   verify-not-marketing (cross-reference; flag marketing-vs-reality gaps; numbers are workload-dependent).
   **Always ask: is there a directly-usable open-source / real component to adopt instead of building?**
   (Name them, with how-to-plug-in + caveats.) Honor [[feedback_real_not_simulated]] + [[feedback_research_style]].

2. **User-case gap analysis.** Map findings to the owner's real user stories / current use. What gap does
   it close? Does the product satisfy the need today? Simulate the user flow; pinpoint where they get stuck.

3. **Architecture-impact analysis.** New layers / protocol fields / contracts / services? What does it touch
   (two-core seam, runtime/Hermes, data model)? New risks — especially anything that can SILENTLY regress
   quality (→ requires an eval harness).

4. **Implementation feasibility.** Adopt-OSS vs build-from-scratch; effort estimate; the *cheapest viable
   first slice*; dependencies and ordering.

5. **Tech-debt registry + priority/tradeoff.** Write the depth into `docs/research/<topic>.md` with sections
   (1) opportunities (2) architecture impact (3) implementation phases + caveats + sources. Record the
   **top-N worth doing** into `TECH-DEBT.md` (per its entry format), with a real priority call (ROI / risk /
   dependencies / owner impact) and explicit do-now-vs-defer tradeoffs.

6. **Implementation.** Only after the owner picks: build **one phase/slice at a time so the owner can test
   each**. Hard implementation → Codex; mechanical/parallel → sub-agents. Verify (eval/test harness for
   quality-sensitive changes). Commit each slice to `main` (Windows side pulls). Don't touch the Windows copy git.

## Output to the owner
A tight summary: (1) opportunities incl. **usable OSS**, (2) architecture impact, (3) phased implementation,
+ key caveats + sources + a "top-N worth doing" with priority. Then ask which slice to start (default: the
highest-ROI, lowest-risk Phase 0). Link the full `docs/research/<topic>.md`.
