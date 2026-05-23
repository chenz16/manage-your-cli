import { listSkills } from '@holon/core';
import { SkillsClient } from './_components/SkillsClient';

/**
 * /skills — owner's built-in capability catalog. Per user 2026-05-17:
 *   "那你就不是员工把 就是老板的技能池的形式 这样更好"
 *
 * Each skill is a callable capability the Desk AI invokes inline
 * (shares chat context, fast, no separate job/deliverable record).
 * V1 = catalog UI + click-to-prefill-chat affordance. Execution is handled
 * by the subscribed CLI runtime, not by an in-app intelligence layer.
 */
export default function SkillsPage() {
  return <SkillsClient skills={listSkills()} />;
}

export const dynamic = 'force-dynamic';

