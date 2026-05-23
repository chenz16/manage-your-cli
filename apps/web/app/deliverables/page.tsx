import { redirect } from 'next/navigation';
import { getOwner, listDeliverables } from '@holon/core';
import { DeliverablesClient } from './_components/DeliverablesClient';

/**
 * Deliverables page - list comes from `listDeliverables()` in-process.
 */
export default async function DeliverablesPage() {
  if (getOwner().hidden_features.includes('deliverables')) redirect('/');
  const data = listDeliverables();
  return <DeliverablesClient initial={data} />;
}

export const dynamic = 'force-dynamic';
