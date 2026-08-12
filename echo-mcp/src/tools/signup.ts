import * as z from "zod/v4";
import { and, count, gte, lt, sql } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { controlDb, schema } from "../db.js";

const { users, memberships } = schema;

const monthStart = sql`date_trunc('month', now())`;
const prevMonthStart = sql`date_trunc('month', now()) - interval '1 month'`;

async function scalar(query: Promise<{ n: number }[]>): Promise<number> {
  return (await query)[0]?.n ?? 0;
}

export function registerSignupTools(server: McpServer): void {
  server.registerTool(
    "signup_stats",
    {
      description:
        "User signup counts for the Echo control plane: lifetime total, this " +
        "calendar month, last calendar month, and a per-month series. Also " +
        "returns total workspace memberships. Use for questions about users, " +
        "signups, growth, or registrations.",
      inputSchema: z.object({
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .default(6)
          .describe(
            "Length of the monthly series, in months, ending this month.",
          ),
      }),
    },
    async ({ months }) => {
      const monthLabel = sql<string>`to_char(date_trunc('month', ${users.createdAt}), 'YYYY-MM')`;

      const [usersTotal, thisMonth, lastMonth, membershipsTotal, series] =
        await Promise.all([
          scalar(controlDb.select({ n: count() }).from(users)),
          scalar(
            controlDb
              .select({ n: count() })
              .from(users)
              .where(gte(users.createdAt, monthStart)),
          ),
          scalar(
            controlDb
              .select({ n: count() })
              .from(users)
              .where(
                and(
                  gte(users.createdAt, prevMonthStart),
                  lt(users.createdAt, monthStart),
                ),
              ),
          ),
          scalar(controlDb.select({ n: count() }).from(memberships)),
          controlDb
            .select({ month: monthLabel, signups: count() })
            .from(users)
            .where(
              gte(
                users.createdAt,
                sql`date_trunc('month', now()) - make_interval(months => (${months - 1})::int)`,
              ),
            )
            .groupBy(monthLabel)
            .orderBy(monthLabel),
        ]);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                usersTotal,
                signupsThisMonth: thisMonth,
                signupsLastMonth: lastMonth,
                membershipsTotal,
                series,
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
