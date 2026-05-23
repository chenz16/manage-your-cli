import { redirect } from 'next/navigation';
import { getOwner, getToday } from '@holon/core';
import { TodayClient } from './_components/TodayClient';

/**
 * Today page - work-in-flight tracker.
 */
export default async function TodayPage() {
  if (getOwner().hidden_features.includes('todo')) redirect('/');
  const data = getToday();
  return <TodayClient initial={data} />;
}

export const dynamic = 'force-dynamic';
