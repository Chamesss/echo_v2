/**
 * Control-plane Drizzle table definitions.
 *
 * Three groups live here:
 *
 *  1. Better Auth core tables (`users`, `sessions`, `accounts`, `verifications`).
 *     Owned by Better Auth — field names and types match what the library
 *     expects so its Drizzle adapter (configured in `infrastructure/auth/auth.ts`)
 *     can read/write them. Don't change these casually; mismatches cause silent
 *     auth failures.
 *
 *  2. Better Auth plugin tables (`twoFactors`). Required by the `twoFactor`
 *     plugin enabled in `auth.ts`. The mapping is registered with the adapter
 *     under the key the plugin uses internally (`twoFactor`).
 *
 *  3. Application tables (`workspaces`, `memberships`, `tenantCatalog`,
 *     `authEvents`). Owned by us. `ownerId` and `userId` are `text` because
 *     they FK to Better Auth's `users.id`, which is a generated string.
 *
 * Changes here are managed by drizzle-kit:
 *   `npm run db:generate`  — produces a SQL migration in ./drizzle/control
 *   `npm run db:migrate`   — applies pending migrations
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// ─── Better Auth core tables ──────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  image: text("image"),
  // Added by the `twoFactor` plugin; flips to true once a user verifies
  // their TOTP setup. Sign-in checks this to decide whether to issue the
  // session immediately or require a 2FA challenge.
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  // ─ Added by the `admin` plugin (see auth.ts) ─
  // GLOBAL application role ("admin" | "user") — distinct from the
  // workspace-scoped `roleEnum` used on `memberships` below. Gates the /admin
  // dashboard. Property keys here must match Better Auth's field names
  // (role/banned/banReason/banExpires) so its Drizzle adapter maps them.
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // Added by the `admin` plugin: when an admin impersonates a user, the
  // impersonation session records the admin's id here so it can be audited
  // and "stop impersonating" can restore the original session.
  impersonatedBy: text("impersonated_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  // Hashed password for the email/password provider; null for OAuth accounts.
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Better Auth plugin tables ────────────────────────────────────────

/**
 * Backing table for the `twoFactor` plugin.
 *
 * Stores the per-user TOTP secret + backup codes. `verified` flips to true
 * once the user proves they've successfully set up their authenticator app.
 * Mapped to the plugin via `schema.twoFactor` in the drizzle adapter config.
 */
export const twoFactors = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
  },
  (t) => [index("two_factors_user_id_idx").on(t.userId)],
);

// ─── Application tables ───────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["admin", "member"]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

export const tenantCatalog = pgTable("tenant_catalog", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  schemaName: text("schema_name").notNull().unique(),
  schemaVersion: integer("schema_version").notNull().default(0),
});

/**
 * Audit log for security-relevant events.
 *
 * Written by `infrastructure/audit/audit-log.ts#logAuthEvent`, which is wired
 * into Better Auth's `databaseHooks` (sign-in, user creation) and any
 * application code that wants to record sensitive actions (workspace
 * provisioning, role changes, etc.).
 *
 * `userId` is nullable because some events (failed sign-in with unknown
 * email) have no associated user. `onDelete: 'set null'` keeps the event row
 * around for forensic queries even after the user is deleted.
 */
export const authEvents = pgTable(
  "auth_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    event: text("event").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("auth_events_user_id_idx").on(t.userId),
    index("auth_events_created_at_idx").on(t.createdAt),
    index("auth_events_event_idx").on(t.event),
  ],
);

// ─── Inferred types ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type TenantCatalogEntry = typeof tenantCatalog.$inferSelect;
export type NewTenantCatalogEntry = typeof tenantCatalog.$inferInsert;
export type AuthEvent = typeof authEvents.$inferSelect;
export type NewAuthEvent = typeof authEvents.$inferInsert;
