import * as z from "zod/v4";
import { count, desc, eq, gte, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { controlDb, schema } from "../db.js";

const { workspaces, memberships, tenantCatalog } = schema;

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "workspace_stats",
    {
      description:
        "Workspace counts and a per-workspace breakdown (slug, display name, " +
        "member count, whether its tenant schema is provisioned). NOTE: the " +
        "workspaces.created_at column was backfilled by a migration, so every " +
        "workspace created before that migration shares the same timestamp — " +
        "treat monthly figures as reliable only for recent workspaces.",
      inputSchema: z.object({
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .default(6)
          .describe("Length of the monthly series, in months."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Maximum workspaces in the breakdown, newest first."),
      }),
    },
    async ({ months, limit }) => {
      const monthLabel = sql<string>`to_char(date_trunc('month', ${workspaces.createdAt}), 'YYYY-MM')`;

      const [totalRows, thisMonthRows, series, breakdown] = await Promise.all([
        controlDb.select({ n: count() }).from(workspaces),
        controlDb
          .select({ n: count() })
          .from(workspaces)
          .where(gte(workspaces.createdAt, sql`date_trunc('month', now())`)),
        controlDb
          .select({ month: monthLabel, created: count() })
          .from(workspaces)
          .where(
            gte(
              workspaces.createdAt,
              sql`date_trunc('month', now()) - make_interval(months => (${months - 1})::int)`,
            ),
          )
          .groupBy(monthLabel)
          .orderBy(monthLabel),
        controlDb
          .select({
            slug: workspaces.slug,
            name: workspaces.name,
            createdAt: workspaces.createdAt,
            members: count(memberships.userId),
            schemaName: tenantCatalog.schemaName,
            schemaVersion: tenantCatalog.schemaVersion,
          })
          .from(workspaces)
          .leftJoin(memberships, eq(memberships.workspaceId, workspaces.id))
          .leftJoin(tenantCatalog, eq(tenantCatalog.workspaceId, workspaces.id))
          .groupBy(
            workspaces.id,
            workspaces.slug,
            workspaces.name,
            workspaces.createdAt,
            tenantCatalog.schemaName,
            tenantCatalog.schemaVersion,
          )
          .orderBy(desc(workspaces.createdAt))
          .limit(limit),
      ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                workspacesTotal: totalRows[0]?.n ?? 0,
                createdThisMonth: thisMonthRows[0]?.n ?? 0,
                series,
                workspaces: breakdown.map((w) => ({
                  slug: w.slug,
                  name: w.name,
                  createdAt: w.createdAt,
                  members: w.members,
                  provisioned: w.schemaName !== null,
                  schemaName: w.schemaName,
                  schemaVersion: w.schemaVersion,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
