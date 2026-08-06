import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '../pool.js';
import * as schema from './schema.js';

/**
 * The Drizzle client bound to control-plane tables.
 *
 * Used by services that need cross-tenant or identity data: workspace
 * provisioning, membership lookups, the tenant-schema cache in
 * `tenant/client.ts`. Any query against `users` / `workspaces` /
 * `memberships` / `tenant_catalog` goes through this client.
 */
export const controlDb = drizzle(pool, { schema });
