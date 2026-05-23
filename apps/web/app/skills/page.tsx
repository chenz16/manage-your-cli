import { redirect } from 'next/navigation';
import { getOwner, listSkills } from '@holon/core';
import { SkillsClient } from './_components/SkillsClient';

/**
 * /skills - owner's built-in capability catalog.
 */
export default function SkillsPage() {
  if (getOwner().hidden_features.includes('skills')) redirect('/');
  return <SkillsClient skills={listSkills()} />;
}

export const dynamic = 'force-dynamic';
