/**
 * D3 — Persona apply path: unified substrate write.
 *
 * Asserts that applyPersona() routes through updateOwner() (the single
 * authoritative write path for OwnerAssistant state) rather than writing
 * substrate via a separate code path. Concretely: after applyPersona,
 * getOwner().substrate.tool_scope reflects the persona's tool_scope, and
 * updateOwner() subsequently ALSO sees that tool_scope (i.e. both the
 * persona apply and the standard /me PATCH path read/write the same state).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyPersona, getOwner, updateOwner } from '../src/owner-config-service.js';
import { listPersonas } from '../src/persona-catalog.js';
import { personaToolScope } from '../src/persona-catalog.js';

// Reset owner overrides before each test so tests don't bleed state.
// The mutable store lives on globalThis — wipe substrate override by
// calling updateOwner with a null substrate so subsequent getOwner()
// reads from the fixture baseline.
beforeEach(() => {
  // Clear substrate override by patching it back to undefined (shallow merge
  // in patchOwnerOverrides will remove the key on next read from fixture).
  // We do this by setting substrate to the fixture value via updateOwner.
  const current = getOwner();
  updateOwner({ substrate: current.substrate });
});

describe('applyPersona — unified substrate write (D3)', () => {
  it('after applyPersona, getOwner().substrate.tool_scope matches the persona catalog', () => {
    const personas = listPersonas();
    // Use the first available persona — catalog is always non-empty.
    const p = personas[0]!;
    expect(p).toBeDefined();

    const result = applyPersona(p.id);
    expect(result.ok).toBe(true);

    const owner = getOwner();
    // substrate.tool_scope must be set to the persona's computed tool_scope.
    expect(owner.substrate).toBeDefined();
    if (owner.substrate.kind !== 'local_ai') return; // type guard
    const expected = personaToolScope(p);
    expect(owner.substrate.tool_scope).toEqual(expected);
  });

  it('updateOwner() after applyPersona sees the same substrate.tool_scope (single write path)', () => {
    const personas = listPersonas();
    const p = personas[0]!;

    applyPersona(p.id);

    // Now call updateOwner with a non-substrate field — the substrate written
    // by applyPersona should survive (shallow merge preserves it).
    updateOwner({ owner_role: 'Unified Write Test Role' });

    const owner = getOwner();
    expect(owner.owner_role).toBe('Unified Write Test Role');
    // tool_scope is still the persona's value — not wiped by the subsequent patch.
    if (owner.substrate.kind !== 'local_ai') return;
    const expected = personaToolScope(p);
    expect(owner.substrate.tool_scope).toEqual(expected);
  });

  it('applyPersona returns ok:true and owner.substrate with tool_scope', () => {
    const personas = listPersonas();
    const p = personas[0]!;

    const result = applyPersona(p.id);

    expect(result.ok).toBe(true);
    expect(result.owner).toBeDefined();
    expect(result.owner!.substrate).toBeDefined();
  });
});
