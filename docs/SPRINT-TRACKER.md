# Sprint Tracker — Internal Chat MVP

> **Owner: Claude.** This is my working tracker. I update statuses, the "Last updated"
> date, and the changelog every time work lands. The roadmap rationale lives in
> `ROADMAP.md`; the gap analysis in `MVP-SCOPE.md`. This file is the checklist of record.

**Last updated:** 2026-06-14 · **Active sprint:** Sprint 7 — Attachments ✅ (MVP feature scope complete) · **Scope:** full (channels + DMs + attachments) · **Runner:** Vitest

> **Mid-roadmap inserts:** Sprint 6.5 (multi-workspace dashboard + member-departure handling), Sprint 6.6 (notifications & awareness layer; **revised 6.6b/6.6c** — all-message notifications, per-workspace settings, global toast + Slack-style workspace rail, double-fire/popup fixes), and Sprint 6.7 (read-state & "seen" receipts) were added after Sprint 6 in response to real gaps; all sit before Attachments.

### Status legend
| Mark | Meaning |
|---|---|
| ✅ | Done & validated (tests green where applicable) |
| 🟡 | In progress / partial |
| ❌ | Not started |
| ⏸ | Blocked (see notes) |
| 🔁 | Carried over to a later sprint |
| ➖ | N/A |

### How I keep this honest
- A task is ✅ only when its code **and** its test exist and pass; otherwise 🟡.
- A sprint's **gate** flips to ✅ only when *all* its tasks are ✅ and CI is green.
- On every change I bump "Last updated", set "Active sprint", and append a Changelog row.

---

## Baseline — already built before the roadmap (not re-tracked as sprint work)

| Area | What exists | Status |
|---|---|---|
| Auth / identity | email+password, Google+GitHub OAuth, manual-only account linking, 2FA (TOTP), sessions list/revoke, password reset, email verification, change email, delete account, admin plugin (ban/role/impersonate), HIBP, Turnstile, auth-endpoint rate limiting, auth audit log | ✅ |
| Multi-tenant isolation | schema-per-tenant, `withTenantSchema` search_path discipline, `tenant_catalog`, versioned tenant migrations, `TENANT_SCHEMA_VERSION=2` | ✅ |
| Realtime core | authed WS handshake (origin+session+membership), hub, Postgres NOTIFY backplane (multi-instance), gap-detect + catch-up reconciliation, heartbeat, graceful shutdown drains wss + backplane | ✅ |
| Messaging **engine** | gapless seq, idempotent send, edit/delete/versioning, read cursor, catch-up — *now codified by the Sprint 0 integration suite (5 tests, real Postgres)* | ✅ |
| Channels (partial) | list / create / join / get + messages send/list/edit/delete/read | 🟡 |
| Workspaces (partial) | create / list-mine / get | 🟡 |
| Frontend | routing refactor, PageContainer, responsive AppShell, channel list/view/composer, realtime context + reconciliation, optimistic send | ✅ |
| Dev scripts | `db:make-admin`, `db:add-member` (interim stand-in for invites), `db:migrate-tenants` | ✅ |

---

## Sprint overview

| # | Sprint | Status | Gate (suite green + CI) |
|---|---|---|---|
| 0 | Test & CI foundation | ✅ | ✅ |
| 1 | Authorization model | ✅ | ✅ |
| 2 | Membership & invitations | ✅ | ✅ |
| 3 | Workspace mgmt + member directory | ✅ | ✅ |
| 4 | Channel management | ✅ | ✅ |
| 5 | Messaging UX completeness | ✅ | ✅ |
| 6 | Direct messages | ✅ | ✅ |
| 6.5 | Multi-workspace dashboard & member departure | ✅ | ✅ |
| 6.6 | Notifications & awareness layer | ✅ | ✅ |
| 6.7 | Read-state & "seen" receipts | ✅ | ✅ |
| 7 | Attachments | ❌ | ❌ |
| 8 | Security & realtime hardening | ❌ | ❌ |
| 9 | Final validation & release readiness | ❌ | ❌ |

---

## Sprint 0 — Test & CI foundation

| Task | Area | Status | Notes |
|---|---|---|---|
| Vitest config (server) | test | ✅ | `vitest.config.ts` + `.js`→`.ts` resolver plugin; env injected via `test.env` |
| Vitest config (frontend) | test | ✅ | `test` block added to `vite.config.ts` (jsdom); inherits `@` alias |
| Disposable test-Postgres harness + reset helpers | test | ✅ | `test/db-url.ts` + `test/global-setup.ts` — derives `*_test` DB, migrates, clean slate |
| Test factories (user/workspace/membership/channel) | test | ✅ | `test/factories.ts` (+ `destroyWorkspace` cleanup) |
| Engine test: gapless seqs under concurrency | test | ✅ | 25 concurrent sends → exactly 1..25 |
| Engine test: idempotent send (no burned seq) | test | ✅ | retry returns same row, clock unchanged |
| Engine test: catch-up `?since` | test | ✅ | creates/edits/deletes in clock order |
| Engine test: edit version-bump + revision | test | ✅ | version→2, revision row captured |
| Engine test: soft-delete + clock bump | test | ✅ | hidden from history, tombstone in catch-up |
| GitHub Actions CI (typecheck + vitest + PG service) | ops | ✅ | `.github/workflows/ci.yml` — dormant until repo is git-init'd + pushed |
| `Dockerfile` (server) | ops | ✅ | `chat-server/Dockerfile` (multi-stage, pnpm deploy) + `.dockerignore` excludes `.env` |
| `docker-compose.yml` (Postgres + server) | ops | ✅ | root `docker-compose.yml` |
| Fix duplicate `db:migrate-tenants` in package.json | fix | ✅ | removed; added `test`/`test:watch`/`typecheck` scripts |
| **Bonus:** fixed broken `start` script (`dist/server.js` → `dist/src/server.js`) | fix | ✅ | prod entrypoint was wrong; would have failed `pnpm start`/Docker |
| **Bonus:** root `test` + `typecheck` scripts (`pnpm -r --if-present …`) | ops | ✅ | one command fans out to both packages |
| **GATE: engine suite green + CI green** | gate | ✅ | local: server 5/5, front 3/3, both typecheck clean. CI activates on first push. |

## Sprint 1 — Authorization model

| Task | Area | Status | Notes |
|---|---|---|---|
| Permission matrix (admin vs member) | backend | ✅ | **Decision: any member creates channels.** Admin-only = destructive/governance. Documented in `require-workspace-role.ts` |
| `requireWorkspaceRole('admin')` middleware | backend | ✅ | `shared/middleware/require-workspace-role.ts` (variadic roles, fails closed). `requireWorkspaceMember` folded in — `loadWorkspace` already enforces membership |
| Enforce authz on channel-create | backend | ✅ | Per decision, members may create → no gate. Guard is ready and gets *applied* to admin routes starting Sprint 2 |
| Audit writes for admin actions | backend | ✅ | Extended `auth_events` (reused per its own design): `WorkspaceEventName` + `logWorkspaceEvent`; applied to `channel.created` |
| Test: role guard 403 member / pass admin | test | ✅ | `authorization.test.ts` |
| Test: cross-tenant denial | test | ✅ | real-DB `loadWorkspace`: non-member across tenants → 403 `not_a_member` |
| Test: audit rows written | test | ✅ | controller writes `channel.created` row scoped to workspace |
| **GATE: authz suite green** | gate | ✅ | 12/12 backend tests, typecheck clean |

