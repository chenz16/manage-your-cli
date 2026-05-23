/**
 * Shared primitive Zod schemas. Used by every entity.
 *
 * Per data-model.md § 2.2: IDs are {prefix}_{base32-uuidv7-26-chars}.
 * Per data-model.md § 2.3: timestamps are ISO-8601 in UTC with milliseconds.
 */

import { z } from 'zod';

/**
 * Base32 (Crockford) char set used by UUIDv7 prefixed IDs. The 26-char
 * suffix is upper-case ASCII letters and digits with `I L O U` excluded.
 *
 * UI mock fixtures use placeholder strings that follow the same shape but
 * are not real UUIDv7 values. The regex tolerates lowercase too so the
 * mock data validates.
 */
const ID_SUFFIX_RE = /^[0-9A-Za-z]{20,30}$/;

/**
 * Build a Zod schema for an ID with the given prefix.
 *
 *   idOf('mission') matches  'mission_01HKQ8MISN1VBN3XK7WTCQMPRD'
 *
 * Prefix must be lower-snake-case.
 */
export function idOf(prefix: string): z.ZodString {
  const re = new RegExp(`^${prefix}_${ID_SUFFIX_RE.source.slice(1, -1)}$`);
  return z.string().regex(re, `expected ${prefix}_<base32-26> id`);
}

/** ISO-8601 datetime with milliseconds (UTC). */
export const zIsoDateTime = z.string().datetime({ offset: true, precision: 3 });

/**
 * Loose ISO datetime — accepts any RFC-3339 datetime including the no-ms
 * form ("...Z" without ".000Z"). Used where fixtures use both shapes.
 */
export const zIsoDateTimeLoose = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  'must be a parseable ISO-8601 datetime'
);

/** Inclusive 0..100 integer (used for mission.priority, cultivation_maturity 0..5, etc.). */
export const zPriorityInt = z.number().int().min(0).max(100);
export const zCultivationMaturity = z.number().int().min(0).max(5);

/**
 * Millicents: 1/100,000 of a dollar. Used by budget caps so we can express
 * sub-cent amounts without floats. e.g., $0.015 = 1500 millicents.
 */
export const zMillicents = z.number().int().nonnegative();
