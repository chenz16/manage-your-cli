/**
 * CONNECTORS_MANIFEST — static catalogue of external-service connectors
 * the desk AI can be authorized to act on behalf of, plus the per-tool
 * risk classification used by the /me Authorizations UI.
 *
 * 2026-05-19 feat(connectors): introduced when we redesigned /me →
 * Authorizations to mirror Claude.ai's Connectors panel (3-column
 * Customize / Connectors / Detail layout). The shape here drives the
 * Detail pane's "Tool permissions" section verbatim — risk groups +
 * per-tool description.
 *
 * V1.0 frontend-only: per-tool policy is stored client-side in
 * localStorage under the keys defined in ConnectorsPanel.tsx
 * (`holon-connector-tool-<connectorId>-<toolId>` for the boolean
 * enable bit and `holon-connector-group-<connectorId>-<risk>` for
 * the group policy). V1.1 will migrate this to the BFF + SQLite once
 * the policy needs to be enforced server-side.
 *
 * Coming-soon connectors (status: 'coming_soon') render disabled in
 * the middle column and a placeholder in the detail pane. They live
 * here (not behind a feature flag) so the UI shows breadth honestly —
 * Claude.ai does the same thing on its Connectors panel.
 */

export interface ConnectorTool {
  id: string;
  label: string;
  risk: 'read' | 'write';
  description: string;
}

export interface ConnectorManifest {
  id: string;
  name: string;
  /** Single-glyph logo. Emoji for V1; swap to per-connector SVG in V1.1. */
  logo: string;
  category: 'web';
  status: 'active' | 'coming_soon';
  description: string;
  tools: ConnectorTool[];
}

export const CONNECTORS_MANIFEST: Record<string, ConnectorManifest> = {
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    logo: 'M',
    category: 'web',
    status: 'active',
    description:
      "Connect Gmail to Holon to quickly find important emails and understand long conversations. The desk AI can search through your messages, read entire email threads to give you context, and help you stay on top of inbox triage. Perfect for finding that message you remember sending, catching up on email chains you missed, or preparing for meetings.",
    tools: [
      {
        id: 'gmail.read_thread',
        label: 'Read email thread',
        risk: 'read',
        description: 'Retrieves a specific email thread from the authenticated user’s Gmail account.',
      },
      {
        id: 'gmail.list_labels',
        label: 'List labels',
        risk: 'read',
        description: 'Lists user-defined and system Gmail labels.',
      },
      {
        id: 'gmail.search',
        label: 'Search messages',
        risk: 'read',
        description: 'Searches for email threads from the authenticated user’s Gmail account.',
      },
      {
        id: 'gmail.create_draft_reply',
        label: 'Create draft reply',
        risk: 'write',
        description: 'Creates a draft reply email in the authenticated user’s Gmail account.',
      },
      {
        id: 'gmail.create_draft',
        label: 'Create draft',
        risk: 'write',
        description: 'Creates a new draft email.',
      },
      {
        id: 'gmail.delete_label',
        label: 'Delete label',
        risk: 'write',
        description: 'Deletes a label from the user’s Gmail account.',
      },
    ],
  },
  github: {
    id: 'github',
    name: 'GitHub Integration',
    logo: 'G',
    category: 'web',
    status: 'coming_soon',
    description:
      'Connect GitHub to let the desk AI browse repositories, open issues, summarize pull-request diffs, and trigger workflows. Wiring lands in iter-014+.',
    tools: [],
  },
  google_drive: {
    id: 'google_drive',
    name: 'Google Drive',
    logo: 'D',
    category: 'web',
    status: 'coming_soon',
    description:
      'Connect Google Drive so the desk AI can locate, summarise, and reference documents from your Drive across chats. Wiring lands in iter-014+.',
    tools: [],
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    logo: 'H',
    category: 'web',
    status: 'coming_soon',
    description:
      'Connect Hugging Face for model search, dataset lookup, and Space discovery directly from the desk AI. Wiring lands in iter-014+.',
    tools: [],
  },
};

// TODO(V1.1): replace `logo: string` with `logoSvg: ReactNode | string`
// once per-connector SVG icons land — single emoji is a stand-in.
// TODO(V1.1): migrate per-tool policy from localStorage to BFF +
// SQLite (`integration_tool_policy` table) keyed by owner_id + tool_id.
// TODO(V1.2): split `risk: 'read' | 'write'` into 3 tiers
// (read / write / admin) once we have a connector with admin scopes.
