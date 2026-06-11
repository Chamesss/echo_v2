import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * Extends zod with the `.openapi(...)` chain method.
 *
 * Called once at module init. After this import resolves, any zod schema can
 * call `.openapi({ description, example, ... })` to attach OpenAPI metadata.
 * Modules that register OpenAPI paths import this file so the extension is
 * always applied before they call `.openapi(...)`.
 */
extendZodWithOpenApi(z);

/**
 * Shared OpenAPI registry collecting paths + reusable schemas from every
 * feature module. Each module's `*.openapi.ts` file imports this and calls
 * `openApiRegistry.registerPath(...)` and/or `openApiRegistry.register(...)`.
 *
 * `document.ts` snapshots this registry into a complete OpenAPI 3.0 document
 * which Scalar then renders at /api/docs.
 */
export const openApiRegistry = new OpenAPIRegistry();
