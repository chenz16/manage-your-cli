/* fixtures.js — static demo data for the Holon desk UI mock.
 *
 * Per iter-001a/plan.md Step 3:
 *   - 3 desks
 *   - 4 staff (substrate types: local_ai x2, cli, peer — "myself" removed per ADR-015)
 *   - 8 connections (covers all 6 health states + 2 healthy variants)
 *   - 12 missions (covers all 8 mission states)
 *   - 15 deliverables (5 local-AI produced, 5 remote returned, 5 submitted upstream)
 *
 * IDs use the {prefix}_{base32-uuidv7} convention from
 * docs/architecture/data-model.md § 2.2. The base32 suffixes here are
 * mock 26-char base32-looking strings, NOT real UUIDv7 values. Real UUIDv7
 * generation lands when the BFF is wired (V1 backend).
 *
 * Entity shapes match docs/architecture/data-model.md § 4 (subset of fields
 * relevant for the UI mock; backend will round-trip the full schema).
 *
 * Loaded as a classic <script> (not type="module") so it works under file://
 * without CORS errors on Linux/Chrome/Firefox. Sets a single global
 * window.HOLON_FIXTURES that today.js + staff.js read.
 */

(function () {
  'use strict';

  // ─── Desks ─────────────────────────────────────────────────────────────────
  const desks = [
    {
      id: 'desk_01HKQ8ALICEXJ7P2N6V9WB3KDM',
      person_id: 'person_01HKQ8ALICEPRSVQXC4GWJ7B0M',
      display_name: "Alice's laptop",
      device_kind: 'laptop',
      presence: 'online',
      is_primary: true,
      span_of_control_cap: 7,
    },
    {
      id: 'desk_01HKQ8ALICEPHN9R3XBTV2CKWFJ',
      person_id: 'person_01HKQ8ALICEPRSVQXC4GWJ7B0M',
      display_name: "Alice's phone",
      device_kind: 'phone',
      presence: 'background',
      is_primary: false,
      span_of_control_cap: 3,
    },
    {
      id: 'desk_01HKQ8WANGDESKM2X5YN8TBVQRP',
      person_id: 'person_01HKQ8WANGPRSWHZBC3XV6JKN9F',
      display_name: "Wang's desk",
      device_kind: 'desktop',
      presence: 'online',
      is_primary: true,
      span_of_control_cap: 7,
    },
  ];

  const PRIMARY_DESK_ID = desks[0].id;

  // ─── Staff (4: 2 local_ai, 1 cli, 1 peer) ──────────────────────────────────
  // Per requirements.md acceptance criterion #3 ("5 fixture staff").
  // Substrate coverage: local_ai x2 (Aria, Drafter), cli x1 (gh-cli),
  // peer x1 (Wang's Researcher). The former "myself" member (Alice) has been
  // removed per ADR-015: owner's work lives in Today personal queue, not here.
  // One local_ai (Drafter) is governance_mode=always_supervised so the
  // locked-slider visual ships.
  // Per ADR-002: the substrate formerly called "human" was renamed "myself".
  // Per ADR-015: "myself" substrate removed entirely; Substrate union is now
  //   local_ai | cli | peer (3 types).
  // Per ADR-003: the substrate formerly called "proxy" is now "peer".
  // Per ADR-004: autonomy_level values are now Supervised|Bounded|Autonomous.
  //   Mapping: L0→status:paused, L1+L2→Supervised, L3→Bounded, L4+L5→Autonomous.
  const staff = [
    {
      id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      desk_id: PRIMARY_DESK_ID,
      name: 'Aria',
      role_name: 'researcher',
      role_label: 'Researcher',
      substrate: {
        kind: 'local_ai',
        agent_profile_id: 'local_ai_research_v2',
        tool_scope: ['web_search', 'read_file', 'summarize'],
        budget: { max_tokens: 50000, max_cost_millicents: 1500 },
        // ADR-016: mentor peer array — V1 demo: 1 AI (Aria) + 1 mentor (Wang, also direct peer)
        mentors: [
          {
            peer_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
            domain: 'Vendor competitive research',
            invocation_policy: 'owner_picks_per_task',
            distillation_enabled: false, // V1
          },
        ],
      },
      autonomy_level: 'Bounded', // was L3 per ADR-004 mapping
      governance_mode: 'graduated',
      status: 'active',
      current_jobs: 2,
      max_concurrent_jobs: 3,
      cultivation_maturity: 4, // 0-5 pips
      // ADR-016: cultivation log records mentor consultations (V1 = log only; no formal handoff)
      cultivation_profile: {
        cultivation_log: [
          {
            kind: 'mentor_consultation',
            mentor_peer_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
            topic: 'vendor X pricing',
            consulted_at: '2026-05-14T10:22:00.000Z',
            summary: 'Wang confirmed X tier removed',
            outcome: 'applied',
          },
          {
            kind: 'mentor_consultation',
            mentor_peer_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
            topic: 'vendor Y discount calc',
            consulted_at: '2026-05-15T09:05:00.000Z',
            summary: 'Wang: standard 15% for net30',
            outcome: 'applied',
          },
        ],
      },
    },
    {
      id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
      desk_id: PRIMARY_DESK_ID,
      name: 'Drafter',
      role_name: 'communicator',
      role_label: 'Outbound Drafter',
      substrate: {
        kind: 'local_ai',
        agent_profile_id: 'local_ai_writing_v1',
        tool_scope: ['read_file', 'write_file'],
        budget: { max_tokens: 30000, max_cost_millicents: 800 },
      },
      autonomy_level: 'Supervised', // was L1 per ADR-004 mapping
      // Locked at Supervised — drafts outgoing customer comms; owner reviews
      // every send. Per local-agent-management.md § 7.7 (always_supervised flag).
      governance_mode: 'always_supervised',
      status: 'active',
      current_jobs: 1,
      max_concurrent_jobs: 2,
      cultivation_maturity: 3,
    },
    {
      id: 'staff_01HKQ8CLIGHEXECRVBN3XK7WTCQ',
      desk_id: PRIMARY_DESK_ID,
      name: 'gh-cli',
      role_name: 'executor',
      role_label: 'GitHub Executor',
      substrate: {
        kind: 'cli',
        binary: '/usr/local/bin/gh',
        args_template: '${operation} ${args}',
        approval_rules: [
          { operation_pattern: 'delete*', require_approval: true },
          { operation_pattern: 'pr merge*', require_approval: true },
        ],
      },
      autonomy_level: 'Supervised', // was L2 per ADR-004 mapping (status:paused; L0 dropped)
      governance_mode: 'graduated',
      status: 'paused',
      current_jobs: 0,
      max_concurrent_jobs: 1,
      cultivation_maturity: 1,
    },
    // Peer mirror of a remote desk's member (Wang's researcher).
    // Per ADR-003: substrate kind renamed from 'proxy' to 'peer'.
    // Counts toward span-of-control; lives at the seam between cores.
    {
      id: 'staff_01HKQ8PROXYWANGRESVBN3XKWTC',
      desk_id: PRIMARY_DESK_ID,
      name: "Wang's Researcher",
      role_name: 'researcher',
      role_label: 'Researcher (peer)', // was 'Researcher (proxy)' per ADR-003
      substrate: {
        kind: 'peer', // was 'proxy' per ADR-003
        connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
        remote_staff_name: "Wang's Researcher",
      },
      autonomy_level: 'Supervised', // was L1 per ADR-004 mapping; peer substrate is N/A but slider hidden in UI
      governance_mode: 'graduated',
      status: 'active',
      current_jobs: 0,
      max_concurrent_jobs: 1,
      cultivation_maturity: 0,
    },
    {
      id: 'staff_01HXQF8XIAOFEI4M7N2VBCXJ9W',
      desk_id: PRIMARY_DESK_ID,
      name: '小菲',
      role_name: 'secretary',
      role_label: '文秘',
      substrate: {
        kind: 'local_ai',
        agent_profile_id: 'local_ai_writing_v1',
        tool_scope: ['read_file', 'write_file', 'summarize'],
        budget: { max_tokens: 30000, max_cost_millicents: 500 },
      },
      autonomy_level: 'Supervised',
      governance_mode: 'always_supervised',
      status: 'active',
      current_jobs: 0,
      max_concurrent_jobs: 2,
      cultivation_maturity: 1,
    },
  ];

  // ─── Owner personal work queue (ADR-015) ──────────────────────────────────
  // Items the desk owner (Alice) is doing themselves — lives in Today, not
  // in Members. source: "own" = self-created; "from_mission" = accepted
  // inbound mission routed to owner rather than delegated.
  const myWorkQueue = [
    {
      id: 'pq_01HKQ8PQBUDGETAPPRVBNXKWTCQ',
      title: 'Approve Q2 budget',
      body: 'Finance submitted the Q2 operating budget for review. Three line items flagged for discretionary spend above $10k. Needs sign-off before EOD Friday.',
      source: 'from_mission',
      priority: 90,
      deadline: '2026-05-16T17:00:00.000Z',
    },
    {
      id: 'pq_01HKQ8PQINVESTOREMVBNXKWTCQ',
      title: 'Reply to investor email',
      body: 'Mateo forwarded a question from Series A lead about Q1 ARR growth. Needs a direct reply from me — not delegatable per investor preference.',
      source: 'from_mission',
      priority: 80,
      deadline: '2026-05-16T12:00:00.000Z',
    },
    {
      id: 'pq_01HKQ8PQSALLYDRAFTVBNXKWTCQ',
      title: "Review Sally's draft",
      body: "Sally sent over the v2 product brief for the Holon public launch. Needs a close read for accuracy + tone before it goes to the designer. About 1,200 words.",
      source: 'own',
      priority: 65,
      deadline: '2026-05-17T18:00:00.000Z',
    },
    {
      id: 'pq_01HKQ8PQNDACOSINVBNXKWTCQM',
      title: 'Sign quarterly compliance attestation',
      body: 'Two-party signoff required on the SOC 2 quarterly compliance statement. Felix is the cosigner; connection currently degraded — may need to follow up directly.',
      source: 'from_mission',
      priority: 90,
      deadline: '2026-05-15T23:59:00.000Z',
    },
    {
      id: 'pq_01HKQ8PQWEEKLYRETVBNXKWTCQ',
      title: 'Write weekly retro note',
      body: 'Standing Friday ritual: 3-5 bullet reflection on what shipped, what blocked, and one thing to do differently next week. Posted to team channel.',
      source: 'own',
      priority: 40,
      deadline: '2026-05-15T18:00:00.000Z',
    },
  ];

  // ─── Connections (8: full coverage of 6 health states + 2 extra healthy) ───
  const connections = [
    {
      id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8WANGPRSWHZBC3XV6JKN9F',
      display_name: 'Wang',
      health_state: 'healthy',
      last_successful_at: '2026-05-15T13:42:18.220Z',
      paired_at: '2026-04-02T09:11:03.000Z',
      remote_desk_capabilities: ['research', 'review', 'translate'],
    },
    {
      id: 'conn_01HKQ8ACMECONNVBNKM7XW9TCQR',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8ACMEORGRSWHCV3XVK7N9F',
      display_name: 'Acme Corp · Procurement',
      health_state: 'healthy',
      last_successful_at: '2026-05-15T08:14:00.103Z',
      paired_at: '2026-03-12T14:00:00.000Z',
      remote_desk_capabilities: ['contract_review', 'invoicing'],
    },
    {
      id: 'conn_01HKQ8DEGRADEDVBN3XK7WTCQMP',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8FELIXPRSWHCV3XVK7N9FB',
      display_name: 'Felix',
      health_state: 'degraded',
      last_successful_at: '2026-05-14T22:18:51.040Z',
      last_failure_at: '2026-05-15T11:02:09.781Z',
      last_failure_reason: 'Latency above SLO (p95=4.2s)',
      paired_at: '2026-02-20T10:00:00.000Z',
      remote_desk_capabilities: ['drafting'],
    },
    {
      id: 'conn_01HKQ8OFFLINEVBN3XK7WTCQMPR',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8GIORGIOPRSWHCV3XVK7B',
      display_name: 'Giorgio',
      health_state: 'offline',
      last_successful_at: '2026-05-13T17:30:00.000Z',
      last_failure_at: '2026-05-15T09:45:12.000Z',
      last_failure_reason: 'Peer desk unreachable for 28h',
      paired_at: '2026-01-15T08:00:00.000Z',
      remote_desk_capabilities: ['research'],
    },
    {
      id: 'conn_01HKQ8RETRYINGVBN3XK7WTCQMP',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8MORGANPRSWHCV3XVK7N9',
      display_name: 'Morgan',
      health_state: 'retrying',
      last_successful_at: '2026-05-15T07:00:00.000Z',
      last_failure_at: '2026-05-15T13:55:02.000Z',
      last_failure_reason: 'Transient 503 from relay; backoff 2m',
      paired_at: '2026-03-30T11:00:00.000Z',
      remote_desk_capabilities: ['planning'],
    },
    {
      id: 'conn_01HKQ8REVOKEDVBN3XK7WTCQMPN',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8FORMERPRSWHCV3XVK7B9',
      display_name: 'Former vendor',
      health_state: 'revoked',
      last_successful_at: '2026-04-22T12:00:00.000Z',
      paired_at: '2025-11-01T08:00:00.000Z',
      revoked_at: '2026-05-01T10:00:00.000Z',
      revoked_reason: 'Engagement ended; relationship closed by owner',
      remote_desk_capabilities: ['archived'],
    },
    {
      id: 'conn_01HKQ8INVALIDTOKENVBNKWTCQM',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8RENEEPRSWHCV3XVK7N9F',
      display_name: 'Renee',
      health_state: 'invalid_token',
      last_successful_at: '2026-05-10T14:30:00.000Z',
      last_failure_at: '2026-05-15T13:01:44.000Z',
      last_failure_reason: 'Signing key rotated remotely; re-pair required',
      paired_at: '2026-03-10T08:00:00.000Z',
      remote_desk_capabilities: ['review'],
    },
    {
      id: 'conn_01HKQ8HEALTHY3VBN3XK7WTCQMP',
      desk_id: PRIMARY_DESK_ID,
      remote_person_id: 'person_01HKQ8MATEOPRSWHCV3XVK7N9F',
      display_name: 'Mateo',
      health_state: 'healthy',
      last_successful_at: '2026-05-15T13:50:00.000Z',
      paired_at: '2026-04-18T09:00:00.000Z',
      remote_desk_capabilities: ['communication', 'translate'],
    },
  ];

  // ─── Missions (12, covering all 8 states) ──────────────────────────────────
  // States: queued, accepted, in_progress, blocked, submitted, rejected,
  // expired, returned_to_origin
  const missions = [
    {
      id: 'mission_01HKQ8MISN1VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND1VBN3XK7WTCQMPRD',
      title: 'Summarize Q2 supplier contracts',
      body: 'Need a 1-page summary of changes from Q1 baseline. Cite each contract.',
      state: 'queued',
      priority: 70,
      sender_display_name: 'Acme Corp · Procurement',
      sender_connection_id: 'conn_01HKQ8ACMECONNVBNKM7XW9TCQR',
      form: 'standing_request',
      created_at: '2026-05-15T13:40:18.000Z',
      deadline_at: '2026-05-17T17:00:00.000Z',
    },
    {
      id: 'mission_01HKQ8MISN2VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND2VBN3XK7WTCQMPRD',
      title: 'Review NDA draft',
      body: 'Counterparty proposed redlines on §4 and §7. Flag anything unusual.',
      state: 'queued',
      priority: 85,
      sender_display_name: 'Wang',
      sender_connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
      form: 'advisory',
      created_at: '2026-05-15T13:12:02.000Z',
      deadline_at: '2026-05-16T12:00:00.000Z',
    },
    {
      id: 'mission_01HKQ8MISN3VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND3VBN3XK7WTCQMPRD',
      title: 'Find recent papers on world-models for AV',
      body: 'Last 6 months. Skip survey papers.',
      state: 'accepted',
      priority: 50,
      sender_display_name: 'Mateo',
      sender_connection_id: 'conn_01HKQ8HEALTHY3VBN3XK7WTCQMP',
      form: 'direct_order',
      created_at: '2026-05-15T11:20:00.000Z',
      accepted_at: '2026-05-15T11:45:00.000Z',
    },
    {
      id: 'mission_01HKQ8MISN4VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND4VBN3XK7WTCQMPRD',
      title: 'Translate engineering spec to JP',
      body: 'Section 3 only. Keep terminology consistent with prior glossary.',
      state: 'in_progress',
      priority: 60,
      sender_display_name: 'Wang',
      sender_connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
      form: 'direct_order',
      created_at: '2026-05-15T09:00:00.000Z',
      accepted_at: '2026-05-15T09:15:00.000Z',
      in_progress_at: '2026-05-15T09:20:00.000Z',
      assigned_staff_id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
    },
    {
      id: 'mission_01HKQ8MISN5VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND5VBN3XK7WTCQMPRD',
      title: 'Draft response to procurement RFI',
      body: '12 questions; pull from previous proposal where relevant.',
      state: 'in_progress',
      priority: 75,
      sender_display_name: 'Acme Corp · Procurement',
      sender_connection_id: 'conn_01HKQ8ACMECONNVBNKM7XW9TCQR',
      form: 'subcontracting',
      created_at: '2026-05-15T08:30:00.000Z',
      accepted_at: '2026-05-15T08:45:00.000Z',
      in_progress_at: '2026-05-15T09:00:00.000Z',
      assigned_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
    },
    {
      id: 'mission_01HKQ8MISN6VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND6VBN3XK7WTCQMPRD',
      title: 'Sign quarterly compliance attestation',
      body: 'Two-party signoff required.',
      state: 'blocked',
      state_reason: 'Awaiting cosigner — Felix unreachable (connection degraded)',
      priority: 90,
      sender_display_name: 'Felix',
      sender_connection_id: 'conn_01HKQ8DEGRADEDVBN3XK7WTCQMP',
      form: 'dual_authorization',
      created_at: '2026-05-14T16:00:00.000Z',
      accepted_at: '2026-05-14T16:30:00.000Z',
      blocked_at: '2026-05-15T11:00:00.000Z',
    },
    {
      id: 'mission_01HKQ8MISN7VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND7VBN3XK7WTCQMPRD',
      title: 'Prepare research brief on autonomy slider UX patterns',
      body: 'Compare 5 competing products; recommend pattern for V2.',
      state: 'submitted',
      priority: 55,
      sender_display_name: 'Mateo',
      sender_connection_id: 'conn_01HKQ8HEALTHY3VBN3XK7WTCQMP',
      form: 'direct_order',
      created_at: '2026-05-14T10:00:00.000Z',
      accepted_at: '2026-05-14T10:30:00.000Z',
      in_progress_at: '2026-05-14T10:45:00.000Z',
      submitted_at: '2026-05-15T10:55:18.000Z',
      assigned_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
    },
    {
      id: 'mission_01HKQ8MISN8VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND8VBN3XK7WTCQMPRD',
      title: 'Edit marketing copy for landing page',
      body: 'Tone: warm and grounded. 4 sections.',
      state: 'submitted',
      priority: 40,
      sender_display_name: 'Wang',
      sender_connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
      form: 'standing_request',
      created_at: '2026-05-13T14:00:00.000Z',
      accepted_at: '2026-05-13T14:15:00.000Z',
      in_progress_at: '2026-05-13T14:20:00.000Z',
      submitted_at: '2026-05-15T08:42:00.000Z',
      assigned_staff_id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
    },
    {
      id: 'mission_01HKQ8MISN9VBN3XK7WTCQMPRD',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND9VBN3XK7WTCQMPRD',
      title: 'Onboard new vendor (background check)',
      body: 'Standard onboarding form — vendor declined; rejecting per policy.',
      state: 'rejected',
      state_reason: 'Form not supported by this desk (pre-vetting required)',
      priority: 20,
      sender_display_name: 'Renee',
      sender_connection_id: 'conn_01HKQ8INVALIDTOKENVBNKWTCQM',
      form: 'direct_order',
      created_at: '2026-05-12T11:00:00.000Z',
      rejected_at: '2026-05-12T15:00:00.000Z',
    },
    {
      id: 'mission_01HKQ8MISN10VBN3XK7WTCQMPR',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND10VBN3XK7WTCQMPR',
      title: 'Time-bounded RFP draft',
      body: '48h window — owner did not accept in time.',
      state: 'expired',
      state_reason: 'Deadline passed without acceptance',
      priority: 30,
      sender_display_name: 'Giorgio',
      sender_connection_id: 'conn_01HKQ8OFFLINEVBN3XK7WTCQMPR',
      form: 'standing_request',
      created_at: '2026-05-10T09:00:00.000Z',
      expired_at: '2026-05-12T09:00:00.000Z',
    },
    {
      id: 'mission_01HKQ8MISN11VBN3XK7WTCQMPR',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND11VBN3XK7WTCQMPR',
      title: 'Returned: synthesis of partner feedback',
      body: 'Completed locally and shipped back upstream; record kept for audit.',
      state: 'returned_to_origin',
      priority: 65,
      sender_display_name: 'Wang',
      sender_connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
      form: 'subcontracting',
      created_at: '2026-05-10T13:00:00.000Z',
      accepted_at: '2026-05-10T13:30:00.000Z',
      in_progress_at: '2026-05-10T13:35:00.000Z',
      submitted_at: '2026-05-12T16:00:00.000Z',
      returned_to_origin_at: '2026-05-13T09:00:00.000Z',
      assigned_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
    },
    {
      id: 'mission_01HKQ8MISN12VBN3XK7WTCQMPR',
      desk_id: PRIMARY_DESK_ID,
      inbound_handoff_id: 'handoff_01HKQ8HND12VBN3XK7WTCQMPR',
      title: 'Quarterly review note',
      body: 'Owner-acknowledged advisory; archived after read.',
      state: 'returned_to_origin',
      priority: 25,
      sender_display_name: 'Mateo',
      sender_connection_id: 'conn_01HKQ8HEALTHY3VBN3XK7WTCQMP',
      form: 'observer_brief',
      created_at: '2026-05-09T08:00:00.000Z',
      accepted_at: '2026-05-09T08:10:00.000Z',
      submitted_at: '2026-05-09T08:30:00.000Z',
      returned_to_origin_at: '2026-05-09T09:00:00.000Z',
    },
  ];

  // ─── Deliverables (15: 5 local-AI produced, 5 remote-returned, 5 submitted) ─
  // iter-001c adds a `status` field per deliverable-spec.md §3 lifecycle:
  // draft | final | accepted | rejected | revised.
  const deliverables = [
    // ── 5 locally produced (source_assignment_id set) ──
    {
      id: 'deliv_01HKQ8DLV01VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN01VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Aria — Q2 supplier contract diff (draft)',
      body_kind: 'markdown',
      body: { markdown: 'Six contracts changed terms vs Q1...' },
      author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      author_remote_desk_id: null,
      created_at: '2026-05-15T12:30:00.000Z',
      origin_label: 'local',
      status: 'draft',
    },
    {
      id: 'deliv_01HKQ8DLV02VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN02VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Drafter — landing-page copy v3',
      body_kind: 'markdown',
      body: { markdown: '## Section 1: Problem...' },
      author_staff_id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
      author_remote_desk_id: null,
      created_at: '2026-05-15T08:42:00.000Z',
      origin_label: 'local',
      status: 'final',
    },
    {
      id: 'deliv_01HKQ8DLV03VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN03VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Aria — NDA §4 redline review',
      body_kind: 'structured',
      body: { findings: 4, severity: 'low' },
      author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      author_remote_desk_id: null,
      created_at: '2026-05-15T07:15:00.000Z',
      origin_label: 'local',
      status: 'draft',
    },
    {
      id: 'deliv_01HKQ8DLV04VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN04VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Aria — autonomy-slider UX research brief',
      body_kind: 'markdown',
      body: { markdown: 'Five competing products surveyed...' },
      author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      author_remote_desk_id: null,
      created_at: '2026-05-15T10:55:18.000Z',
      origin_label: 'local',
      status: 'final',
    },
    {
      id: 'deliv_01HKQ8DLV05VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN05VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Drafter — Japanese translation §3',
      body_kind: 'markdown',
      body: { markdown: '日本語訳セクション 3...' },
      author_staff_id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
      author_remote_desk_id: null,
      created_at: '2026-05-15T13:30:00.000Z',
      origin_label: 'local',
      status: 'final',
    },

    // ── 5 remote-returned (source_mission_id set; came back from upstream) ──
    {
      id: 'deliv_01HKQ8DLV06VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: null,
      source_mission_id: 'mission_01HKQ8MISN11VBN3XK7WTCQMPR',
      title: "Wang's Researcher — partner-feedback synthesis",
      body_kind: 'markdown',
      body: { markdown: 'Three themes emerged from 14 partner notes...' },
      author_staff_id: null,
      author_remote_desk_id: 'desk_01HKQ8WANGDESKM2X5YN8TBVQRP',
      created_at: '2026-05-13T09:00:00.000Z',
      origin_label: 'remote',
      status: 'accepted',
    },
    {
      id: 'deliv_01HKQ8DLV07VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: null,
      source_mission_id: 'mission_01HKQ8MISN12VBN3XK7WTCQMPR',
      title: 'Mateo — quarterly review note',
      body_kind: 'markdown',
      body: { markdown: 'Q2 looks on-track; one risk flagged in §3.' },
      author_staff_id: null,
      author_remote_desk_id: 'desk_01HKQ8MATEODESKM2X5YN8TBVQR',
      created_at: '2026-05-09T09:00:00.000Z',
      origin_label: 'remote',
      status: 'accepted',
    },
    {
      id: 'deliv_01HKQ8DLV08VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: null,
      source_mission_id: 'mission_01HKQ8MISN03RETRNVBNTCQXXX',
      title: 'Acme · Procurement — invoice batch summary',
      body_kind: 'structured',
      body: { invoices: 7, total_cents: 412300 },
      author_staff_id: null,
      author_remote_desk_id: 'desk_01HKQ8ACMEDESKM2X5YN8TBVQRP',
      created_at: '2026-05-08T14:20:00.000Z',
      origin_label: 'remote',
      status: 'revised',
    },
    {
      id: 'deliv_01HKQ8DLV09VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: null,
      source_mission_id: 'mission_01HKQ8MISN04RETRNVBNTCQXXX',
      title: 'Felix — copy-edit return',
      body_kind: 'markdown',
      body: { markdown: '7 grammar fixes; 2 tone suggestions.' },
      author_staff_id: null,
      author_remote_desk_id: 'desk_01HKQ8FELIXDESKM2X5YN8TBVQR',
      created_at: '2026-05-07T11:00:00.000Z',
      origin_label: 'remote',
      status: 'accepted',
    },
    {
      id: 'deliv_01HKQ8DLV10VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: null,
      source_mission_id: 'mission_01HKQ8MISN05RETRNVBNTCQXXX',
      title: 'Morgan — planning notes (sub-handoff disclosure)',
      body_kind: 'markdown',
      body: { markdown: 'Decomposed into 4 milestones...' },
      author_staff_id: null,
      author_remote_desk_id: 'desk_01HKQ8MORGANDESKM2X5YN8TBVQ',
      created_at: '2026-05-06T16:30:00.000Z',
      origin_label: 'remote',
      status: 'rejected',
    },

    // ── 5 submitted upstream (locally produced, sent to a remote requester) ──
    {
      id: 'deliv_01HKQ8DLV11VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN11VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Submitted to Wang — translated engineering spec §3',
      body_kind: 'markdown',
      body: { markdown: '日本語訳完了。' },
      author_staff_id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
      author_remote_desk_id: null,
      created_at: '2026-05-15T13:55:00.000Z',
      origin_label: 'submitted',
      status: 'accepted',
      submitted_to_connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
    },
    {
      id: 'deliv_01HKQ8DLV12VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN12VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Submitted to Mateo — autonomy-slider UX brief',
      body_kind: 'markdown',
      body: { markdown: 'See attached.' },
      author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      author_remote_desk_id: null,
      created_at: '2026-05-15T11:00:00.000Z',
      origin_label: 'submitted',
      status: 'final',
      submitted_to_connection_id: 'conn_01HKQ8HEALTHY3VBN3XK7WTCQMP',
    },
    {
      id: 'deliv_01HKQ8DLV13VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN13VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Submitted to Acme — RFI response (12 questions)',
      body_kind: 'markdown',
      body: { markdown: 'Q1-Q12 answered; references inline.' },
      author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      author_remote_desk_id: null,
      created_at: '2026-05-15T09:30:00.000Z',
      origin_label: 'submitted',
      status: 'final',
      submitted_to_connection_id: 'conn_01HKQ8ACMECONNVBNKM7XW9TCQR',
    },
    {
      id: 'deliv_01HKQ8DLV14VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN14VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Submitted to Wang — landing-page copy v3 (final)',
      body_kind: 'markdown',
      body: { markdown: 'Approved + shipped.' },
      author_staff_id: 'staff_01HKQ8DRAFTERVB7KN3X9WTCQMP',
      author_remote_desk_id: null,
      created_at: '2026-05-15T08:50:00.000Z',
      origin_label: 'submitted',
      status: 'accepted',
      submitted_to_connection_id: 'conn_01HKQ8WANGCONNXVB7N3K9WTCQM',
    },
    {
      id: 'deliv_01HKQ8DLV15VBN3XK7WTCQMPRDX',
      desk_id: PRIMARY_DESK_ID,
      source_assignment_id: 'assign_01HKQ8ASN15VBN3XK7WTCQMPRDX',
      source_mission_id: null,
      title: 'Submitted to Felix — NDA review notes (cosign pending)',
      body_kind: 'structured',
      body: { findings: 4, cosign_pending: true },
      author_staff_id: 'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      author_remote_desk_id: null,
      created_at: '2026-05-14T17:00:00.000Z',
      origin_label: 'submitted',
      status: 'revised',
      submitted_to_connection_id: 'conn_01HKQ8DEGRADEDVBN3XK7WTCQMP',
    },
  ];

  // ─── Synthetic recent-events feed (derived for Today screen) ───────────────
  // Built from missions + deliverables + connections so it stays consistent
  // with the rest of the fixture set when the human edits one entity.
  const recentEvents = [
    { at: '2026-05-15T13:55:18.000Z', kind: 'submitted',     text: 'Drafter submitted <strong>Japanese translation §3</strong> to Wang.' },
    { at: '2026-05-15T13:50:00.000Z', kind: 'connection',    text: 'Mateo connection: <strong>healthy</strong> (heartbeat OK).' },
    { at: '2026-05-15T13:42:18.000Z', kind: 'connection',    text: 'Wang connection: <strong>healthy</strong> (heartbeat OK).' },
    { at: '2026-05-15T13:40:18.000Z', kind: 'mission',       text: '<strong>Acme · Procurement</strong> sent: <em>Summarize Q2 supplier contracts</em> (queued).' },
    { at: '2026-05-15T13:30:00.000Z', kind: 'deliverable',   text: 'Drafter completed <strong>Japanese translation §3</strong>.' },
    { at: '2026-05-15T13:12:02.000Z', kind: 'mission',       text: '<strong>Wang</strong> sent: <em>Review NDA draft</em> (queued; deadline tomorrow).' },
    { at: '2026-05-15T13:01:44.000Z', kind: 'connection',    text: 'Renee connection: <strong>invalid_token</strong> — re-pair required.' },
    { at: '2026-05-15T11:45:00.000Z', kind: 'mission',       text: 'Accepted: <em>Find recent papers on world-models for AV</em> (Mateo).' },
    { at: '2026-05-15T11:02:09.000Z', kind: 'connection',    text: 'Felix connection: <strong>degraded</strong> (latency above SLO).' },
    { at: '2026-05-15T11:00:00.000Z', kind: 'mission',       text: '<em>Sign quarterly compliance attestation</em> blocked: cosigner unreachable.' },
    { at: '2026-05-15T10:55:18.000Z', kind: 'submitted',     text: 'Aria submitted <strong>autonomy-slider UX brief</strong> to Mateo.' },
    { at: '2026-05-15T09:45:12.000Z', kind: 'connection',    text: 'Giorgio connection: <strong>offline</strong> (28h since last contact).' },
    { at: '2026-05-15T08:42:00.000Z', kind: 'submitted',     text: 'Drafter submitted <strong>landing-page copy v3</strong> to Wang.' },
    { at: '2026-05-15T08:14:00.000Z', kind: 'connection',    text: 'Acme · Procurement connection: <strong>healthy</strong>.' },
    { at: '2026-05-15T07:15:00.000Z', kind: 'deliverable',   text: 'Aria completed <strong>NDA §4 redline review</strong> (locked; awaiting your sign).' },
  ];

  // ─── Owner assistant member (ADR-013: "Myself" chat scope) ────────────────
  // Special member with role owner_assistant; has tools and global desk context.
  // Not part of the flat roster — lives only in the chat layer.
  const ownerAssistant = {
    id:         'staff_01HKQ8OWNERASSISTVBN3XKWTCQ',
    name:       'Myself (Desk AI)',
    role_name:  'owner_assistant',
    role_label: 'Owner Assistant',
    substrate: {
      kind: 'local_ai',
      agent_profile_id: 'local_ai_owner_v1',
      tool_scope: ['create_assignment', 'list_missions', 'ping_member', 'read_desk_context'],
    },
  };

  // ─── Chat threads (3: Myself, Sally/Aria, Wang) ────────────────────────────
  // Per ADR-013 mock content requirements.
  // Thread shape:
  //   id, participant_name, participant_role, staff_id (optional),
  //   messages: [{ role:'user'|'agent', ts, body, tool_call?, citations? }]
  //
  // role: 'user' = desk owner (Alice/Chen); 'agent' = the participant.
  // tool_call: { icon, name, args }
  // citations: [{ id, label }] — referenced in body as {cite:id}
  const chatThreads = [

    // ── Thread 1: "Myself" assistant (owner_assistant) ─────────────────────
    // Demonstrates orchestration use case.
    {
      id:               'thread_01MYSELF',
      participant_name: 'Myself (Desk AI)',
      participant_role: 'owner_assistant',
      staff_id:         ownerAssistant.id,
      messages: [
        {
          role: 'user',
          ts:   '09:11',
          body: 'What missions are blocked right now?',
        },
        {
          role: 'agent',
          ts:   '09:11',
          tool_call: {
            icon: '🔍',
            name: 'list_missions',
            args: 'filter: state=blocked',
          },
          body: 'Querying mission inbox…',
        },
        {
          role: 'agent',
          ts:   '09:11',
          body: 'You have 2 blocked missions:\n\n• "Compile Q1 report" — waiting on Sally for data input.\n• "Vendor research" (Mission #MISN6) — deadline passed, no acceptance from Wang.\n\nWant me to ping them?',
        },
        {
          role: 'user',
          ts:   '09:12',
          body: 'Ping Wang.',
        },
        {
          role: 'agent',
          ts:   '09:12',
          tool_call: {
            icon: '📤',
            name: 'ping_member',
            args: 'target: Wang · mission_id: MISN6 · message: "Follow-up: vendor research deadline passed"',
          },
          body: 'Sending follow-up to Wang via Mission #MISN6…',
        },
        {
          role: 'agent',
          ts:   '09:12',
          body: 'Done. Wang\'s desk shows "received 1 min ago". I\'ve also flagged the mission as awaiting-response in your inbox.',
        },
        {
          role: 'user',
          ts:   '09:13',
          body: 'Good. What\'s on my plate for the rest of the day?',
        },
        {
          role: 'agent',
          ts:   '09:13',
          tool_call: {
            icon: '🔍',
            name: 'read_desk_context',
            args: 'scope: today · filter: owner_action_required',
          },
          body: '3 items need your attention today:\n\n1. Review NDA draft from Wang — deadline tomorrow 12:00.\n2. Approve Drafter\'s landing-page copy v3 before it ships.\n3. Sign quarterly compliance attestation (blocked on Felix; you can escalate).',
        },
      ],
    },

    // ── Thread 2: Chat with Aria (Researcher / local_ai) ───────────────────
    // Demonstrates ad-hoc question, no formal mission, with citation chip.
    {
      id:               'thread_01ARIA',
      participant_name: 'Aria',
      participant_role: 'researcher',
      staff_id:         'staff_01HKQ8RSCHRK4M7N2VBCXJ9WDPT',
      messages: [
        {
          role: 'user',
          ts:   '10:44',
          body: 'Aria, quick — what\'s the latest on competitor X\'s pricing?',
        },
        {
          role: 'agent',
          ts:   '10:44',
          tool_call: {
            icon: '🔍',
            name: 'search_deliverables',
            args: 'query: "competitor X pricing" · date_range: last_30_days',
          },
          body: 'Searching deliverables…',
        },
        {
          role: 'agent',
          ts:   '10:44',
          body: 'From a mission 2 weeks ago {cite:deliv_pricing_research}, competitor X had 3 tiers: $9 / $19 / $49. Their site now shows the $9 tier is gone — only 2 tiers remain.',
          citations: [
            { id: 'deliv_pricing_research', label: 'Competitor X Pricing Research (May 1)' },
          ],
        },
        {
          role: 'user',
          ts:   '10:45',
          body: 'Did they raise prices?',
        },
        {
          role: 'agent',
          ts:   '10:45',
          body: 'The mid tier went from $19 → $24 (~26% increase). The top tier ($49) is unchanged. Looks like they dropped the entry tier and nudged everyone to mid.',
        },
      ],
    },

    // ── Thread 3: Chat with Wang (peer) ────────────────────────────────────
    // Demonstrates cross-desk conversation before a formal mission.
    {
      id:               'thread_01WANG',
      participant_name: 'Wang',
      participant_role: 'peer',
      staff_id:         'staff_01HKQ8PROXYWANGRESVBN3XKWTC',
      messages: [
        {
          role: 'user',
          ts:   '13:05',
          body: 'Wang, before I send a formal mission — do you have capacity for next week\'s market analysis?',
        },
        {
          role: 'agent',
          ts:   '13:06',
          streaming: true,
          body: '',
        },
        {
          role: 'agent',
          ts:   '13:07',
          body: 'Yeah, can take it. One constraint: my AI Researcher is at capacity Mon/Tue — heavy sprint. Wed onward is totally open.',
        },
        {
          role: 'user',
          ts:   '13:07',
          body: 'Cool, I\'ll send it with a Wed start date. Should take 2–3 days.',
        },
        {
          role: 'agent',
          ts:   '13:08',
          body: 'Works for me. Flag it as "analysis" form so my router assigns it correctly. Talk soon.',
        },
      ],
    },
  ];

  // ─── Export ────────────────────────────────────────────────────────────────
  const fixtures = {
    desks: desks,
    primary_desk_id: PRIMARY_DESK_ID,
    staff: staff,
    my_work_queue: myWorkQueue,
    owner_assistant: ownerAssistant,
    connections: connections,
    missions: missions,
    deliverables: deliverables,
    recent_events: recentEvents,
    chat_threads: chatThreads,
  };

  // Classic-script global (works under file:// without CORS issues).
  window.HOLON_FIXTURES = fixtures;
})();
