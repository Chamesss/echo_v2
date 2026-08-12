# MCP — wiring an Echo metrics server

A step-by-step build of one small MCP server that answers three questions about this
deployment:

| Question                             | Lives in                                  | Read with             |
| ------------------------------------ | ----------------------------------------- | --------------------- |
| How many users / signups this month? | `public` — `users`, `memberships`         | Drizzle               |
| How many workspaces?                 | `public` — `workspaces`, `tenant_catalog` | Drizzle               |
| How many messages / active channels? | `tenant_<slug>`, one schema per workspace | raw parameterized SQL |

Everything here is read-only. Nothing in this guide changes application behaviour —
the one migration in Step 0 adds a column the app never writes explicitly.

---

## 1. The four roles

MCP has four parts. Only one of them is code you write.

```
┌─────────────────────────────────────────┐
│ Claude Code            ← the HOST       │
│  ┌───────────────────┐                  │
│  │ MCP client        │  one per server  │
│  └─────────┬─────────┘                  │
└────────────┼────────────────────────────┘
             │  JSON-RPC 2.0 over stdin/stdout
             ▼
┌─────────────────────────────────────────┐
│ bun echo-mcp/src/server.ts      │
│                        ← the SERVER      │
│   tools: signup_stats, workspace_stats,  │
│          workspace_activity              │
└────────────┬────────────────────────────┘
             │  pg.Pool
             ▼
      Postgres  ← the SOURCE
```

| Role       | What it is here                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Host**   | Claude Code. The LLM application. It owns the model, the conversation, and the decision to call a tool.                           |
| **Client** | A component _inside_ the host. One client instance per connected server; it speaks the protocol and knows nothing about Postgres. |
| **Server** | The Bun process you are about to write. It advertises tools and executes them.                                                    |
| **Source** | Postgres — this repo's control plane plus every `tenant_<slug>` schema.                                                           |

**`echo-server` is none of these.** It is not the host — it just happens to own the
database our server reads. The MCP server is a separate process that connects to the same
`DATABASE_URL`.

That separateness has a concrete consequence: a `pg.Pool` is a per-process object, so
the MCP server **cannot** share the running Express app's pool even if it imported it.
It opens its own. The only thing genuinely reused across the boundary is the Drizzle
_table definitions_ — plain declarations, no runtime state.

---

## 2. The protocol, concretely

MCP is JSON-RPC 2.0. Over stdio, each message is one line of JSON on stdin or stdout.
The client drives a fixed handshake, then calls tools on demand:

```
client → initialize                    "what version do you speak, what can you do?"
server → result (capabilities)
client → notifications/initialized     "handshake done"   (a notification: no id, no reply)
client → tools/list                    "what tools do you have?"
server → result (tool schemas)
client → tools/call                    "run signup_stats with {months: 6}"
server → result (content blocks)
```

A real exchange looks like this:

```jsonc
// →
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"signup_stats","arguments":{"months":3}}}

// ←
{"jsonrpc":"2.0","id":2,"result":{
  "content":[{"type":"text","text":"{\n  \"usersTotal\": 42,\n  \"signupsThisMonth\": 7\n}"}]
}}
```

MCP servers can expose three kinds of thing. This one uses **tools** only:

- **Tools** — model-invoked, take arguments, may do work. Our metrics take a time window
  and a workspace slug, so they are tools.
- **Resources** — application-selected, addressed by URI, read-only content the host
  attaches to context. Better suited to static reference material.
- **Prompts** — user-invoked templates. Not needed here.

> ### The stdout rule
>
> **stdout is the JSON-RPC channel.** One stray `console.log`, one dependency banner,
> and the client hits a parse error and drops the connection. Every log line in an
> stdio server goes to `console.error`. This is the single most common way a first MCP
> server fails, and the error message rarely points at the real cause.

---

## 3. Step 0 — give `workspaces` a `created_at`

