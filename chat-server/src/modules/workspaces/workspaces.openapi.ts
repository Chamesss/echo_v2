import { z } from 'zod';
import { openApiRegistry } from '../../shared/openapi/registry.js';
import { createWorkspaceBody } from './workspaces.dto.js';

/**
 * OpenAPI registrations for the workspaces module.
 *
 * Imported as a side-effect by `shared/openapi/document.ts` so its
 * `registerPath` calls run at startup and end up in the generated document.
 *
 * Pattern: request schemas live in `*.dto.ts` (they're used for runtime
 * validation too); response schemas live here because they describe
 * documentation shape, not runtime validation. New routes go here as soon
 * as they're added to `*.routes.ts`.
 */

const provisionResultSchema = z
  .object({
    workspaceId: z.string().uuid(),
    schemaName: z.string(),
  })
  .openapi('ProvisionWorkspaceResult');

const workspaceDetailSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    role: z.enum(['admin', 'member']),
  })
  .openapi('WorkspaceDetail');

const workspaceListSchema = z.array(workspaceDetailSchema).openapi('WorkspaceList');

const errorBodySchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .openapi('ErrorBody');

const workspaceIdParam = z.object({
  workspaceId: z.string().uuid(),
});

openApiRegistry.register('CreateWorkspaceBody', createWorkspaceBody);

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/workspaces',
  tags: ['Workspaces'],
  summary: "List the caller's workspaces",
  description:
    'Returns every workspace the authenticated caller is a member of, with their role in each. The frontend uses this immediately after sign-in to pick a landing page.',
  security: [{ sessionCookie: [] }],
  responses: {
    200: {
      description: 'Workspace list (possibly empty)',
      content: { 'application/json': { schema: workspaceListSchema } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: errorBodySchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/workspaces',
  tags: ['Workspaces'],
  summary: 'Create a workspace',
  description:
    'Provisions a new workspace and its tenant schema in a single Postgres transaction. ' +
    'The authenticated caller becomes the workspace owner and is added as an admin member.',
  security: [{ sessionCookie: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: createWorkspaceBody } },
    },
  },
  responses: {
    201: {
      description: 'Workspace created and tenant schema provisioned',
      content: { 'application/json': { schema: provisionResultSchema } },
    },
    400: {
      description: 'Invalid request body',
      content: { 'application/json': { schema: errorBodySchema } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: errorBodySchema } },
    },
    409: {
      description: 'Slug already taken',
      content: { 'application/json': { schema: errorBodySchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}',
  tags: ['Workspaces'],
  summary: 'Get workspace',
  description: "Returns workspace metadata and the requester's role.",
  security: [{ sessionCookie: [] }],
  request: {
    params: workspaceIdParam,
  },
  responses: {
    200: {
      description: 'Workspace details',
      content: { 'application/json': { schema: workspaceDetailSchema } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: errorBodySchema } },
    },
    403: {
      description: 'Not a member of this workspace',
      content: { 'application/json': { schema: errorBodySchema } },
    },
  },
});
