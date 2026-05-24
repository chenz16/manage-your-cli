import { z } from 'zod';
import { registry } from '../registry.js';
import { Project } from '../entities/project.js';
import { idOf } from '../primitives.js';

/** GET /api/v1/projects — list all projects for the desk (excludes archived by default). */

export const ListProjectsQuery = z.object({
  include_archived: z.coerce.boolean().default(false),
});
export type ListProjectsQuery = z.infer<typeof ListProjectsQuery>;

export const ListProjectsResponse = z.object({
  items: z.array(Project),
});
export type ListProjectsResponse = z.infer<typeof ListProjectsResponse>;

registry.registerPath({
  method: 'get',
  path: '/api/v1/projects',
  summary: 'List projects for this desk.',
  tags: ['projects'],
  request: { query: ListProjectsQuery },
  responses: {
    200: {
      description: 'Project list',
      content: { 'application/json': { schema: ListProjectsResponse } },
    },
  },
});

/** POST /api/v1/projects — create a project (auto-slug from name). */

export const CreateProjectBody = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

export const CreateProjectResponse = z.object({
  project: Project,
});
export type CreateProjectResponse = z.infer<typeof CreateProjectResponse>;

registry.registerPath({
  method: 'post',
  path: '/api/v1/projects',
  summary: 'Create a project (auto-slug from name).',
  tags: ['projects'],
  request: {
    body: { content: { 'application/json': { schema: CreateProjectBody } } },
  },
  responses: {
    201: {
      description: 'Created project',
      content: { 'application/json': { schema: CreateProjectResponse } },
    },
    400: { description: 'Invalid input or slug conflict' },
  },
});

/** PATCH /api/v1/projects/:id — rename or archive a project. */

export const UpdateProjectParams = z.object({ id: idOf('proj') });
export type UpdateProjectParams = z.infer<typeof UpdateProjectParams>;

export const UpdateProjectBody = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  archived: z.boolean().optional(),
});
export type UpdateProjectBody = z.infer<typeof UpdateProjectBody>;

export const UpdateProjectResponse = z.object({
  project: Project,
});
export type UpdateProjectResponse = z.infer<typeof UpdateProjectResponse>;

registry.registerPath({
  method: 'patch',
  path: '/api/v1/projects/{id}',
  summary: 'Rename or archive a project.',
  tags: ['projects'],
  request: {
    params: UpdateProjectParams,
    body: { content: { 'application/json': { schema: UpdateProjectBody } } },
  },
  responses: {
    200: {
      description: 'Updated project',
      content: { 'application/json': { schema: UpdateProjectResponse } },
    },
    404: { description: 'Unknown project id' },
  },
});

/** DELETE /api/v1/projects/:id — delete a project. */

registry.registerPath({
  method: 'delete',
  path: '/api/v1/projects/{id}',
  summary: 'Delete a project.',
  tags: ['projects'],
  request: { params: UpdateProjectParams },
  responses: {
    200: {
      description: 'Deleted',
      content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
    },
    404: { description: 'Unknown project id' },
  },
});
