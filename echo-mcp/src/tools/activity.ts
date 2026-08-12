import * as z from "zod/v4";
import { eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { controlDb, readTenant, schema } from "../db.js";

type MessageCounts = {
  messages_total: string;
  messages_this_month: string;
  messages_in_window: string;
};

type ChannelCounts = {
  channels_total: string;
  channels_open: string;
  channels_active: string;
};

const { workspaces, tenantCatalog } = schema;

const MESSAGE_SQL = `
  SELECT
    count(*) FILTER (WHERE NOT deleted)                                        AS messages_total,
    count(*) FILTER (WHERE NOT deleted
                       AND created_at >= date_trunc('month', now()))           AS messages_this_month,
    count(*) FILTER (WHERE NOT deleted
                       AND created_at >= now() - make_interval(days => $1::int)) AS messages_in_window
  FROM messages
`;

const CHANNEL_SQL = `
  SELECT
    count(*)                                                   AS channels_total,
    count(*) FILTER (WHERE NOT c.archived)                     AS channels_open,
    count(*) FILTER (
      WHERE NOT c.archived AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.channel_id = c.id
          AND NOT m.deleted
          AND m.created_at >= now() - make_interval(days => $1::int)
      )
    )                                                          AS channels_active
  FROM channels c
`;

const n = (v: unknown) => Number(v ?? 0); // pg returns bigint counts as strings

export function registerActivityTools(server: McpServer): void {
  server.registerTool(
    "workspace_activity",
    {
      description:
        "Message and channel activity inside workspaces. Each workspace stores " +
        "its channels and messages in its own Postgres schema, so this reads one " +
        "schema per workspace. An 'active' channel is one that is not archived " +
        "and has at least one non-deleted message within the window. Pass a slug " +
        "for a single workspace; omit it to survey several.",
      inputSchema: z.object({
        slug: z
          .string()
          .optional()
          .describe("Workspace slug. Omit to survey up to `limit` workspaces."),
        activeWithinDays: z
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe(
            "Window used for 'in window' message counts and active channels.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Maximum workspaces to survey when no slug is given."),
      }),
    },
    async ({ slug, activeWithinDays, limit }) => {
      const targets = await controlDb
        .select({
          slug: workspaces.slug,
          name: workspaces.name,
          schemaName: tenantCatalog.schemaName,
        })
        .from(tenantCatalog)
        .innerJoin(workspaces, eq(workspaces.id, tenantCatalog.workspaceId))
        .where(slug ? eq(workspaces.slug, slug) : undefined)
        .orderBy(workspaces.slug)
        .limit(slug ? 1 : limit);

      if (targets.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: slug
                ? `No provisioned workspace with slug "${slug}".`
                : "No provisioned workspaces found.",
            },
          ],
          isError: true,
        };
      }

      const rows = [];
      for (const t of targets) {
        const stats = await readTenant(t.schemaName, async (client) => {
          const messages = await client.query<MessageCounts>(MESSAGE_SQL, [
            activeWithinDays,
          ]);
          const channels = await client.query<ChannelCounts>(CHANNEL_SQL, [
            activeWithinDays,
          ]);
          return { messages: messages.rows[0], channels: channels.rows[0] };
        });

        rows.push({
          slug: t.slug,
          name: t.name,
          messagesTotal: n(stats.messages?.messages_total),
          messagesThisMonth: n(stats.messages?.messages_this_month),
          messagesInWindow: n(stats.messages?.messages_in_window),
          channelsTotal: n(stats.channels?.channels_total),
          channelsOpen: n(stats.channels?.channels_open),
          channelsActive: n(stats.channels?.channels_active),
        });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { windowDays: activeWithinDays, workspaces: rows },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
