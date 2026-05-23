# Agent Heartbeat & Watchdog

Status: draft v0.1 (proposed via ADR-017)
Date: 2026-05-16
Owner: coordinator
Position: A required pattern for dispatching background subagents. Without this, agents can stall silently and burn hours of time + tokens. Specifies when to wrap with a watchdog, what counts as a heartbeat, and what to do when one stops.

## 1. The Problem

When the coordinator (main Claude session) dispatches a subagent in background:

```
Agent({ subagent_type: "general-purpose", run_in_background: true, prompt: "..." })
→ Returns task_id; agent runs asynchronously
→ Coordinator continues other work
→ Notification arrives when agent completes (success or failure)
```

**The hole**: if the agent enters a stuck state (infinite loop, model hang, API back-pressure, network issue), the coordinator gets NO notification — it just waits forever. Observed in production:

- Test Agent on 2026-05-15: ran **6.4 hours**, 60 tool uses, then died with "Stream idle timeout". Wrote nothing useful. Coordinator didn't notice for hours.
- Initial Dev Agent on iter-001a: ran 19 minutes, made partial src/ work, died with "Stream idle timeout", **never committed**.

Both failures wasted significant time + tokens. The user explicitly demanded heartbeat detection: "你应该有心跳检测啊".

## 2. Heartbeat Definition

A subagent's heartbeat is **growth of its JSONL output file**. Path:

```
/tmp/claude-1000/-home-chenz-project/{session_id}/tasks/{task_id}.output
   → symlinks to →
/home/chenz/.claude/projects/-home-chenz-project/{session_id}/subagents/agent-{task_id}.jsonl
```

Each tool call the subagent makes appends to this file. Healthy agent → file grows every few seconds. Stalled agent → file size frozen.

## 3. The Watchdog Pattern

For every background dispatch, the coordinator SHOULD also start a watchdog Monitor:

```
1. Dispatch agent in background → get task_id
2. Estimate max_expected_duration (e.g., 300s for small docs; 900s for large code)
3. Start watchdog via Monitor tool, polling the JSONL output file every 60s:
   - Compare current size vs last size
   - If no growth for STALL_THRESHOLD (default 5 min) → emit "STALL" event
   - If total elapsed > max_expected_duration × 1.5 → emit "TIMEOUT" event
   - On either: coordinator receives notification, calls TaskStop({task_id}), reports failure
4. When agent completes (either normally or via TaskStop), the standard task-notification arrives.
   Watchdog auto-exits when Monitor sees the agent's JSONL writer close (no more growth + agent process gone).
```

## 4. Implementation: `scripts/agent-watchdog.sh`

A shell script the coordinator can invoke via Monitor tool:

```bash
# Usage:
#   scripts/agent-watchdog.sh <task_id> <stall_threshold_seconds> <max_duration_seconds>
# Examples:
#   scripts/agent-watchdog.sh ae19b1d 300 900   # small doc agent
#   scripts/agent-watchdog.sh aa7f89f 600 2700  # heavy src agent
```

The script polls the agent's JSONL file, emits one stdout line per state change so Monitor batches them as notifications. Exits 0 when agent completes normally; exits 1 on stall; exits 2 on timeout.

See `scripts/agent-watchdog.sh` for the implementation.

## 5. Coordinator Workflow

```typescript
// Pseudo: how the coordinator wraps a background dispatch

async function dispatchWithWatchdog(agentPrompt, expectedDurationSec) {
  const stallSec = 300;  // 5 min no-growth = stalled
  const maxSec = expectedDurationSec * 1.5;

  const taskId = await Agent({
    prompt: agentPrompt,
    run_in_background: true
  });

  // Start watchdog
  await Monitor({
    description: `watchdog for ${taskId}`,
    command: `scripts/agent-watchdog.sh ${taskId} ${stallSec} ${maxSec}`,
    timeout_ms: maxSec * 1000 + 60000  // monitor timeout = max + 1min slack
  });

  // Now wait for EITHER:
  //   - normal task-notification (success)
  //   - watchdog STALL/TIMEOUT event
  // On stall/timeout: call TaskStop(taskId) and treat as failure
}
```

