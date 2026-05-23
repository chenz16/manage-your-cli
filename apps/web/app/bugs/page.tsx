import { redirect } from 'next/navigation';
import { getOwner } from '@holon/core';
import { BugsClient } from './_components/BugsClient';

/**
 * /bugs - file + track bug reports. Default-on (this app's lean nav is
 * Chat + Team + Today + Bug Report); hideable via /me.
 */
export default function BugsPage() {
  if (getOwner().hidden_features.includes('bugs')) redirect('/');
  return <BugsClient />;
}

export const dynamic = 'force-dynamic';