## Sprint 2 — Membership & invitations

| Task | Area | Status | Notes |
|---|---|---|---|
| `invite_tokens` table (control) | backend | ✅ | migration `0003`; SHA-256 token hash stored, raw token emailed only |
| POST invite (email token via nodemailer) | backend | ✅ | `invites.service` + `members.controller`; `workspaceInviteTemplate`; supersedes prior unaccepted invite |
| Accept-invite endpoint | backend | ✅ | `/api/invites/:token(/accept)` — authed but OUTSIDE `loadWorkspace`; email-match + single-use under row lock |
| Admin add-by-email endpoint | backend | ✅ | `POST /members`; replaces `db:add-member` script |
| List members endpoint | backend | ✅ | `GET /members` (name/email/image/role/isOwner) — member directory groundwork for S3/S5 |
| Remove member endpoint | backend | ✅ | `DELETE /members/:userId` (admin) |
| Change role endpoint | backend | ✅ | `PATCH /members/:userId` (admin) |
| Leave workspace endpoint | backend | ✅ | `POST /:workspaceId/leave` (any member; owner blocked) |
| Cleanup tenant `channel_members` on leave/remove | backend | ✅ | `removeFromAllChannels` via `withTenantSchema` |
| Owner protection (can't demote/remove/leave) | backend | ✅ | guards in `members.service` |
| Frontend: members page | frontend | ✅ | `routes/workspace/members.tsx` + `MembersTable` (roster, admin role/remove, owner/self-guarded); sidebar "Members" link |
| Frontend: invite UI | frontend | ✅ | `InvitePanel` (invite-by-email + role + pending list); admin-only section |
| Frontend: `/accept-invite/:token` route | frontend | ✅ | `routes/accept-invite.tsx` (focused layout; pending/expired/used/mismatch states) |
| Frontend: leave-workspace action | frontend | ✅ | `LeaveWorkspaceSection` (non-owners only) |
| Test: invite→accept lifecycle | test | ✅ | `membership.test.ts` |
| Test: expired/used token rejected | test | ✅ | expired + already-accepted + email-mismatch |
| Test: only admin invites | test | ✅ | `requireWorkspaceRole('admin')` blocks member (guard wired on all mutating routes) |
| Test: leave/remove cleanup + isolation | test | ✅ | channel_members stripped in-workspace only; wsB untouched |
| **GATE: membership suite green** | gate | ✅ | backend 22/22, front 3/3, both typecheck clean. Sprint 2 complete (backend + frontend). |

## Sprint 3 — Workspace management + member directory

| Task | Area | Status | Notes |
|---|---|---|---|
| Add mutable `workspaces.name` (slug stays immutable) | backend | ✅ | migration `0004` (add-nullable → backfill from slug → NOT NULL); `name`+`isOwner` now on workspace DTO + `req.workspace` |
| PATCH workspace rename | backend | ✅ | admin-only (`requireWorkspaceRole`); audited `workspace.renamed` |
| DELETE workspace (drop schema + cascade) | backend | ✅ | **owner-only**; one tx drops `tenant_<slug>` + cascades memberships/catalog/invites; clears schema + directory caches; audited |
| Member-profile directory resolution + cache | backend | ✅ | `directory.service` (in-process TTL cache, `getDirectory`/`invalidateDirectory`) + `GET /:id/directory`; invalidated on add/remove/leave/accept — feeds Sprint 5 author names |
| Frontend: workspace settings page | frontend | ✅ | `workspace-settings.tsx` (rename form admin / read-only for members; owner-only delete with type-the-slug confirm); admin-only "Workspace" sidebar link; shell shows `name` |
| Test: rename | test | ✅ | `workspace.test.ts` |
| Test: delete drops schema (no orphan) | test | ✅ | schema gone + all control rows cascaded |
| Test: directory + caching/invalidation + owner guard | test | ✅ | cache serves stale until invalidated; non-owner admin blocked from delete |
| **GATE: workspace suite green** | gate | ✅ | server 26/26, front 3/3, both typecheck clean |

## Sprint 4 — Channel management

| Task | Area | Status | Notes |
|---|---|---|---|
| Tenant schema v3 (topic/archived/created_by) | backend | ✅ | migration `0003`, `TENANT_SCHEMA_VERSION=3`, dev tenants migrated |
| PATCH channel rename/topic/archive | backend | ✅ | single `PATCH /:channelId` (≥1 field); audited rename/archive |
| Delete channel | backend | ✅ | `DELETE /:channelId` (cascades messages/members/revisions/attachments) |
| Leave channel | backend | ✅ | `POST /:channelId/leave` |
| Private member add/remove/list | backend | ✅ | `GET/POST /:channelId/members`, `DELETE /:channelId/members/:userId` |
| Authz: manage by admin OR creator | backend | ✅ | `created_by` + `assertCanManageChannel`; add-member allowed to any channel member |
| Frontend: channel settings | frontend | ✅ | `ChannelSettingsDialog` (rename/topic/archive/delete) via gear in channel header; admin/creator-gated |
| Frontend: private member mgmt UI | frontend | ✅ | member list + add (from workspace roster) + remove, in the settings dialog |
| Frontend: leave channel | frontend | ✅ | leave action in the dialog (any member) |
| Test: private non-member 403 (REST + WS subscribe) | test | ✅ | `channels-mgmt.test.ts` (`getChannel` + `assertChannelAccess`) |
| Test: add/remove member (+ outsider rejected, authz) | test | ✅ | |
| Test: archive hides + blocks join; leave updates membership | test | ✅ | |
| Test: manage authz (creator/admin allowed, member blocked) + delete | test | ✅ | |
| **GATE: channel-mgmt suite green** | gate | ✅ | server 32/32, front 3/3, both typecheck clean. Sprint 4 complete (backend + frontend). |

## Sprint 5 — Messaging UX completeness

| Task | Area | Status | Notes |
|---|---|---|---|
| Wire author names/avatars (from S3 directory) | frontend | ✅ | `useDirectory` hook → `MessageRow` shows name + avatar (fallback id-slice / "You" for ex-members) |
| Edit message UI (engine ready) | frontend | ✅ | inline edit in `MessageRow` (own msgs); `useEditMessage` |
| Delete message UI (engine ready) | frontend | ✅ | hover delete + confirm; `useDeleteMessage` |
| Infinite-scroll history (keyset endpoint exists) | frontend | ✅ | `useOlderMessages` (`?before=`) + `mergeBatch`; scroll-to-top auto-load + "Load earlier" button, scroll-anchored |
| RTL setup (jest-dom + user-event + cleanup) | test | ✅ | `src/test-setup.ts` wired via `setupFiles` |
| Component test: edited/deleted row states | test | ✅ | `MessageRow.test.tsx` |
| Test: inline edit flow + delete-on-confirm + others'-msg has no controls | test | ✅ | RTL + user-event |
| Test: optimistic send reconcile (no dup) | test | ✅ | `message-cache.test.ts` (clientId reconcile) |
| Test: keyset paging (prepend + dedupe) | test | ✅ | `mergeBatch` unit tests |
| **GATE: messaging-UX suite green** | gate | ✅ | server 32/32, front 17/17, both typecheck clean |

## Sprint 6 — Direct messages

| Task | Area | Status | Notes |
|---|---|---|---|
| Open-or-create DM by `dm_key` (idempotent) | backend | ✅ | `dm.service` — canonical sorted-id key + `ON CONFLICT (dm_key)`; reuses channel engine for messages |
| Group DM addressing | backend | ✅ | 2 → `direct`, 3+ → `group`; same key for any opener of the same set |
| Participants-only authz | backend | ✅ | non-public channels require membership (REST `getChannel` + WS subscribe); DMs hidden from channel list |
| DM list + new-DM picker (frontend) | frontend | ✅ | `DmList` sidebar section + `NewDmDialog` (multi-select roster); `useDirectMessages`/`useOpenDm`; ChannelView resolves DMs + Users icon |
| Test: open-or-create idempotent (same dm_key) | test | ✅ | `dm.test.ts` — same channel from either side + group |
| Test: non-participant denied | test | ✅ | REST + WS subscribe |
| Test: messaging/catch-up on a DM + outsider can't post | test | ✅ | engine reused on a DM channel |
| **GATE: DM suite green** | gate | ✅ | server 38/38, front 17/17, both typecheck clean |

## Sprint 6.5 — Multi-workspace dashboard & member departure

| Task | Area | Status | Notes |
|---|---|---|---|
| Dashboard home at `/` (was an auto-redirect) | frontend | ✅ | `WorkspaceDashboard` — cards per workspace (open/manage/leave), create, sign-out; index route no longer redirects into a workspace |
| In-shell workspace switcher | frontend | ✅ | `WorkspaceSwitcher` in the sidebar header — switch workspace / "All workspaces" / create; replaces the static title |
| Departed-member identity + message hiding (reversible) | backend | ✅ | `MessageWire.authorActive`; `listMessages` LEFT JOINs membership → blank body + `authorActive=false` for non-members on both history + catch-up; restored on rejoin (read-time, non-destructive) |
| Departed-member rendering | frontend | ✅ | `MessageRow` shows "Message unavailable"; `MessageList` labels author "Former member" |
| Live roster sync over realtime (no reload) | full-stack | ✅ | **Resolves the 6.5 eventual-consistency caveat** (pulled forward from S8). New `WorkspaceEvent` (`member.added`/`removed`/`role_changed`) broadcast to *all* workspace sockets (hub fans non-channel events to `entry.sockets`); `members`/`invites.service` publish on each mutation; `useWorkspaceEvents` invalidates roster/directory/my-workspaces/invites, withholds a departed author's loaded messages in-cache (mirrors server hiding), refetches on rejoin, and bounces self-removal to the dashboard |
| Test: departed author hidden then restored on rejoin | test | ✅ | `departed-author.test.ts` (history + catch-up) |
| Test: MessageRow departed/unavailable state | test | ✅ | RTL |
| Test: hub routes workspace events to all sockets, channel events only to subscribers | test | ✅ | `unit/hub.test.ts` (3) |
| Test: member ops publish the right bus event | test | ✅ | `integration/member-events.test.ts` (4) |
| Test: cross-channel withholding + key filtering | test | ✅ | `use-workspace-events.test.ts` (2) |
| **GATE: dashboard + departure suite green** | gate | ✅ | at 6.5 close: server 39/39, front 18/18 · after live-roster sync: **server 46/46, front 20/20**, both typecheck clean |

## Sprint 6.6 — Notifications & awareness layer

Closes the gap that the realtime layer only powered the *open* conversation: no awareness of other channels, unopened DMs, or other workspaces, and no notification model. Adds an always-on user-scoped socket + a typed, persisted inbox.

| Task | Area | Status | Notes |
|---|---|---|---|
| Awareness backbone: `UserEvent` + per-user NOTIFY channel (`rt_user_<id>`) | backend | ✅ | `protocol.ts` (`unread.bump` / `notification.created`, `NotificationWire`); backplane generalized to NOTIFY-channel-name keys; hub gains a user-socket registry + `publishToUser` |
| Always-on user socket `/ws/user` (session-only, no workspace) | backend | ✅ | `server.ts` upgrade branch; awareness socket carries no subscriptions |
| Send-path fan-out | backend | ✅ | `messages.service` pushes `unread.bump` to every other channel member; DMs also persist + push `notification.created` (best-effort, never fails the send) |
| Notifications store (control plane) + endpoints | backend | ✅ | `notifications` table (control migration 0005) + `modules/notifications` (`GET /`, `GET /summary`, `POST /seen`, `POST /read`), mounted `/api/notifications` outside `loadWorkspace`; summary sums per-workspace unread (tenant fan-out) + folds notif counts |
| User socket client + awareness provider | frontend | ✅ | `lib/user-realtime.ts`; `NotificationsProvider` (mounted under `RequireAuth`, survives navigation) folds events into caches; resync on reconnect |
| Live unread everywhere + active-channel clamp | frontend | ✅ | bumps into channels/DMs caches (sidebar) + summary roll-up; skips the active+focused channel |
| Workspace roll-up badges | frontend | ✅ | dashboard cards + workspace switcher rows, from the live summary |
| `NotificationBell` inbox dropdown (seen + read) | frontend | ✅ | bell + unseen badge in dashboard top bar + workspace shell; open → mark seen; click item → mark read + navigate; opening a DM marks its notifications read |
| Test: hub routes user events to a user's awareness sockets only | test | ✅ | `unit/hub.test.ts` (+2) |
| Test: channel msg bumps unread (no inbox); DM persists + publishes notification; summary + seen/read | test | ✅ | `integration/notifications.test.ts` (3) |
| Test: store reducers + bell (seen-on-open, mark-read) | test | ✅ | `store.test.ts` (6), `NotificationBell.test.tsx` (3) |
| **GATE: notifications suite green** | gate | ✅ | **server 51/51, front 29/29**, both typecheck clean |

### Sprint 6.6b — fixes + redesign (user feedback)

| Task | Area | Status | Notes |
|---|---|---|---|
| Fix unread double-count (2–3 per message) | frontend | ✅ | `use-channel-stream` no longer bumps `channelsKey` unread; the awareness socket's `unread.bump` is the **single** incrementer (the open channel was being counted by both sockets) |
| Notifications capture ALL messages (not just DMs) | full-stack | ✅ | fan-out persists a `'message'` notification for channel messages too (was the empty-bell cause); `important` column + `'mention'` type reserved for the future tag system |
| Notification holds workspace + channel | backend | ✅ | `channel_name` snapshot added to the row/wire ("in #general"); DMs carry null |
| Per-workspace enable/disable | full-stack | ✅ | `notification_settings` table (migration 0006) + `GET/PUT /api/notifications/settings/:workspaceId`; fan-out gates `notification.created` (unread counts always fire); toggle UI on the workspace-settings page |
| Global toast on new notification | frontend | ✅ | `NotificationsProvider` toasts (sonner) with a "View" action; skipped for the active+focused channel |
| Global notification bell (out of workspace) | frontend | ✅ | single bell moved into the new rail; removed from the workspace shell + mobile bar |
| Slack-style global workspace rail | frontend | ✅ | `WorkspaceRail` (icons + live unread + create + bell + user menu) in `AppFrame` under `RequireAuth`; card-grid dashboard removed, `/` resolves to last/first workspace |
| **GATE: revised notifications suite green** | gate | ✅ | **server 52/52, front 29/29**, both typecheck clean |

## Sprint 6.7 — Read-state & "seen" receipts

Completes the half-wired read-state model: an honest focus-gated "seen" signal, correct unread clearing for channels **and** DMs, and a "Seen by" read-line. All derived from `channel_members.last_read_seq` — **no new storage**.

| Task | Area | Status | Notes |
|---|---|---|---|
| Read-cursors endpoint | backend | ✅ | `getChannelReads` + `GET /channels/:id/reads` → `[{ userId, lastReadSeq }]` (membership-gated); `markRead` already broadcasts `channel.read` as the live signal |
| Honest "seen" trigger (focus-gated) | frontend | ✅ | read cursor advances only while `document.hasFocus()`; re-checks on `focus`/`visibilitychange` — a message landing on a backgrounded tab stays unread (no false receipt) |
| Unread badge clears for DMs too | frontend | ✅ | `useMarkRead` + the `channel.read` handler now zero `channelsKey` **and** `dmsKey` (the DM badge previously never cleared) |
| Live read-cursors cache + receipts | frontend | ✅ | `useChannelReads` (seeded on open) + `use-channel-stream` upserts every member's cursor on `channel.read`; pure `readersOf`/`upsertRead` |
| `SeenBy` read-line under the latest message | frontend | ✅ | channel: avatar stack + "Seen by Alice, Bob +N"; DM: "Seen"; hidden until someone else catches up |
| Test: cursors reported + monotonic + member-gated | test | ✅ | `integration/reads.test.ts` (2) |
| Test: `readersOf`/`upsertRead` + `SeenBy` render | test | ✅ | `use-reads.test.ts` (4), `SeenBy.test.tsx` (3) |
| **GATE: read-state suite green** | gate | ✅ | **server 54/54, front 36/36**, both typecheck clean |

## Sprint 7 — Attachments

| Task | Area | Status | Notes |
|---|---|---|---|
| Presigned upload endpoint (S3 service exists) | backend | ❌ | |
| Attachment row linked to message | backend | ❌ | table exists |
| Size/MIME validation | backend | ❌ | |
| Frontend: file picker in composer | frontend | ❌ | |
| Frontend: image preview / download render | frontend | ❌ | |
| Test: presign requires membership | test | ❌ | |
| Test: attachment bound to message/tenant | test | ❌ | |
| Test: oversize / disallowed-type rejected | test | ❌ | |
| **GATE: attachments suite green** | gate | ❌ | |

## Sprint 8 — Security & realtime hardening

| Task | Area | Status | Notes |
|---|---|---|---|
| App rate limiting (message send / create / invite) | backend | ❌ | |
| WS session liveness (re-validate + disconnect on revoke) | backend | ❌ | long-socket gap |
| Payload-size limits | backend | ❌ | |
| OpenAPI docs (channels/messages/members/DMs/attachments) | backend | ❌ | |
| Test: rate limit trips + recovers | test | ❌ | |
| Test: revoked session drops live socket | test | ❌ | |
| Test: oversized payload rejected | test | ❌ | |
| **GATE: security suite green** | gate | ❌ | |

## Sprint 9 — Final validation & release readiness

| Task | Area | Status | Notes |
|---|---|---|---|
| Playwright setup | test | ❌ | |
| E2E full journey (two clients, realtime) | test | ❌ | signup→ws→invite→channel→msg→DM→attach→edit/delete→leave |
| Multi-instance NOTIFY fan-out test | test | ❌ | two instances, one DB |
| Isolation audit suite (every endpoint) | test | ❌ | no cross-tenant leakage |
| CI full matrix (typecheck+unit+integration+component+E2E) | ops | ❌ | |
| Docker images build verified | ops | ❌ | |
| Prod env checklist | ops | ❌ | |
| Migrate + `migrate-tenants` on deploy | ops | ❌ | |
| Sentry error tracking | ops | ❌ | |
| Health / readiness endpoints | ops | ❌ | |
| Seed/demo data + smoke runbook | ops | ❌ | |
| **FINAL GATE: all suites + E2E + multi-instance + isolation green in CI, Docker boots = MVP READY** | gate | ❌ | |

---

## MVP-ready definition
Sprint 9's final gate ✅ — every sprint suite, E2E, multi-instance fan-out, and the
isolation audit pass in CI, **and** the deploy artifact builds and boots. That line is
"this is an MVP ready to be shipped."

---

## Changelog
| Date | Sprint | Change |
|---|---|---|
| 2026-06-11 | — | Tracker created; baseline recorded; all sprints ❌ not started. |
| 2026-06-11 | 0 | **Sprint 0 complete.** Vitest harness (server + front), disposable `*_test` Postgres + migrate/clean global-setup, factories, 5 engine integration tests, CI workflow, server Dockerfile + compose + `.dockerignore`. Fixed broken `start` entrypoint + duplicate script. Gate green locally: server 5/5, front 3/3, both typecheck clean. → Active sprint: 1. |
| 2026-06-11 | 1 | **Sprint 1 complete.** `requireWorkspaceRole` guard + `InsufficientWorkspaceRole` code; permission matrix decided (members create channels); audit extended (`WorkspaceEventName` + `logWorkspaceEvent`) and applied to `channel.created`. 7 authz tests (role guard, cross-tenant denial, audit). Gate green: server 12/12, typecheck clean. Role guard gets *applied* to admin routes from Sprint 2. → Active sprint: 2. |
| 2026-06-11 | 2 | **Sprint 2 backend complete.** `invite_tokens` (migration 0003, hashed tokens) + full membership API: tokenized email invites + accept (outside `loadWorkspace`), admin add-by-email, list/role/remove (admin-gated), leave, owner protection, tenant channel cleanup on exit. Invite email template. Audit on all member actions. 10 membership tests. Gate: server 22/22, typecheck clean. **Frontend (members page, invite UI, accept route) = Sprint 2b, next push.** |
| 2026-06-11 | 2b | **Sprint 2 frontend complete → Sprint 2 ✅.** `features/members` API hooks; Members page (roster + admin role/remove, owner/self-guarded) with sidebar link; `InvitePanel` (invite-by-email + pending list); `/accept-invite/:token` page (pending/expired/used/mismatch); leave-workspace section. Full gate green: server 22/22, front 3/3, both typecheck clean. → Active sprint: 3. |
| 2026-06-11 | 3 | **Sprint 3 complete.** Mutable `workspaces.name` (migration 0004) + `isOwner` on workspace DTO; admin rename + owner-only delete with tenant-schema teardown (cascade + cache clears) + audit; cached member directory (`getDirectory`/`invalidateDirectory` + endpoint, invalidated on member changes — feeds S5 author names); workspace settings page (rename / type-to-confirm delete) + admin sidebar link. 4 workspace tests. Full gate: server 26/26, front 3/3, both typecheck clean. → Active sprint: 4. |
| 2026-06-11 | 4 | **Sprint 4 backend complete.** Tenant schema v3 (`topic`/`archived`/`created_by`, migration 0003, dev tenants upgraded). Channel mgmt API: PATCH rename/topic/archive, DELETE, leave, private member list/add/remove — authz = workspace admin OR channel creator (`assertCanManageChannel`); archived channels hidden from list + unjoinable. Audited rename/archive/delete. 6 channel-mgmt tests (incl. private non-member 403 over REST **and** WS subscribe). Gate: server 32/32, typecheck clean. **Frontend (channel settings, member mgmt, leave) = Sprint 4b, next push.** |
| 2026-06-11 | 4b | **Sprint 4 frontend complete → Sprint 4 ✅.** `use-channel-admin` hooks; `ChannelSettingsDialog` (gear in channel header) — rename/topic, private member add/remove (from workspace roster), leave, archive + delete danger zone; admin/creator-gated controls. Full gate: server 32/32, front 3/3, both typecheck clean. → Active sprint: 5. |
| 2026-06-11 | 5 | **Sprint 5 complete.** Author names/avatars via `useDirectory` + new `MessageRow` (replaces raw ids); inline edit + delete for own messages; keyset history paging (`useOlderMessages` + `mergeBatch`, scroll-anchored). RTL introduced (jest-dom/user-event/cleanup). +14 frontend tests (message-cache reconcile/dedupe/paging, MessageRow states + edit/delete flows). Full gate: server 32/32, front 17/17, both typecheck clean. → Active sprint: 6. |
| 2026-06-11 | 6 | **Sprint 6 complete.** Direct & group messages on the existing engine: idempotent open-or-create via canonical `dm_key` (`dm.service`), participants-only access (REST + WS), DMs split out of the channel list. Frontend: `DmList` sidebar + `NewDmDialog` (multi-select), ChannelView resolves DMs. 6 DM tests. Full gate: server 38/38, front 17/17, both typecheck clean. → Active sprint: 7. |
| 2026-06-11 | 6.5 | **Sprint 6.5 complete (mid-roadmap insert).** Multi-workspace dashboard at `/` (`WorkspaceDashboard`: open/manage/leave/create) + in-shell `WorkspaceSwitcher`; index route no longer auto-redirects. Departed-member handling: `authorActive` on the wire + read-time membership join hides a departed member's body ("Message unavailable" / "Former member") reversibly (restored on rejoin). +2 tests (server departed-author hide/restore, RTL unavailable state). Full gate: server 39/39, front 18/18, both typecheck clean. → Active sprint: 7. |
| 2026-06-13 | 6.5 | **Live roster sync (resolves the 6.5 eventual-consistency caveat; pulled forward from S8).** New workspace-scoped realtime events — `WorkspaceEvent` (`member.added`/`removed`/`role_changed`) carried alongside channel events via `RealtimeEvent` + `isChannelEvent` discriminator; hub fans non-channel events to *every* socket in the workspace (`entry.sockets`), not just channel subscribers. `members.service` + `invites.service` publish on each mutation. New `useWorkspaceEvents` (mounted in `AppShell`) invalidates roster/directory/my-workspaces/invites, withholds a departed author's already-loaded messages in-cache (mirrors the server's read-time hiding — no reload), refetches on rejoin to restore, and bounces a self-removal to the dashboard. +7 tests (hub routing 3, member-event publish 4) server, +2 front (withholding/key-filtering). Full gate: **server 46/46, front 20/20**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-13 | 6.6 | **Notifications & awareness layer complete (mid-roadmap insert).** The realtime layer only powered the open conversation; added an always-on, user-scoped awareness socket (`/ws/user`) + per-user NOTIFY channel so unread/notifications reach a user across every channel, unopened DM, and other workspace (incl. the dashboard, which had no socket). Backplane generalized to NOTIFY-channel-name keys; hub gains a user-socket registry + `publishToUser`. Send-path fans `unread.bump` to other members; DMs also persist a control-plane `notifications` row (migration 0005) + push `notification.created`. New `modules/notifications` (list/summary/seen/read). Frontend: `UserRealtime` + `NotificationsProvider` (under `RequireAuth`) fold events into caches with an active-channel clamp; live sidebar unread, workspace roll-up badges (dashboard cards + switcher), and a `NotificationBell` inbox with seen+read. @mentions deferred (`type` column reserves `'mention'`). +5 server tests (hub user-event routing 2, notifications fan-out/summary 3), +9 front (store reducers 6, bell 3). Full gate: **server 51/51, front 29/29**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-13 | 6.6b | **Notifications fixes + Slack-style redesign (user feedback).** Fixed the unread **double-count** (2–3 per message): `use-channel-stream` no longer bumps `channelsKey` unread — the awareness `unread.bump` is the single source (the open channel was double-counted by both sockets). Notifications now capture **all** messages (`type: 'message'` for channels, fixing the empty bell), each carrying a `channel_name` snapshot; `important` column + `'mention'` reserved for the future tag system. Added **per-workspace enable/disable** (`notification_settings`, migration 0006; `GET/PUT /settings/:workspaceId`; fan-out gates notifications while unread always fires; toggle UI in workspace settings). Added a **global toast** (sonner, "View" action, skipped for the active+focused channel). UI: single **global `NotificationBell`** moved into a new Slack-style **`WorkspaceRail`** (workspace icons + live unread + create + user menu) in `AppFrame` under `RequireAuth`; the 6.5 card-grid dashboard was removed and `/` now resolves to the last/first workspace. Tests updated (all-message + settings-gating fan-out). Full gate: **server 52/52, front 29/29**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-13 | 6.6c | **Realtime review — double-fire + popup fixes + scale.** Root-caused the *second* double (toasts/notifications firing twice): React StrictMode (and reconnect flaps) left a superseded socket whose handlers still fired. Both `UserRealtime` + `WorkspaceRealtime` now **tear down the old socket and guard every handler on socket identity** (`if (this.ws !== ws) return`), so a stale connection can't deliver. Added **defense-in-depth idempotency** in `NotificationsProvider` (dedupe `notification.created` by id, `unread.bump` by `channelId:seq`) — robust even under at-least-once transports. Fixed the **bell popup positioning**: it opened `right-0/top-full` off the bottom-left rail (clipped off-screen) → now `bottom-0 left-full` to the right of the rail, capped `max-w-[calc(100vw-5rem)]` so it never spills on mobile. Scale: the send fan-out now publishes all recipient events in **one** backplane round-trip (`backplane.publishMany` zips `pg_notify` via `unnest`; `hub.publishToUsers`) instead of O(2·members) NOTIFYs. Full gate: **server 52/52, front 29/29**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-29 | Infra | **Bun monorepo + single-origin deploy (Express serves the SPA) for Render/Railway.** Converted the pnpm workspace to a **Bun** workspace (root `workspaces` field + Bun `--filter` scripts; deleted `pnpm-workspace.yaml`/`pnpm-lock.yaml`/`.npmrc`; `bun.lock` committed) and switched the server to the **Bun runtime** — runs TS directly (`bun --watch run src/server.ts`), dropping `tsx` and the `tsc`→`dist` build (Bun resolves the `.js`→`.ts` specifiers, so no import edits). [app.ts](chat-server/src/app.ts) now serves the built SPA: `express.static` + a GET/HTML history-fallback to `index.html`, gated on `FRONT_DIST_DIR` existing and excluding the `/api`,`/health`,`/ws` namespaces — so dev (separate Vite origin) and the integration tests are untouched, and the raw-HTTP WS upgrade is unaffected. Front went **single-origin**: `VITE_API_URL` is now optional and resolves to `window.location.origin` when unset (new `API_URL` in [config/env.ts](chat-front/src/config/env.ts), threaded through `api.ts`/`auth-client.ts`/`realtime.ts`/`user-realtime.ts`/`use-upload-avatar.ts`). Deploy artifacts: [Dockerfile](chat-server/Dockerfile) rebased on `oven/bun` (installs workspace → builds SPA → runs server), new `render.yaml` (Docker web service + managed Postgres; Railway reuses the Dockerfile), `docker-compose.yml` + CI (`oven-sh/setup-bun`) updated. **Vercel/Netlify ruled out** (confirmed: their serverless functions can't host the WebSocket/`LISTEN`-`NOTIFY` realtime layer); a long-running host keeps realtime unchanged. Verified under Bun: install/typecheck/tests green (**server 89/89, front 61/61**), and a prod-parity boot served the SPA + deep links + assets, 404'd unknown `/api/*` (no SPA leak), and attached + handled the `/ws` upgrade without crashing. |
| 2026-06-29 | 7.6 | **Unread single-source-of-truth + on-refresh flicker fix (feedback).** Made per-conversation unread have ONE authoritative owner — the channel + DM list caches (what the sidebar shows, kept exact by the bump/clear path) — and demoted the notifications summary to a pure SEED for *unopened* workspaces (plus the bell's `unseen` + inbox `notifications`, which have no list equivalent). The summary no longer auto-refetches (`staleTime: Infinity`, `refetchOnWindowFocus: false`, `placeholderData` not `initialData`) — a background refetch was what resurrected cleared counts. Killed the refresh flicker (a badge that flashes then clears) with one consistent rule, [`useActiveConversation`](chat-front/src/features/channels/hooks/use-active-channel.ts): *the conversation you're viewing has zero unread to you* — its sidebar badge is hidden ([ChannelList](chat-front/src/features/channels/components/ChannelList.tsx)/[DmList](chat-front/src/features/channels/components/DmList.tsx) via NavLink `isActive`) and it's excluded from the workspace roll-up (`sumUnread(excludeId)`), so the channel being auto-marked-read never contributes a count that immediately vanishes. For the workspace you're currently in, the roll-up waits for the authoritative lists instead of flashing the summary (which still counts the open channel). +2 front tests (active-channel exclusion, active-workspace no-flash) + sumUnread exclude case. Full gate: **server 89/89, front 61/61**, both typecheck clean. |
| 2026-06-28 | 7.5 | **Unread badge desync fixed — single source of truth (feedback: switching workspaces showed "old state +1" with no new message).** The rail/switcher badge read `summary.workspaces[w].unread` — a *second* copy of the unread count, maintained by optimistic socket bumps/clears **and** periodically refetched from the server (`staleTime 30s` + window-focus). A refetch whose snapshot predated a just-committed `markRead` **resurrected an already-cleared count** → phantom +1. Fix: [`useWorkspaceUnread`](chat-front/src/features/notifications/hooks/use-workspace-unread.ts) now derives `unread` from the **live channel + DM lists** (`sumUnread`) — the exact data the sidebar shows, kept precise by the bump/clear path — for any workspace whose lists are loaded, falling back to the summary only for never-opened workspaces. The rail mounts those lists as **disabled** queries (observe-don't-fetch), which both makes the badge reactive to live bumps and keeps the lists alive (so they stay socket-accurate even for workspaces you've navigated away from). Rail and sidebar can now never disagree, and a stale summary refetch can't resurrect a cleared count. `notifications` (inbox) still comes from the summary (no list equivalent, not race-prone). +3 front tests (list-derived vs summary-fallback, stale-summary ignored). Full gate: **server 89/89, front 59/59**, both typecheck clean. |
| 2026-06-28 | 7.3 | **Private-bucket reads fixed everywhere via a signed-redirect endpoint (feedback: avatars + edited/old attachments showed AccessDenied; optimistic images `ERR_FILE_NOT_FOUND`).** Two latent problems: (a) **avatars** persisted the raw S3 **public URL** on a private bucket → AWS 403; (b) attachment wires embedded a **6h-expiring** presigned GET, so cached/edited/old rows eventually 403'd. Unified fix: a public, namespace-scoped **`GET /api/files?key=…`** ([files.controller.ts](chat-server/src/modules/files/files.controller.ts)) that validates the key is in our `chat/` namespace (can't sign the shared bucket's sibling-app objects) and **302s to a freshly-signed, short-lived S3 GET** — *stable URL in, fresh signature out*, so stored URLs never expire. `toAttachmentWire` now emits `fileProxyUrl(s3_key)` (stable, no per-read signing); [use-upload-avatar](chat-front/src/features/account/api/use-upload-avatar.ts) persists the same pointer as `image` (works in session, directory, and message author snapshots — OAuth avatars pass through untouched). Also revoke the composer's optimistic `blob:` previews on send-settle (kills the leaked/dead blob URL). Endpoint is intentionally unauthenticated (key-as-bearer; `<img>`/`<video>` can't send the cookie cross-origin), prefix-locked + traversal-guarded. **Note:** avatars uploaded *before* this fix store the old public URL → re-upload to refresh. +7 server tests (files: key validation, proxy-URL shape, 302/400/404 controller paths). Full gate: **server 89/89, front 56/56**, both typecheck clean. |
| 2026-06-14 | 7.2 | **Composer + editor UX redesign (feedback).** Rebuilt the message composer and inline editor as one cohesive control instead of a bare textarea + floating chips: a rounded, shadowed input box with `focus-within` ring, an attachment **preview tray inside the box** (top, divider), an **auto-growing** textarea, and a clean toolbar (attach left, round send right; Save/Cancel + hint for the editor). New shared [AttachmentPreviewTile](chat-front/src/features/attachments/components/AttachmentPreviewTile.tsx) — real **image thumbnails**, compact file cards, an upload **progress overlay**, error state, and a hover-reveal remove — used by both composer and editor (existing + pending). Drag-over highlights the box + swaps the placeholder. Removed the old `PendingUploadsTray`. Pure presentational; `MessageEditor.test` now queries image tiles via alt text. Full gate: **server 82/82, front 56/56**, both typecheck clean. |
| 2026-06-14 | 7.1 | **Attachment edit + private-read fixes (post-Sprint-7 feedback).** (1) **Private reads:** uploaded objects 403'd on open (bucket is private; storing the public URL was wrong). Attachments are now served via **short-lived presigned GET URLs** (`s3Service.getDownloadUrl`, signed fresh per read from `s3_key`) — works on a private bucket, expires, never world-readable. Optimistic send row previews from a local object URL until the server's signed URL arrives. (2) **Mature edit:** a real Slack/GitHub-style edit editor ([MessageEditor.tsx](chat-front/src/features/channels/components/MessageEditor.tsx)) — keep/remove individual existing attachments + add new files (shared upload hook + extracted `PendingUploadsTray`). Server `editMessage` reconciles the attachment set (`keepAttachmentIds` undefined → untouched; provided → delete-not-kept + add new, HEAD-verified) with a final non-empty guard; `editMessageBody` + `onEdit` signature now carry the payload. Fixes media vanishing on edit. +4 server tests (edit preserve/reconcile/reject-empty), +3 front (MessageEditor); MessageRow.test stubs the editor. Full gate: **server 82/82, front 56/56**, both typecheck clean. |
| 2026-06-14 | 7 | **Sprint 7 — Attachments / file manager complete.** Slack-like attachments on channels + DMs, built on the proven presigned-S3 pattern (browser→S3 direct; backend never proxies bytes). **Policy-driven** ([attachment-policy.ts](chat-server/src/modules/attachments/attachment-policy.ts)): a per-category policy (image/video/audio/document + catch-all `file`) with env-driven caps (`ATTACH_*_MAX_MB`, `ATTACH_MAX_PER_MESSAGE`) — SVG/HTML/unknown types fall to the download-only `file` category (`Content-Disposition: attachment`, never inline → XSS-safe). **Upload flow:** `POST …/channels/:id/attachments/presign` (member-gated, server-generated scoped key, type+size bound) → direct PUT → post message with `{key, filename}` refs. **Send-time trust boundary** (`resolveAttachmentsForSend`): ownership-prefix check + S3 `HeadObject` to read the REAL type/size (no client spoofing) + policy re-validation, then message + attachment rows persist atomically; withheld for departed authors alongside the body. New `attachments` columns (tenant schema **v4**, migration 0004 — dev tenants migrated); `MessageWire.attachments` + `GET /api/attachments/policy`. Send DTO now allows a **file-only message** (text OR ≥1 attachment). **Client** (`features/attachments`): policy hook, an upload state-machine hook with **XHR progress**, a composer paperclip + drag-drop tray (per-file progress/remove, send blocked while uploading), category-aware rendering in `MessageRow` (inline image / video / audio player, download chip otherwise). S3 mocked in tests (never touches the live bucket / real `.env`). +16 server tests (policy 6, attachments 10), +11 front (policy/render/upload-state-machine). Full gate: **server 79/79, front 53/53**, both typecheck clean. MVP feature scope complete. |
| 2026-06-14 | 6.9 | **Complete realtime event coverage (every admin/user action).** Finished what 6.8 started — wired the whole `WORKSPACE_ACTIONS` map so every mutation propagates live, no reload. **Workspace:** rename → `workspace.updated` broadcast (rail/switcher/header re-read); delete → `workspace.deleted` **dual-routed** to every member's always-on user socket (captured before the cascade) so even members on the dashboard/another workspace get bounced. **Channel membership:** add/remove dual-route `channel.added`/`channel.removed` to the affected user (channel appears / disappears + bounce if viewing) plus a `channel.updated` broadcast so member-list viewers re-read; public join/leave broadcast `channel.updated`. **DM:** `openOrCreateDm` dual-routes `dm.created` to the other participant(s) — only on a genuinely new DM (idempotent re-open stays silent) — so it shows in their sidebar live. **Profile:** a Better Auth `user.update` hook (`announceProfileUpdate`) refreshes the directory + broadcasts `directory.updated` to each of the user's workspaces, so name/avatar changes refresh author identity live (the directory overrides message snapshots). New protocol kinds: `workspace.updated`/`directory.updated` (ws socket) + `workspace.deleted`/`channel.added`/`channel.removed`/`dm.created` (user socket); `UserEvents` builder catalog + dual-route via `emitUserEvents`. Client: `use-workspace-events` handles workspace/directory/channel-member events; `NotificationsProvider` (user socket) handles the targeted structural events (invalidate + bounce). +6 server tests (workspace rename/delete, channel add/remove, join/leave, dm.created). Full gate: **server 63/63, front 43/43**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.8 | **Realtime event registry + channel-lifecycle events (single event point).** Mapped every workspace action and consolidated realtime into one module, [events.ts](chat-server/src/infrastructure/realtime/events.ts): a typed `RealtimeEvents` builder catalog (the single definition of each event), `emitWorkspaceEvent` (best-effort workspace broadcast) + `emitUserEvents` (the dual-route helper for targeted user-socket delivery), a re-export of the audit `WorkspaceEventName`, and a `WORKSPACE_ACTIONS` doc-map recording the complete taxonomy incl. reserved (channel-membership add/remove/join/leave, dm.created, workspace.deleted bounce, profile). Closed the **channel-lifecycle** realtime gap: `createChannel`/`updateChannel`/`deleteChannel` now emit `channel.created`/`channel.updated`/`channel.deleted` (id-only — clients re-read the visibility-scoped list, so broadcasting a private channel's id is harmless). Migrated all existing `member.*` realtime (members.service + invites.service) through `emitWorkspaceEvent` so the single point is real (and best-effort — a publish failure no longer fails a roster mutation). Fixed a latent routing trap: `isChannelEvent` is now **kind-based** (explicit `CHANNEL_EVENT_KINDS` set) not structural (`"channelId" in event`), so lifecycle events that carry a channelId still fan out workspace-wide instead of being misrouted to (nonexistent) subscribers. Client [use-workspace-events](chat-front/src/features/workspaces/realtime/use-workspace-events.ts) handles `channel.*` (invalidate channels list; bounce out of a deleted channel you're viewing) with roster invalidation now scoped to `member.*` only. +3 server tests (channel.created/updated/deleted on the bus). Full gate: **server 57/57, front 43/43**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.7h | **Conversation-start header (UI polish).** The timeline began mid-air — the oldest message just appeared at the top, and an empty channel showed a bare "No messages yet". Added a Slack-style `ConversationStart` rendered at the top of `MessageList` once there's no older history (`!hasMore`), and in place of the empty state: channels show an icon tile + `#name` + "the very beginning of …" + topic + created date; DMs show the other participant(s)' avatar(s) + names + a "beginning of your direct message history" line. Threaded the full `channel` (incl. DM `participants`) into `MessageList`; dropped the now-redundant `channelId`/`isDm` props (derived). Pure presentational. Full gate: **server 54/54, front 43/43**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.7g | **Author-name id flash fixed at the source (embedded snapshot + directory override).** Root of the "ids before names on refresh": message rows carried only `authorId`, with names/avatars resolved from the separately-loaded `useDirectory` query — so a cold refresh painted before the directory arrived. Rather than freeze identity into each row (which would go stale on rename/avatar change), adopted the hybrid Slack/Discord pattern: read paths (`listMessages`) now LEFT JOIN `users` and embed an `authorName`/`authorImage` **snapshot** on the wire (`MessageWire`), withheld for departed authors alongside the body; the client (`MessageList`) **prefers the live directory** (renames stay fresh) and falls back to the snapshot, so the first paint is correct with zero directory dependency and no flash. Snapshot omitted on live write-path events (resolved via the already-loaded directory). Note: the `"You"` self-label was dropped so own messages show your real name (Slack-like) — now also flash-free via the snapshot. +3 assertions in the departed-author test (snapshot present → withheld → restored). Full gate: **server 54/54, front 43/43**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.7f | **Cache-shape mismatch broke live receipts/DM badges/inbox + misleading text + id flash.** (1) Three queries used `select: (d) => d.x`, storing the WRAPPED envelope (`{reads}`/`{dms}`/`{notifications}`) in cache while every realtime `setQueryData` updater (`upsertRead`, `prependNotification`, `bumpChannelUnread`, `clearConversationUnread`) assumed a BARE array — so live updates silently failed and data only appeared after a refresh (this was why "seen" needed a refresh, and DM badges/inbox lagged). Fixed by storing bare arrays (unwrap in `queryFn`, drop `select`) — `useChannelReads`, `useDirectMessages`, `useNotificationsList`; added a shape-consistency guard test. (2) `NotificationBell` hardcoded "sent you a message" even for channel posts → now "posted in #channel" vs "sent you a message" (DM), from `channelName`. (3) `MessageList` flashed raw author ids before the directory loaded → now a neutral placeholder ("…", or "Unknown member" if truly missing), never the id. Full gate: **server 54/54, front 43/43**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.7e | **"Load earlier messages" showed on empty/new channels.** `useOlderMessages.hasMore` initialized to `true` and only flipped false after a click returned a short page — so a channel whose first load already returned everything still showed the button. Fix: a per-channel `historyKey` flag, set by the initial load (`messages.length >= HISTORY_PAGE`) and updated when paging older; `hasMore` reads it reactively (defaults false → no flash on a fresh channel). +2 front tests. Full gate: **server 54/54, front 42/42**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.7d | **Workspace roll-up desync (user feedback).** The per-channel badge cleared on read but the workspace (rail) badge didn't: the summary roll-up was bumped on every new message yet never decremented on read (it relied on a focus-refetch to self-correct, so it only over-counted). Fix: one shared `clearConversationUnread(qc, ws, channelId)` ([read-sync.ts](chat-front/src/features/channels/api/read-sync.ts)) zeroes the per-channel badge AND decrements `summary.workspaces[w].unread` by exactly that amount — idempotent (reads the channel's current cached unread; a 0 is a no-op), so `useMarkRead`'s optimistic clear and the `channel.read` socket echo can both call it without double-decrementing. Now `summary.unread` stays equal to the sum of the per-channel unreads. +3 front tests (decrement, idempotency, DM). Full gate: **server 54/54, front 40/40**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-14 | 6.7c | **THE read-state bug: `markRead` was 404ing (URL mismatch).** The real root cause behind "unread = whole conversation, never resets, no receipts": the client posted the read cursor to `…/channels/:id/messages/read` (built off the messages `base`) but the server route is `…/channels/:id/read`. Every `markRead` 404'd → `last_read_seq` never advanced → unread stayed `last_seq` (total) and `channel.read` was never broadcast → no "Seen by" on channels OR DMs. Slipped past tests because the suite calls the `markRead` **service** directly, never the HTTP route. Fix: point `useMarkRead` at the channel-level `/read` path + added an HTTP-URL guard test (`use-messages.test.tsx`). This is what makes the whole 6.7/6.7b read-state layer actually work (counts clear on view, receipts flow — same code path for channels and DMs). Full gate: **server 54/54, front 37/37**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-13 | 6.7b | **Read-state fix (user feedback): unread showed total + no receipts.** Root cause: 6.7 gated the read cursor on `document.hasFocus()`, which is **false whenever DevTools/another window holds OS focus** (the normal dev setup) — so `markRead` never fired, `last_read_seq` stayed 0, and unread = `last_seq` = **total message count** (never reset on refresh, grew on every send), while no one's cursor advanced so **"Seen by" showed nobody**. Fix: gate on tab **visibility** (`visibilityState === "visible"`, new `lib/visibility.ts#isTabVisible`) in the read cursor (`ChannelView`) **and** the awareness active-channel clamp (`NotificationsProvider`). Also: a freshly **joined/added** member now starts caught up (`last_read_seq = channel.last_seq`) instead of seeing all history as unread. Full gate: **server 54/54, front 36/36**, both typecheck clean. Active sprint unchanged: 7. |
| 2026-06-13 | 6.7 | **Read-state & "seen" receipts complete (mid-roadmap insert).** Finished the half-wired read model, all derived from `last_read_seq` (no new storage). Server: `getChannelReads` + `GET /channels/:id/reads` (membership-gated); `markRead`'s existing `channel.read` broadcast is the live signal. Client: the read cursor is now **focus-gated** — it advances only while the tab is focused (re-checked on `focus`/`visibilitychange`), so a message on a backgrounded tab stays unread and sends no false receipt; fixed the **DM unread badge never clearing** (`useMarkRead` + `channel.read` now zero both `channelsKey` and `dmsKey`); added a live read-cursors cache (`useChannelReads` + `use-channel-stream` upserts every member's cursor) and a **`SeenBy`** read-line under the latest message (channel: avatars + "Seen by …"; DM: "Seen"). +2 server tests (cursors reported/monotonic/member-gated), +7 front (`readersOf`/`upsertRead` 4, `SeenBy` 3). Full gate: **server 54/54, front 36/36**, both typecheck clean. Active sprint unchanged: 7. |
