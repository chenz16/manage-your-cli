import { listReferences, isBuiltInReference } from '@holon/core';
import { ReferencesClient } from './_components/ReferencesClient';

/**
 * /references — owner's external-document catalog. Sibling to /skills
 * and /templates:
 *
 *   - Skills are ACTIONS the Desk AI calls inline.
 *   - Templates are CONTENT FORMS the owner fills.
 *   - References are LOOKUPS — external standards / specs / regulations
 *     (WCAG, ISO, GDPR, PEP 8, OAuth, NIST CSF) that skills cite when
 *     running audits, reviews, or compliance checks.
 *
 * V1 = read-only catalog UI + "open source" affordance. We do NOT
 * ingest the full text of any reference — the descriptor stores
 * summary + canonical URL + jumplinks only.
 */
export default function ReferencesPage() {
  const references = listReferences().map((r) => ({ ...r, _builtin: isBuiltInReference(r.id) }));
  return <ReferencesClient references={references} />;
}

export const dynamic = 'force-dynamic';
