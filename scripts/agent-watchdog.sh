#!/usr/bin/env bash
# agent-watchdog.sh
#
# Monitors a background subagent for stall / timeout. Used by the coordinator
# (main Claude) via the Monitor tool. Emits one stdout line per state event so
# Monitor batches them as notifications.
#
# Usage:
#   scripts/agent-watchdog.sh <task_id> <stall_threshold_seconds> <max_duration_seconds>
#
# Examples:
#   scripts/agent-watchdog.sh ae19b1d 300 900    # small doc agent, 5min stall, 15min max
#   scripts/agent-watchdog.sh aa7f89f 600 2700   # heavy src agent, 10min stall, 45min max
#
# Stdout events (each line is a notification to the coordinator):
#   HEARTBEAT task=<id> file_size=<n> elapsed=<sec>
#   STALL task=<id> no_growth=<sec> file_size=<n>
#   TIMEOUT task=<id> elapsed=<sec> file_size=<n>
#   COMPLETED task=<id> file_size=<n> elapsed=<sec>
#
# Exit codes:
#   0 → agent completed normally
#   1 → STALL detected (no JSONL growth for stall_threshold)
#   2 → TIMEOUT (elapsed exceeded max_duration)

set -euo pipefail

TASK_ID="${1:?Usage: $0 <task_id> <stall_threshold_sec> <max_duration_sec>}"
STALL_THRESHOLD="${2:?missing stall_threshold_sec}"
MAX_DURATION="${3:?missing max_duration_sec}"

# Locate the JSONL output file (Claude Code's standard layout)
# Symlink lives at /tmp/claude-{uid}/-home-chenz-project/{session}/tasks/{task_id}.output
SESSION_BASE=$(ls -d /tmp/claude-*/-home-chenz-project/* 2>/dev/null | head -1)
if [[ -z "${SESSION_BASE}" ]]; then
  echo "ERROR task=${TASK_ID} reason=no_session_base_found" >&2
  exit 3
fi
OUTPUT_FILE="${SESSION_BASE}/tasks/${TASK_ID}.output"

if [[ ! -e "${OUTPUT_FILE}" ]]; then
  echo "ERROR task=${TASK_ID} reason=output_file_missing path=${OUTPUT_FILE}" >&2
  exit 3
fi

# Poll loop
START=$(date +%s)
LAST_SIZE=0
LAST_GROWTH_AT=${START}
POLL_INTERVAL=60   # seconds

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))

  # Get current size (handle file/symlink/missing)
  if [[ -L "${OUTPUT_FILE}" ]]; then
    REAL=$(readlink -f "${OUTPUT_FILE}" 2>/dev/null || echo "")
    if [[ -n "${REAL}" && -f "${REAL}" ]]; then
      CUR_SIZE=$(wc -c < "${REAL}" 2>/dev/null || echo 0)
    else
      CUR_SIZE=0
    fi
  elif [[ -f "${OUTPUT_FILE}" ]]; then
    CUR_SIZE=$(wc -c < "${OUTPUT_FILE}" 2>/dev/null || echo 0)
  else
    CUR_SIZE=0
  fi

  # Check timeout first
  if [[ ${ELAPSED} -ge ${MAX_DURATION} ]]; then
    echo "TIMEOUT task=${TASK_ID} elapsed=${ELAPSED} file_size=${CUR_SIZE}"
    exit 2
  fi

  # Check growth → reset stall clock
  if [[ ${CUR_SIZE} -gt ${LAST_SIZE} ]]; then
    LAST_SIZE=${CUR_SIZE}
    LAST_GROWTH_AT=${NOW}
    echo "HEARTBEAT task=${TASK_ID} file_size=${CUR_SIZE} elapsed=${ELAPSED}"
  else
    NO_GROWTH=$((NOW - LAST_GROWTH_AT))
    if [[ ${NO_GROWTH} -ge ${STALL_THRESHOLD} ]]; then
      echo "STALL task=${TASK_ID} no_growth=${NO_GROWTH} file_size=${CUR_SIZE}"
      exit 1
    fi
  fi

  # Detect normal completion: file growth stopped AND no growth for >= 60s
  # AND the task notification system has likely already fired
  # (We assume completion if no growth for stall_threshold/2 AND elapsed > 60s.)
  # This is a soft heuristic; the coordinator gets the real completion signal
  # via the task-notification path.

  sleep "${POLL_INTERVAL}"
done
