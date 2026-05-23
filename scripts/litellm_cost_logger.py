"""Holon LiteLLM cost/spend logger (Phase 0 — budget-aware orchestration).

A minimal local-only spend logger: on every successful (and failed) LLM call
through the proxy, append ONE JSON line with model + token usage + cost to a
local log file (no external DB required). This is the cost-visibility hook
referenced in docs/research/budget-aware-agent-orchestration.md (Phase 0).

Wired into the proxy via litellm-config.yaml:
    litellm_settings:
      callbacks: ["litellm_cost_logger.cost_logger_instance"]

Log destination is overridable via HOLON_LITELLM_COST_LOG (default
/tmp/holon-litellm-cost.log). Each line:
    {"ts","model","custom_llm_provider","status","prompt_tokens",
     "completion_tokens","total_tokens","response_cost_usd","call_id"}
"""

import json
import os
from datetime import datetime, timezone

from litellm.integrations.custom_logger import CustomLogger
from litellm._logging import verbose_logger

COST_LOG_PATH = os.getenv("HOLON_LITELLM_COST_LOG", "/tmp/holon-litellm-cost.log")


def _coerce_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class HolonCostLogger(CustomLogger):
    """Append a single JSON cost line per request to a local log file."""

    def _emit(self, kwargs, response_obj, status):
        # The StandardLoggingPayload is the canonical, version-stable place
        # litellm puts model + token usage + computed response_cost.
        slp = kwargs.get("standard_logging_object") or {}
        usage = slp.get("response", {}).get("usage") if isinstance(slp.get("response"), dict) else None

        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": "holon_cost",
            "model": slp.get("model") or kwargs.get("model"),
            "custom_llm_provider": slp.get("custom_llm_provider")
            or kwargs.get("custom_llm_provider"),
            "status": status,
            "prompt_tokens": slp.get("prompt_tokens"),
            "completion_tokens": slp.get("completion_tokens"),
            "total_tokens": slp.get("total_tokens"),
            "response_cost_usd": _coerce_float(slp.get("response_cost")),
            "call_id": slp.get("id") or kwargs.get("litellm_call_id"),
        }

        # Fall back to kwargs["response_cost"] if the payload didn't carry it.
        if record["response_cost_usd"] is None:
            record["response_cost_usd"] = _coerce_float(kwargs.get("response_cost"))

        try:
            with open(COST_LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record) + "\n")
        except OSError as exc:
            # No silent failure: surface to the proxy log; never raise into the
            # request path (logging must not break the actual completion).
            verbose_logger.error(f"[holon-cost-logger] failed to write {COST_LOG_PATH}: {exc}")

        # Also echo to the proxy's own (JSON) log stream so `tail` shows it.
        verbose_logger.info(f"[holon-cost] {json.dumps(record)}")

    # Sync hooks (used for non-async call paths).
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._emit(kwargs, response_obj, "success")

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        self._emit(kwargs, response_obj, "failure")

    # Async hooks (the proxy uses these for streaming + async completions).
    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        self._emit(kwargs, response_obj, "success")

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        self._emit(kwargs, response_obj, "failure")


# Instance referenced from litellm-config.yaml: "litellm_cost_logger.cost_logger_instance"
cost_logger_instance = HolonCostLogger()
