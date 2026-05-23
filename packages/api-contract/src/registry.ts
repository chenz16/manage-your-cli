/**
 * Shared OpenAPI registry. Every endpoint file imports this and calls
 * `registry.registerPath(...)` to declare itself. The `generate-openapi.ts`
 * script walks the registry and emits `apis/holon-bff/openapi.yaml`.
 *
 * Importing this module also registers Zod with the OpenAPI extension —
 * once per process, lazily on first import.
 */

import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with .openapi() once. Idempotent.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();
