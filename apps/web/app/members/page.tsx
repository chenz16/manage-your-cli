import type { OwnerAssistant } from '@holon/api-contract';
import { listMembers, loadFixtures } from '@holon/core';
import { MembersClient } from './_components/MembersClient';

export const dynamic = 'force-dynamic';

/**
 * Members page — owner_assistant ("Me · Desk AI") rendered first per
 * user feedback "me其实是我的小秘 代理 你要买放在member下面第一个".
 * Owner assistant is NOT a Staff record (ADR-015), so we load it
 * directly from the fixture server-side and pass it as a separate
 * prop to the client.
 *
 * Roster comes from `listMembers()` in-process — calling the BFF over
 * HTTP from the server component triggered a second route compile on
 * dev cold-start and an unnecessary roundtrip, making first-paint slow
 * (bug-20260517-201500-153lwnta).
 */
export default async function MembersPage() {
  const data = listMembers();
  const fx = loadFixtures();
  const owner: OwnerAssistant = fx.owner_assistant;
  return <MembersClient initial={data} owner={owner} />;
}
