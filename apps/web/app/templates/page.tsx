import { listTemplates, isBuiltInTemplate } from '@holon/core';
import { TemplatesClient } from './_components/TemplatesClient';

/**
 * /templates — owner's reusable content-form catalog. Sibling to
 * /skills: skills are ACTIONS the Desk AI calls inline, templates
 * are CONTENT FORMS the owner picks, fills, and ships as a draft.
 *
 * V1 = read-only catalog UI + copy-body / send-to-composer affordances.
 * Live placeholder substitution (form-fill flow) lands in a follow-up.
 */
export default function TemplatesPage() {
  const templates = listTemplates().map((t) => ({ ...t, _builtin: isBuiltInTemplate(t.id) }));
  return <TemplatesClient templates={templates} />;
}

export const dynamic = 'force-dynamic';
