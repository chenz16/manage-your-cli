import { redirect } from 'next/navigation';
import { getOwner, listTemplates, isBuiltInTemplate } from '@holon/core';
import { TemplatesClient } from './_components/TemplatesClient';

/**
 * /templates - owner's reusable content-form catalog.
 */
export default function TemplatesPage() {
  if (getOwner().hidden_features.includes('templates')) redirect('/');
  const templates = listTemplates().map((t) => ({ ...t, _builtin: isBuiltInTemplate(t.id) }));
  return <TemplatesClient templates={templates} />;
}

export const dynamic = 'force-dynamic';