## 6. Defaults By Agent Class

Coordinator picks `expectedDurationSec` based on the dispatched work:

| Agent class | Typical | Max (1.5×) | Stall threshold |
|---|---|---|---|
| Small doc ADR draft | 300s (5 min) | 450s | 180s (3 min) |
| Larger spec rewrite | 900s (15 min) | 1350s | 300s (5 min) |
| Small src patch (1-2 files) | 600s (10 min) | 900s | 300s |
| Iter src impl (many files) | 1800s (30 min) | 2700s | 600s (10 min) |
| Test Agent review pass | 600s (10 min) | 900s | 300s |

If an agent legitimately needs more time, it should COMMIT incrementally (each commit = JSONL growth, resets stall counter).

## 7. Recovery After Stall

When the watchdog reports STALL or TIMEOUT:

1. **Stop the agent**: `TaskStop({task_id})` — frees the model session
2. **Inspect output file**: `wc -l ${output_file}` — how many tool uses happened
3. **Inspect git log**: did the agent commit anything before stalling?
4. **Decide**:
   - If significant progress: re-dispatch a "resume from where stalled" continuation agent
   - If nothing useful: just re-dispatch the original prompt (maybe simpler / smaller scope)
   - If repeated stalls on same prompt: that's a bug in the prompt or a model issue — escalate to human
5. **Always log** the stall event to `iterations/{current}/agent-failures.md` so post-mortems are possible

## 8. Anti-Pattern (avoid)

- **Don't dispatch with no expected duration** — without a budget, you can't detect "took too long"
- **Don't ignore stall events** — even if the agent eventually completes, stalls indicate a bad prompt or a model issue worth fixing
- **Don't auto-retry indefinitely** — cap retries (default 2 per dispatch); after that, surface to human

## 9. Integration With Autonomous-Loop Mode

In autonomous-loop mode (per `agents/README.md`), the coordinator MUST use this watchdog for every dispatch. A stall in autonomous mode pauses the entire loop:

```
Watchdog emits STALL → coordinator calls TaskStop → records failure in agent-failures.md
                    → does NOT auto-retry in autonomous mode (avoids infinite stall loops)
                    → emits PushNotification to human ("autonomous loop paused: agent X stalled")
                    → exits autonomous mode; waits for human direction
```

This is the missing piece that made the 2026-05-15 6.4-hour stall possible.

## 10. Acceptance Criteria

This pattern is "implemented" when:

1. ✅ `scripts/agent-watchdog.sh` exists and is executable
2. ✅ This spec document exists
3. ✅ ADR-017 has been accepted by human (formalizing the requirement)
4. ⬜ Coordinator (main Claude) USES the pattern on every background dispatch (this is a discipline, enforced by reviewer + retro)
5. ⬜ Once-stalled scenario from 2026-05-15 cannot recur — verified by a deliberate test (e.g., dispatch a hanging agent; watchdog catches in <6 min and TaskStops)

## 11. Open Questions

1. Should stall threshold vary per agent class (above), or be uniform 5 min? Probably class-specific.
2. Should the watchdog be auto-attached by the coordinator (always-on) or opt-in (manual)? Recommendation: auto-attach, with an opt-out for known-fast dispatches.
3. Is there a way to detect "agent making API calls but no tool calls happening" (model deliberating but no output)? The JSONL file would still grow on each turn even without tool calls. Probably OK.
4. For VERY long agents (e.g., 1 hour scope), 5 min stall threshold may be too tight if the agent legitimately thinks long between tool calls. Class-specific thresholds (§ 6) address this.

## 12. Cross-References

- `agents/README.md` § Autonomous Loop Mode — this watchdog is required there
- `iterations/001a-ui-mock-shell/feedback.md` — the incident that drove this spec
- ADR-017 — proposed acceptance of this pattern (to be drafted)
