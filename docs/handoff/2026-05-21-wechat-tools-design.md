# Design: WeChat Tool Suite for Owner Chat

Date: 2026-05-21
Status: design-ready, pickup by Codex
Related: wechat-owner-command.ts, wechat-read-pywxdump.py, wechat-read-server.mjs

## Problem

Currently only one WeChat operation exists: "read messages for a contact". Follow-up questions fail because:
1. No tool to query last message, search by keyword, list contacts, etc.
2. Read results not persisted in conversation context

## Tool Definitions

All tools call the wechat-read-server on port 8766. Backend is pywxdump (no DLL injection).

### 1. wechat_read
Read messages from a specific contact.
```
Input:  { contact: string, limit?: number (default 50), since_minutes?: number (default 1440) }
Output: { ok, contact, wxid, count, messages: [{time_utc, sender, type, text}] }
Server: GET /read?contact=NAME&limit=N&since_minutes=N
```

### 2. wechat_search
Search messages across all contacts by keyword.
```
Input:  { keyword: string, limit?: number (default 20), since_minutes?: number (default 4320) }
Output: { ok, keyword, count, messages: [{contact, time_utc, sender, type, text}] }
Server: GET /search?keyword=K&limit=N&since_minutes=N  (NEW endpoint)
```

### 3. wechat_last
Get the last N messages from a contact (shortcut for wechat_read with small limit).
```
Input:  { contact: string, count?: number (default 5) }
Output: same as wechat_read
Server: GET /read?contact=NAME&limit=N&since_minutes=43200
```

### 4. wechat_contacts
List contacts with recent activity.
```
Input:  { since_minutes?: number (default 1440), limit?: number (default 20) }
Output: { ok, contacts: [{name, wxid, last_message_time, message_count}] }
Server: GET /contacts?since_minutes=N&limit=N  (NEW endpoint)
```

### 5. wechat_summary
Summarize all WeChat activity for a time period (calls LLM).
```
Input:  { since_minutes?: number (default 1440) }
Output: { ok, summary: string, contact_count, message_count }
Server: Uses /contacts + /read for each active contact, then LLM summarizes
```

## Implementation Plan

### Phase 1: Backend (wechat-read-server.mjs + wechat-read-pywxdump.py)
- Add `/search` endpoint: query across all MSG*.db for keyword match
- Add `/contacts` endpoint: list contacts with recent messages (query MSG tables for distinct StrTalker + max CreateTime)
- Both use the same pywxdump decrypt pipeline

### Phase 2: Frontend routing (wechat-owner-command.ts)
- Extend intent detection to recognize search/last/contacts/summary patterns
- Map each pattern to the appropriate tool call
- Include raw tool output in the assistant response so follow-ups work

### Phase 3: Context persistence
- When any WeChat tool returns data, include the raw messages in the assistant response
- Format: structured section at the end of the response that the LLM can reference
- Example: `\n\n---\n[WeChat Data: 3 messages from Falcon Li]\n[1] 2026-05-21 02:01 me: 对\n[2] ...`
- This way, follow-up questions like "最后一条是啥" can be answered from context

## Intent Detection Patterns

```
wechat_read:     /读取|看看|看下/ + contact name + /微信|消息/
wechat_search:   /搜索|搜|查找|找/ + keyword + /微信/  OR  /谁.*提到|谁.*说/
wechat_last:     /最后|最新|刚才/ + contact + /消息|说了啥|发了啥/
wechat_contacts: /最近.*谁.*微信|谁给我发|微信.*活跃/
wechat_summary:  /总结.*微信|微信.*总结|今天.*微信/  (no specific contact)
```

## Pickup Instructions for Codex

1. Add `/search` and `/contacts` endpoints to `scripts/wechat-read-pywxdump.py`
2. Add corresponding handlers to `scripts/wechat-read-server.mjs`
3. Extend `apps/web/lib/wechat-owner-command.ts` with new intent patterns and tool dispatch
4. Ensure all tool outputs include raw message data in assistant response for context persistence
5. Test each tool with PowerShell curl (NOT Git Bash — encoding issue)
6. Run pnpm -F web typecheck

## Auto-create Staff Member (Owner Directive 2026-05-21)

When user configures WeChat Read connector in /connectors (status → connected), **auto-create a staff member "微信助手"**:

- id: `staff_wechat_specialist`
- name: "微信助手"
- role_name: "wechat_specialist" 
- role_label: "微信消息专员"
- substrate: { kind: "local_ai", tool_scope: ["wechat_read", "wechat_search", "wechat_contacts"] }
- system_prompt: "你是微信消息专员。你可以读取、搜索、总结owner的微信消息。使用工具获取数据后，用中文简洁回答。"
- Visible in /members as a regular team member
- Owner can @微信助手 in chat

Auto-creation trigger: connector status changes to "connected" in the WeChat Read flow.
Implementation: call `createStaff()` from `@holon/core` in the connector connect handler.

If the staff already exists (re-connect after disconnect), skip creation.
If user disconnects WeChat Read, keep the staff but mark tools as unavailable.
