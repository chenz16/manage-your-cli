import { z } from 'zod';
import { zIsoDateTimeLoose } from '../primitives.js';
import { RecentEventKind } from '../enums.js';

/**
 * Recent-events feed — derived view shown on the Today screen.
 *
 * In iter-001 fixtures the feed is hand-constructed; in V1 BFF it will
 * be synthesized from missions + deliverables + connection state
 * transitions. `text` field is pre-rendered HTML (with `<strong>` and
 * `<em>` only) — V2+ may switch to structured fragments.
 */
export const RecentEvent = z.object({
  at: zIsoDateTimeLoose,
  kind: RecentEventKind,
  text: z.string().min(1),
});
export type RecentEvent = z.infer<typeof RecentEvent>;