"Workspaces this month" is unanswerable today: [`workspaces`](../echo-server/src/infrastructure/database/control/schema.ts#L141-L150)
has `id`, `slug`, `name`, `ownerId` and no timestamp. Add one.

**1.** In [control/schema.ts](../echo-server/src/infrastructure/database/control/schema.ts#L141-L150),
add a final field to `workspaces`:

```ts
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

**2.** Generate the migration:

```powershell
bun run --filter echo-server db:generate
```

**3.** Read the generated SQL in [echo-server/drizzle/control/](../echo-server/drizzle/control/)
(it will be `0009_*.sql`) before applying it. Expect:

```sql
ALTER TABLE "workspaces" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
```

⚠️ **The honest caveat:** `NOT NULL DEFAULT now()` backfills every existing row with the
_migration_ timestamp. Every workspace that already exists will look like it was created
the moment you ran this. The monthly workspace number is only meaningful for rows created
after the migration — say so when you report it, and note it in the tool's description so
the model repeats the caveat rather than inventing confidence.

**4.** Apply it:

```powershell
bun run --filter echo-server db:migrate
```

No application code changes. [provisioning/workspace.ts:102](../echo-server/src/infrastructure/provisioning/workspace.ts#L102)
inserts `{ slug, name, ownerId }` and lets the database fill the rest, so the column
default does the work.

---

## 4. Step 1 — scaffold the package

The root [package.json](../package.json#L5) already declares `"workspaces": ["echo-server", "echo-front", "packages/*"]`,
so a new directory under `echo-mcp/` is picked up with a root edit in package.json by adding the new mcp folder.

```
echo-mcp/
  package.json
  tsconfig.json
  src/
    env.ts            loads echo-server/.env by absolute path
    db.ts             own pool + drizzle client + read-only tenant helper
    server.ts         transport + tool registration
    tools/
      signups.ts
      workspaces.ts
      activity.ts
```

### `echo-mcp/package.json`

```json
{
  "name": "echo-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "mcp": "bun run src/server.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0",
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.45.2",
    "echo-server": "workspace:*",
    "pg": "^8.13.1",
    "zod": "^4.2.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.2"
  }
}
```

Notes on the dependency list:

- **`@modelcontextprotocol/server@2.0.0`** (MIT, published by Anthropic PBC) is the current
  stable line — v2, implementing the 2026-07-28 spec. You will find a lot of older material
  referencing `@modelcontextprotocol/sdk`; that is v1, still maintained for bug fixes but
  superseded. The v2 split is `@modelcontextprotocol/server` for servers,
  `@modelcontextprotocol/client` for clients.
- **`zod`** is a required peer of the SDK, which itself depends on `zod ^4.2.0` — compatible
  with this repo's `zod ^4.0.0`. Tool schemas use [Standard Schema](https://standardschema.dev/),
  so Valibot or ArkType would work too; Zod is here because the rest of the repo already uses it.
- **`@cfworker/json-schema`** appears as an _optional_ peer. Ignore any install hint about it.
- `pg` and `drizzle-orm` are pinned to the same versions [echo-server](../echo-server/package.json#L25-L41)
  uses, so Bun hoists one copy.

### `echo-mcp/tsconfig.json`

Mirrors [echo-server's](../echo-server/tsconfig.json):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src/**/*.ts"]
}
```

### Open one door in `echo-server`

The new package needs the control-plane table definitions. Add an `exports` map to
[echo-server/package.json](../echo-server/package.json) (top level, next to `"scripts"`):

```json
"exports": {
  "./db/control-schema": "./src/infrastructure/database/control/schema.ts"
},
```

**Why an exports map rather than a relative import.** You _could_ write
`import * as schema from "../../../echo-server/src/infrastructure/database/control/schema.js"`
and it would run — Bun resolves the path fine. The exports map is better because it
declares exactly one supported entry point instead of letting a sibling package reach into
arbitrary internals; move the schema file later and you fix one line, not every importer.
Nothing currently imports `echo-server` by package name, so adding `exports` breaks nothing.

**Why _this_ file and no other.** [control/schema.ts](../echo-server/src/infrastructure/database/control/schema.ts#L11-L22)
imports only `drizzle-orm/pg-core` — pure declarations, zero side effects. Contrast with
[pool.ts](../echo-server/src/infrastructure/database/pool.ts), which imports
[config/env.ts](../echo-server/src/config/env.ts#L1); that module validates the _whole_
server environment at import time and throws without `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
and friends. An analytics sidecar has no business holding the auth secret, so it never
imports that module.

Install from the repo root:

```powershell
bun install
```

---

## 5. Step 2 — environment and database

### `src/env.ts`

A stdio server is **spawned by the host**, and its working directory is whatever the host
chose. `import "dotenv/config"` reads `.env` relative to `process.cwd()`, so it is a coin
flip. Resolve from the module's own location instead:

```ts
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// echo-mcp/src/env.ts → ../../../echo-server/.env
const envPath = fileURLToPath(
  new URL("../../../echo-server/.env", import.meta.url),
);
config({ path: envPath });

export const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set (looked in ${envPath})`);
}
```

The alternative is an `env` block in `.mcp.json`. Reading the existing `.env` is preferred
here because `.mcp.json` is committed and `echo-server/.env` is git-ignored — the connection
string never moves into version control.

### `src/db.ts`

```ts
import pg from "pg";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "echo-server/db/control-schema";
import { DATABASE_URL } from "./env.js";

/**
 * This server's own pool. Deliberately narrower than the app's: it is an
 * analytics sidecar, and it must never be able to starve the app of connections
 * or hold a lock long enough to matter.
 */
export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  // A hard ceiling on any single statement. An LLM will happily ask a question
  // whose query plan is terrible; this is what stops it hanging the client.
  options: "-c search_path=public -c statement_timeout=10000",
});

pool.on("error", (err) => {
  console.error("[echo-mcp] idle client error:", err.message);
});

export const controlDb = drizzle(pool, { schema });
export { schema };

// Identifiers cannot be bound as query parameters — only *values* can. Schema
// names therefore have to be interpolated, so validate their shape first. Same
// guard as infrastructure/database/tenant/client.ts.
const SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;

/**
 * Runs `fn` against one workspace's tenant schema inside a READ ONLY transaction.
 *
 * Three things are load-bearing here:
 *   - BEGIN READ ONLY makes "this tool cannot write" a guarantee enforced by
 *     Postgres, not a promise made by our code.
 *   - SET LOCAL scopes the search_path to this transaction, so the pinned path
 *     can't bleed into the next checkout of this connection.
 *   - We always ROLLBACK: there is nothing to commit, and it releases cleanly.
 */
export async function readTenant<T>(
  schemaName: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!SAFE_SCHEMA_NAME.test(schemaName)) {
    throw new Error(`Refusing to query unsafe schema name: ${schemaName}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL search_path TO "${schemaName}", public`);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
```

This mirrors [tenant/client.ts:63-81](../echo-server/src/infrastructure/database/tenant/client.ts#L63-L81),
with the app's `BEGIN` swapped for `BEGIN READ ONLY`. The app needs to write; this server
must not be able to.

---

## 6. Step 3 — the three tools

### The shape of a tool

```ts
server.registerTool(
  "signup_stats", // 1. the name the model calls
  {
    description: "…", // 2. how the model decides to call it
    inputSchema: z.object({ months: z.number() }), // 3. becomes the advertised JSON Schema
  },
  async ({ months }) => ({
    // 4. the handler
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  }),
);
```

The `inputSchema` is not just validation — the SDK converts it to JSON Schema and ships it
in the `tools/list` response, so it is the only thing the model sees about your arguments.
Describe the fields there, not in prose elsewhere.

Returning **JSON in a text block** is deliberate: the model gets structured numbers it can
quote directly, rather than sentences it has to parse back into figures.

### The definitions to commit to

These are judgment calls. Write them down so they can be argued with:

- **Messages exclude soft-deleted rows** (`deleted = true` — see [init.sql:61](../echo-server/src/infrastructure/database/tenant/init.sql#L61)).
- **An active channel** is one that is not `archived` _and_ has at least one non-deleted
  message inside the window.
- **"This month"** is the calendar month in the database's timezone: `date_trunc('month', now())`.

### `src/tools/signups.ts`

```ts
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
```

### `src/tools/workspaces.ts`

```ts
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
```

`count(memberships.userId)` counts non-null values, so a workspace with no members reports
`0` rather than `1` — the difference between counting joined rows and counting the joined
column.

### `src/tools/activity.ts`

This is the schema-per-tenant tool: resolve the workspace through the control plane, then
open one read-only transaction per tenant schema.

```ts
import * as z from "zod/v4";
import { eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/server";
import { controlDb, readTenant, schema } from "../db.js";

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
          const messages = await client.query(MESSAGE_SQL, [activeWithinDays]);
          const channels = await client.query(CHANNEL_SQL, [activeWithinDays]);
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
```

**The fan-out is the cost here.** One workspace means one transaction; twenty workspaces
mean twenty. That is why `limit` exists, why it is capped at 50, and why passing a `slug`
short-circuits to a single round trip. If this ever needs to scale, the fix is a single
query built from `UNION ALL` across schema names — but do that only once the simple version
proves too slow.

### Why there is no `run_sql` tool

The tempting shortcut is one tool that takes a SQL string and runs it. Don't.

A tool schema is a contract with a language model. `run_sql(query: string)` is an unbounded,
un-reviewable surface over the entire database: no way to reason about what it will read,
no way to bound its cost, and — absent a read-only transaction — no way to stop it being
talked into a `DELETE`. Three fixed queries with typed parameters can be read in a code
review, given indexes, timed, and cached. The constraint is the feature.

---

## 7. Step 4 — the entry point

### `src/server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { pool } from "./db.js";
import { registerSignupTools } from "./tools/signups.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { registerActivityTools } from "./tools/activity.js";

const server = new McpServer({ name: "echo-metrics", version: "0.1.0" });

// Register BEFORE connect: the client asks for tools/list right after the
// handshake, and anything registered later won't be in that first answer.
registerSignupTools(server);
registerWorkspaceTools(server);
registerActivityTools(server);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("[echo-mcp] ready on stdio"); // stderr — stdout is the protocol
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void pool.end().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[echo-mcp] fatal:", err);
  process.exit(1);
});
```

Note what is _not_ here: the tool handlers know nothing about stdio. Swapping to a
Streamable HTTP transport later changes the two lines inside `main()` and nothing else.

Run it directly to check it starts:

```powershell
bun run --filter echo-mcp mcp
```

It will print the ready line to stderr and then sit waiting for JSON-RPC on stdin. That is
correct — a stdio server with no client attached looks like a hang.

---

## 8. Step 5 — register and verify

### `.mcp.json` at the repo root

```json
{
  "mcpServers": {
    "echo-metrics": {
      "command": "bun",
      "args": ["run", "echo-mcp/src/server.ts"]
    }
  }
}
```

Project-scoped and committed — which is exactly why it holds no credentials. If a
`.mcp.json` already exists, merge into `mcpServers` rather than replacing the file.

### Verify in three escalating steps

**1. Raw protocol — no client at all.** This proves the wire format works and is the
fastest way to find a stdout pollution bug.

PowerShell:

```powershell
@(
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}',
  '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
) | bun run echo-mcp/src/server.ts
```

Bash:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| bun run echo-mcp/src/server.ts
```

Expect two JSON lines on stdout (`id:1` capabilities, `id:2` tool list naming all three
tools) plus the ready line on stderr. Add a fourth line to actually call one:

```
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"signup_stats","arguments":{"months":3}}}
```

**2. Inspector — interactive.**

```powershell
bunx @modelcontextprotocol/inspector bun run echo-mcp/src/server.ts
```

Opens a browser UI listing the tools with generated forms for their arguments. Best place
to iterate on schemas and descriptions.

**3. Claude Code.** Restart it so `.mcp.json` is picked up, then `/mcp` should show
`echo-metrics` connected. Ask a question in plain language — _"how many signups this month?"_,
_"which workspaces have active channels?"_ — and watch which tool it picks. If it picks the
wrong one, the fix is almost always the tool `description`, not the code.

If the database is empty every number will be zero, which makes it hard to tell "working"
from "broken". Seed first:

```powershell
docker compose up -d db
bun run --filter echo-server db:migrate
bun run --filter echo-server db:seed-showcase
```

**4. Prove the read-only guard.** Temporarily add `await client.query("CREATE TABLE zzz(i int)")`
inside a `readTenant` callback and call the tool. Postgres should reject it with
`cannot execute CREATE TABLE in a read-only transaction`. Remove it afterwards — that error
is the design working.

---

## 9. Troubleshooting

| Symptom                                                | Cause                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Client reports a JSON parse error / connection closed  | Something wrote to stdout. A `console.log`, a dependency banner, a stray `print`. Move all logging to `console.error`.                      |
| `DATABASE_URL is not set (looked in …)`                | The relative path in `env.ts` doesn't match where the file actually lives. The error prints the resolved path — compare it to the real one. |
| Server connects but `tools/list` is empty              | `registerTool` ran after `server.connect`, or a `register*Tools` call is missing from `server.ts`.                                          |
| `Refusing to query unsafe schema name: …`              | A `tenant_catalog.schema_name` row is outside the `tenant_*` shape. Inspect the row; do not loosen the regex.                               |
| Tool hangs ~10s then errors                            | `statement_timeout` fired. Usually a large fan-out — lower `limit` or pass a `slug`.                                                        |
| `cannot execute … in a read-only transaction`          | A tool tried to write. Working as designed.                                                                                                 |
| Install warns about `@cfworker/json-schema`            | Optional peer of the MCP SDK. Ignore.                                                                                                       |
| `bun run --filter '*' test` complains about `echo-mcp` | The package has no `test` script. Add a no-op or ignore the warning.                                                                        |

## Where to go next

- **Streamable HTTP transport.** Mount the same tools at `POST /mcp` inside the existing
  Express app so remote clients can reach them. The handlers don't change; what does change
  is that you now own session ids, authentication on `/mcp`, and CORS — none of which stdio
  needed. That is the real lesson of starting with stdio.
- **Resources.** Expose the tenant schema DDL or a metrics glossary as MCP resources, so the
  model can read reference material without a tool call.
- **A fourth tool.** `attachment_stats` over the tenant `attachments` table
  ([init.sql:83-94](../echo-server/src/infrastructure/database/tenant/init.sql#L83-L94)) —
  count and total `size_bytes` by `category`. Good practice: it is the same shape as
  `workspace_activity` with none of the new concepts.
