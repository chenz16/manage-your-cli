import { redirect } from 'next/navigation';
import { getOwner, listReferences, isBuiltInReference } from '@holon/core';
import { ReferencesClient } from './_components/ReferencesClient';

/**
 * /references - owner's external-document catalog.
 */
export default function ReferencesPage() {
  if (getOwner().hidden_features.includes('references')) redirect('/');
  const references = listReferences().map((r) => ({ ...r, _builtin: isBuiltInReference(r.id) }));
  return <ReferencesClient references={references} />;
}

export const dynamic = 'force-dynamic';
