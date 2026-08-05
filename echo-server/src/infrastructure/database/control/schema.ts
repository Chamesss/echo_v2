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
  // Immutable URL/identifier (also the basis for the tenant schema name).
  slug: text("slug").notNull().unique(),
  // Mutable display name (defaults to the slug at creation; editable in settings).
  name: text("name").notNull(),
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
 * Pending workspace invitations (the tokenized email-link flow).
 *
 * An admin creates a row addressed to an `email` with a target `role`; the raw
 * token is emailed (as a link) and only its SHA-256 `tokenHash` is stored, so a
 * DB leak can't yield usable invite links. Single-use (`acceptedAt`) and
 * time-boxed (`expiresAt`). On accept we verify the signed-in user's email
 * matches `email`, then create the membership. `invitedBy` is `set null` on user
 * delete so the audit trail survives.
 */
export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invite_tokens_workspace_idx").on(t.workspaceId),
    index("invite_tokens_email_idx").on(t.email),
  ],
);

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

/**
 * User notification inbox (the awareness layer's persistent store).
 *
 * Control-plane (not tenant-scoped) so the cross-workspace inbox is a single
 * query on `user_id`. `channel_id`/`message_id` reference rows in the workspace's
 * tenant schema — there is no cross-schema FK, so they're bare ids resolved per
 * workspace when rendering. `actor_id` joins control `users` for a live name.
 *
 * `type` is `'dm'` today (`'mention'` reserved). Two read states:
 *   - `seenAt` — the user opened the notification tray (clears the global dot)
 *   - `readAt` — the user opened this specific item / its conversation
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // 'message' (channel) | 'dm' | (future) 'mention'.
    type: text("type").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    // Channel name snapshot for display ("in #general"); null for DMs.
    channelName: text("channel_name"),
    messageId: uuid("message_id").notNull(),
    // Reserved for the future tag/important system; unused for now.
    important: boolean("important").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    // Access revocation deletes by channel (`deleteChannelNotifications`), which
    // is otherwise a full scan of a table shared by every workspace.
    index("notifications_channel_idx").on(t.channelId),
  ],
);

/**
 * Per-user, per-workspace notification preference. A missing row means enabled
 * (the default); a row with `enabled = false` silences the bell + toast for that
 * workspace (unread counts still work). Keyed (user, workspace).
 */
export const notificationSettings = pgTable(
  "notification_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

/**
 * Per-user UI preferences (appearance mode, sidebar theme, density…).
 *
 * User-global, NOT per-workspace — the choice follows the person across every
 * workspace and device, which is why this lives in the control plane keyed by
 * `userId` alone. A missing row means "all defaults", the same convention as
 * `notificationSettings` above; the client never has to seed anything.
 *
 * The payload is a single `jsonb` blob rather than a column per preference so
 * adding a preference is a schema change in `preferences.dto.ts` and nothing
 * else — no migration, no deploy ordering to think about. The shape is owned
 * and versioned by that zod schema; see `preferences.service.ts` for the
 * lenient-read / partial-merge-write rules that keep mixed client versions
 * from clobbering each other during a rolling deploy.
 */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
export type InviteToken = typeof inviteTokens.$inferSelect;
export type NewInviteToken = typeof inviteTokens.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationSetting = typeof notificationSettings.$inferSelect;
export type NewNotificationSetting = typeof notificationSettings.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
