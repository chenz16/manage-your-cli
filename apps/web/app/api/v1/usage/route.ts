import { NextResponse } from 'next/server';
import { CLI_ADAPTERS, readClaudeUsage } from '@holon/core';
import { requireDeviceTokenForRemote } from '@/lib/device-token-auth';

export const dynamic = 'force-dynamic';

/** GET /api/v1/usage — approximate CLI token-usage stats from local logs. */
export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireDeviceTokenForRemote(req);
  if (!auth.ok) {
    return NextResponse.json({
      error: 'device authentication required',
      code: auth.code,
    }, { status: auth.status });
  }

  const claudeUsage = readClaudeUsage();

  const clis = Object.entries(CLI_ADAPTERS).map(([key, adapter]) => {
    const inUse = key === 'claude' ? claudeUsage.available : false;
    const entry: {
      binary: string;
      label: string;
      in_use: boolean;
      usage?: {
        today_tokens: number;
        week_tokens: number;
        total_tokens: number;
        since: string;
        last_scan: string;
      };
    } = {
      binary: adapter.binary,
      label: adapter.label,
      in_use: inUse,
    };
    if (key === 'claude') {
      entry.usage = {
        today_tokens: claudeUsage.today_tokens,
        week_tokens: claudeUsage.week_tokens,
        total_tokens: claudeUsage.total_tokens,
        since: claudeUsage.since,
        last_scan: claudeUsage.last_scan,
      };
    }
    return entry;
  });

  return NextResponse.json({
    clis,
    note: '估算,读取本地 CLI 日志;Codex/Gemini 暂无法统计',
  });
}
