/**
 * /projects — desk surface for the new multi-secretary-project model.
 *
 * Mirrors the mobile inline-create dialog + ⋯ menu (rename / delete) but
 * styled as a desk page with a list + new-project form. Mobile-side is
 * authoritative for the layout vocabulary; here it's adapted to keyboard +
 * mouse ergonomics (no swipes, no long-press).
 */

import { ProjectsClient } from './_components/ProjectsClient';

export default function ProjectsPage() {
  return <ProjectsClient />;
}
