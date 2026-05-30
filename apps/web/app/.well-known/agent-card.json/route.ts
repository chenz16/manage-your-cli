/**
 * A2A Agent Card — Slice A (read-only discovery).
 * Spec: A2A protocolVersion 0.2.0
 * ADR: docs/adr/ADR-A2A-interconnect.md
 *
 * This route is intentionally public (no auth). It carries NO secrets,
 * tokens, or API keys — only structural discovery metadata.
 */

import { NextResponse } from 'next/server';
import { getOwner, listStaffMerged, listSkills } from '@holon/core';

export const dynamic = 'force-dynamic';

interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export async function GET(): Promise<NextResponse> {
  const skills: A2ASkill[] = [];

  // --- staff entries (LIVE CLI employees) ---
  try {
    const staff = listStaffMerged();
    for (const s of staff) {
      skills.push({
        id: s.id,
        name: s.name,
        description: `CLI employee · ${s.role_label ?? s.role_name}`,
        tags: ['employee'],
      });
    }
  } catch (err) {
    console.warn('[agent-card] listStaffMerged failed — skipping staff skills', err);
  }

  // --- owner skill catalog entries ---
  try {
    const ownerSkills = listSkills();
    for (const sk of ownerSkills) {
      skills.push({
        id: sk.id,
        name: sk.name,
        description: sk.description,
        tags: ['skill'],
      });
    }
  } catch (err) {
    console.warn('[agent-card] listSkills failed — skipping catalog skills', err);
  }

  // --- derive owner name defensively ---
  let deskName = 'Manage Your CLI desk';
  try {
    const owner = getOwner();
    if (owner.owner_name) deskName = owner.owner_name;
  } catch (err) {
    console.warn('[agent-card] getOwner failed — using default desk name', err);
  }

  const card = {
    protocolVersion: '0.2.0',
    name: deskName,
    description: 'A Manage-Your-CLI desk — a secretary plus dynamic CLI employees.',
    url: process.env.HOLON_A2A_URL ?? '/api/v1/a2a',
    version: '0.1.0',
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills,
  };

  return NextResponse.json(card);
}
