# Presence dots + typing indicators — build guide

Every snippet below is written against the real code in this repo. Type it yourself; the point is
the wiring. Where a snippet replaces an existing function I show the whole function so you can
diff it against what's on disk.

**Decisions locked in:** presence lives in hub memory (no table, no migration); online/offline only;
dots on message rows, members table, DM sidebar, DM header, notification tray; typing only in the
open conversation.

---

# Part 0 — Five concepts you need first

Read this once. Everything after it is mechanical.

### 1. There are two sockets, and they answer different questions

|               | `/ws` (workspace)                                  | `/ws/user` (awareness)          |
| ------------- | -------------------------------------------------- | ------------------------------- |
| Scope         | one workspace                                      | the user, across all workspaces |
| Subscriptions | per-channel, authorized at subscribe time          | none — heartbeat only           |
| Carries       | `RealtimeEvent` = `ChannelEvent \| WorkspaceEvent` | `UserEvent`                     |
| Lives         | inside the workspace shell                         | app-wide, under `RequireAuth`   |

Presence uses **both, in opposite directions**: the _fact_ comes from the user socket's lifecycle
("this person has the app open"), but the _announcement_ goes out on workspace sockets ("everyone in
workspace X, this person is online"). That split is the whole design. Once you see it, `presence.ts`
writes itself.

Typing is entirely on the workspace socket, because it's about one open conversation.

### 2. Publishing never delivers directly — it goes out and comes back

Look at [hub.ts:159-161](echo-server/src/infrastructure/realtime/hub.ts#L159-L161):

```ts
async publish(workspaceId: string, event: RealtimeEvent): Promise<void> {
  await this.bus.publish(workspaceNotifyChannel(workspaceId), event);
}
```

It does **not** call `deliverLocal`. It writes a Postgres `NOTIFY`, and the instance's own `LISTEN`
loops it straight back into `deliverLocal`. That single path is why one code branch serves both
"the sender is on this instance" and "the sender is on another instance" — and why you must never be
tempted to "optimize" by delivering locally first. You'd double-send.

Consequence you'll design around twice: **`NOTIFY` is at-most-once.** A dropped frame is normal, not
exceptional. Both features get a self-heal for it (presence: refetch on reconnect; typing: a TTL).

### 3. `isChannelEvent` is a routing fork, and it's a hand-maintained list

[hub.ts:199-201](echo-server/src/infrastructure/realtime/hub.ts#L199-L201):

```ts
const targets = isChannelEvent(event)
  ? entry.channelSubs.get(event.channelId) // only people with this conversation OPEN
  : entry.sockets; // everyone in the workspace
```

And `isChannelEvent` is a `Set` lookup, not a structural check — deliberately, because
`channel.created` also carries a `channelId` but must reach everyone. So:

- `presence.changed` → a **WorkspaceEvent**, no `channelId`, goes to everyone. Nothing to register.
- `typing` → a **ChannelEvent**, and you **must** add `"typing"` to `CHANNEL_EVENT_KINDS` or it
  silently broadcasts workspace-wide.

### 4. The message timeline runs on a clock, and typing must not touch it

`useChannelStream` treats `updatedSeq` as a gapless counter: equal to `lastClock + 1` → apply;
lower → dedupe; higher → a message was missed, go fetch. `channel.read` already opts out of this by
having no `updatedSeq` and returning early ([use-channel-stream.ts:82-93](echo-front/src/features/channels/realtime/use-channel-stream.ts#L82-L93)).

Typing is the same kind of event. If you forget its early return, `event.updatedSeq` is `undefined`,
both comparisons are false (`undefined <= n` and `undefined > n` are both false), and execution falls
into `mergeMessage(old, undefined, …)` — a **crash**, not a glitch.

### 5. React Query: the cache shape and the observed shape are different things

`select` transforms data **on read**. `setQueryData` writes **the cache**. If your query function
returns `{ online: string[] }` and `select` turns it into a `Set`, then a `setQueryData` patch must
write the _envelope_, not the Set — otherwise `select` receives a Set, calls `.online` on it, gets
`undefined`, and the cache is quietly broken.

Rule: **write what the queryFn wrote; transform only in `select`.**

One gotcha that follows: `select` is memoized against the function's _identity_. An inline arrow is a
new function every render, so the Set gets rebuilt every render. Hoist it to module scope.

---

# Part 1 — Presence

## 1.1 Declare the event

**`echo-server/src/infrastructure/realtime/protocol.ts`**

Add a bullet to the doc comment above `WorkspaceEvent` (the list ending `directory.updated`), then
add the variant:

```ts
export type WorkspaceEvent =
  | { kind: "member.added"; userId: string; role: "admin" | "member" }
  | { kind: "member.removed"; userId: string }
  | { kind: "member.role_changed"; userId: string; role: "admin" | "member" }
  | { kind: "channel.created"; channelId: string }
  | { kind: "channel.updated"; channelId: string }
  | { kind: "channel.deleted"; channelId: string }
  | { kind: "workspace.updated" }
  | { kind: "directory.updated" }
  | { kind: "presence.changed"; userId: string; online: boolean };
```

Doc bullet to match the house style:

```
 *   - `presence.changed`   — a member opened or closed their last client; flip
 *                            their online dot. Derived from the awareness
 *                            socket, announced here (see realtime/presence.ts).
```

Leave `CHANNEL_EVENT_KINDS` alone — see concept 3.

The frontend gets this type for free through the `@server/*` alias. That's also why the client's
`switch (event.kind)` will now warn if you forget the new case: it's a discriminated union.

## 1.2 Hub: expose the transitions and the state

**`echo-server/src/infrastructure/realtime/hub.ts`**

Four changes. The hub stays "pure plumbing" — it learns nothing about memberships or presence
policy, it just reports edges.

**(a)** `addUserSocket` returns whether this was the user's first socket:

```ts
  /**
   * Register an awareness (user) socket — receives the user's `UserEvent`s only.
   * Returns true when this is the user's FIRST socket on this instance (the
   * offline→online edge). The hub doesn't know what presence is; it just reports
   * the edge, and `presence.ts` decides what it means.
   */
  addUserSocket(ws: WebSocket, ctx: { userId: string }): boolean {
    this.userOf.set(ws, ctx.userId);
    let entry = this.userSockets.get(ctx.userId);
    const isFirst = !entry;
    if (!entry) {
      const unsubscribe = this.bus.subscribe(userNotifyChannel(ctx.userId), (event) =>
        this.deliverUser(ctx.userId, event as UserEvent),
      );
      entry = { sockets: new Set(), unsubscribe };
      this.userSockets.set(ctx.userId, entry);
    }
    entry.sockets.add(ws);
    return isFirst;
  }
```

**(b)** `removeUserSocket` returns whether that was the last:

```ts
  /**
   * Tear down an awareness socket; releases the user LISTEN if it was the last.
   * Returns true only on the online→offline edge. Note the `false` returns:
   * `close` and `error` can BOTH fire for one socket, and the second call must
   * report no edge or presence would schedule two offline announcements.
   */
  removeUserSocket(ws: WebSocket): boolean {
    const userId = this.userOf.get(ws);
    this.userOf.delete(ws);
    if (!userId) return false;              // already removed (double-fire)
    const entry = this.userSockets.get(userId);
    if (!entry) return false;
    entry.sockets.delete(ws);
    if (entry.sockets.size === 0) {
      entry.unsubscribe();
      this.userSockets.delete(userId);
      return true;
    }
    return false;                            // other tabs still open
  }
```

**(c)** Read accessors — put them next to `contextFor`:

```ts
  /** Does this user have a live awareness socket ON THIS INSTANCE? */
  isOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.sockets.size ?? 0) > 0;
  }

  /** Every user with a live awareness socket ON THIS INSTANCE. */
  onlineUserIds(): string[] {
    return [...this.userSockets.keys()];
  }
```

**(d)** A workspace fan-out that batches, next to `publishToUsers`:

```ts
  /**
   * Publish ONE event to several workspaces in a single backplane round-trip —
   * the presence path, where a user's connect concerns every workspace they
   * belong to. Same trick as `publishToUsers`: `publishMany` zips them into one
   * `pg_notify` statement instead of N.
   */
  async publishToWorkspaces(
    workspaceIds: readonly string[],
    event: RealtimeEvent,
  ): Promise<void> {
    if (workspaceIds.length === 0) return;
    await this.bus.publishMany(
      workspaceIds.map((id) => ({ channel: workspaceNotifyChannel(id), event })),
    );
  }
```

## 1.3 The presence module

**New file: `echo-server/src/infrastructure/realtime/presence.ts`**

This is the interesting file. Two jobs: work out _who to tell_, and decide _when "offline" is real_.

```ts
import { eq } from "drizzle-orm";
import { controlDb } from "../database/control/client.js";
import { memberships } from "../database/control/schema.js";
import { logger } from "../../shared/logger/logger.js";
import { hub } from "./hub.js";

/**
 * Online presence, derived from the awareness socket.
 *
 * "Online" means the hub holds at least one live `/ws/user` socket for the user.
 * There is no table and no heartbeat write — the socket registry IS the state.
 * This module owns the two things the hub deliberately doesn't:
 *
 *  1. WHO to tell. Presence is only visible to people who share a workspace with
 *     you, so a transition fans out to `rt_ws_<id>` for each workspace the user
 *     belongs to. Authorization is implicit: only a member can open that
 *     workspace's socket, so presence can't leak to a non-member.
 *
 *  2. WHEN "offline" is real. A page refresh tears the socket down and builds a
 *     new one a moment later; React StrictMode does the same on every mount in
 *     dev. Announcing offline immediately would flicker every avatar in the
 *     workspace on every refresh — so the offline edge is held for a grace
 *     window and cancelled if they come back inside it.
 *
 * Best-effort like every other dispatcher here: failures are logged, never
 * thrown into a socket lifecycle handler. Clients re-read `GET /presence` on
 * reconnect, so a dropped announcement self-heals.
 */

const OFFLINE_GRACE_MS = 8_000;

/** userId → pending "went offline" timer. */
const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>();

/** An awareness socket opened. `wasFirst` is `hub.addUserSocket`'s return. */
export function onUserConnected(userId: string, wasFirst: boolean): void {
  const timer = pendingOffline.get(userId);
  if (timer) {
    // Back inside the grace window. Nobody was ever told they left, so cancel
    // the countdown and stay silent — re-announcing online would be a redundant
    // frame describing a state the clients already hold.
    clearTimeout(timer);
    pendingOffline.delete(userId);
    return;
  }
  if (wasFirst) void announce(userId, true);
}

/** An awareness socket closed. `wasLast` is `hub.removeUserSocket`'s return. */
export function onUserDisconnected(userId: string, wasLast: boolean): void {
  if (!wasLast) return; // other tabs still open
  if (pendingOffline.has(userId)) return; // already counting down
  const timer = setTimeout(() => {
    pendingOffline.delete(userId);
    // Re-check: a socket may have arrived after this timer was scheduled but
    // before it fired (a slow reconnect that raced the clear above).
    if (!hub.isOnline(userId)) void announce(userId, false);
  }, OFFLINE_GRACE_MS);
  pendingOffline.set(userId, timer);
}

async function announce(userId: string, online: boolean): Promise<void> {
  try {
    const rows = await controlDb
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, userId));

    await hub.publishToWorkspaces(
      rows.map((r) => r.workspaceId),
      {
        kind: "presence.changed",
        userId,
        online,
      },
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, userId, online },
      "presence: announce failed (clients self-heal on next load/reconnect)",
    );
  }
}
```

**Why the DB query is fine here:** it runs once per socket connect/disconnect, not per message. A
user opening a laptop is a rare event.

**Trace the refresh case yourself** — it's the one that matters:
`close` → `wasLast=true` → timer scheduled, nothing announced → 1s later `open` → `wasFirst=true`
(the entry was deleted) **but a timer is pending** → clear it, `return`. Zero frames sent. The
clients never learned anything, and they were right the whole time.

## 1.4 Hook it to the socket lifecycle

**`echo-server/src/infrastructure/realtime/server.ts`**

Add the import (`import * as presence from "./presence.js";`) and replace the `role === "user"`
branch in the `connection` handler:

```ts
wss.on("connection", (ws: WebSocket, info: ConnectionInfo) => {
  if (info.role === "user") {
    // Presence rides this socket's lifecycle: first one in = online, last one
    // out = offline (after a grace window — see presence.ts).
    presence.onUserConnected(
      info.userId,
      hub.addUserSocket(ws, { userId: info.userId }),
    );
    ws.on("message", (data) => void onUserMessage(ws, data.toString()));
    // `close` and `error` can both fire; `removeUserSocket` reports the edge
    // only once, so the second call is a no-op.
    const detach = () =>
      presence.onUserDisconnected(info.userId, hub.removeUserSocket(ws));
    ws.on("close", detach);
    ws.on("error", detach);
    return;
  }

  hub.add(ws, { userId: info.userId, workspaceId: info.workspaceId });
  // …unchanged
});
```

**Checkpoint.** Add a temporary `logger.info` inside `announce` and open/close a second browser.
You want exactly one line per real transition, and **zero** lines on a refresh.

## 1.5 The snapshot endpoint

Events carry transitions; a client that just loaded needs current state.

**New file: `echo-server/src/modules/members/presence.service.ts`**

```ts
import { hub } from "../../infrastructure/realtime/hub.js";
import { getDirectory } from "./directory.service.js";

/**
 * Which members of this workspace are online right now.
 *
 * The hub's registry is process-wide and NOT workspace-scoped, so it must be
 * intersected with the roster before it leaves the server — returning the raw
 * list would leak the existence of users from other workspaces.
 *
 * The roster comes from the cached directory (`userId → profile`, 60s TTL), so
 * this is a map lookup per online user and usually costs no query at all.
 */
export async function listOnlineMembers(
  workspaceId: string,
): Promise<string[]> {
  const directory = await getDirectory(workspaceId);
  return hub.onlineUserIds().filter((userId) => userId in directory);
}
```

**`echo-server/src/modules/members/members.controller.ts`** — add the import and one handler beside
`getDirectoryController`:

```ts
import { listOnlineMembers } from "./presence.service.js";

/** User ids of workspace members with a live awareness socket. */
export async function getPresenceController(
  req: Request,
  res: Response,
): Promise<void> {
  res.json({ online: await listOnlineMembers(req.workspace.id) });
}
```

**`echo-server/src/modules/workspaces/workspaces.routes.ts`** — add `getPresenceController` to the
existing `members.controller.js` import, then one route under the directory line (already past the
`loadWorkspace` membership wall):

```ts
// Cached member directory (name/avatar) — any member may read.
workspacesRouter.get(
  "/:workspaceId/directory",
  asyncHandler(getDirectoryController),
);

// Who's online right now — same audience as the directory.
workspacesRouter.get(
  "/:workspaceId/presence",
  asyncHandler(getPresenceController),
);
```

## 1.6 Client cache

**`echo-front/src/features/members/api/keys.ts`**

```ts
/** User ids currently online in this workspace (live-patched by presence.changed). */
export const presenceKey = (workspaceId: string) =>
  ["ws", workspaceId, "presence"] as const;
```

The `["ws", id, …]` prefix matters — the reconnect self-heal invalidates by predicate over it.

**New file: `echo-front/src/features/members/api/use-presence.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { presenceKey } from "./keys";

/** Wire shape — and deliberately the CACHE shape too. See the note below. */
interface PresenceResponse {
  online: string[];
}

/**
 * Hoisted, not inline. React Query memoizes `select` against the function's
 * IDENTITY, so an inline arrow would rebuild the Set on every render and hand
 * consumers a fresh reference each time.
 */
const toSet = (d: PresenceResponse) => new Set(d.online);

/**
 * Who's online in this workspace, as a Set for an O(1) `has()` at every avatar.
 *
 * The cache stores the raw `{ online: [...] }` envelope and `select` converts it
 * on read. That split is deliberate: `use-workspace-events` patches this cache
 * with `setQueryData` when a `presence.changed` arrives, and a patcher must
 * write the same shape the queryFn wrote. Store the Set directly and the patch
 * and the transform disagree about the type — which fails silently.
 */
export function usePresence(workspaceId: string) {
  return useQuery({
    queryKey: presenceKey(workspaceId),
    queryFn: () =>
      apiFetch<PresenceResponse>(`/api/workspaces/${workspaceId}/presence`),
    select: toSet,
    staleTime: 30_000,
  });
}
```

**`echo-front/src/features/workspaces/realtime/use-workspace-events.ts`** — import `presenceKey`,
then add a case to the switch:

```ts
        case "presence.changed":
          // The only event here that PATCHES instead of invalidating. Everywhere
          // else the event just says "something changed, re-read it" — but
          // presence has no cheaper source than the event itself, and the
          // payload is already the complete truth for that one user. Refetching
          // the whole snapshot because someone opened a tab would be absurd.
          qc.setQueryData<{ online: string[] }>(presenceKey(workspaceId), (prev) => {
            if (!prev) return prev;           // not loaded; the first fetch will be current
            const has = prev.online.includes(event.userId);
            if (has === event.online) return prev;   // same reference → no re-render
            return {
              online: event.online
                ? [...prev.online, event.userId]
                : prev.online.filter((id) => id !== event.userId),
            };
          });
          break;
```

Then add a **second effect** in the same hook for the reconnect self-heal:

```ts
// Transitions that happened while the socket was down are gone — NOTIFY
// doesn't replay. Presence is the one cache here with no other refresh path,
// so re-read the snapshot on every reconnect.
useEffect(() => {
  return client.onStatus((status, reconnected) => {
    if (status === "open" && reconnected) {
      qc.invalidateQueries({ queryKey: presenceKey(workspaceId) });
    }
  });
}, [client, qc, workspaceId]);
```

## 1.7 `UserAvatar` grows a dot

**`echo-front/src/components/ui/user-avatar.tsx`** — replace the component (keep `initials` as is):

```tsx
interface UserAvatarProps {
  name: string;
  image?: string | null;
  /** Sizing/spacing. Pass `h-* w-*` or `size-*`; both override the default. */
  className?: string;
  /** The 16px and 28px avatars only have room for one letter. */
  maxInitials?: number;
  /** For avatars visible on first paint (the account button in the rail). */
  priority?: boolean;
  /**
   * Presence dot. Tri-state ON PURPOSE:
   *   undefined → no dot. Every existing call site, and any avatar whose
   *               presence snapshot hasn't loaded yet — better than a grey dot
   *               that flips green a moment later.
   *   false     → offline (muted)
   *   true      → online (green)
   */
  online?: boolean;
}

export function UserAvatar({
  name,
  image,
  className,
  maxInitials = 2,
  priority,
  online,
}: UserAvatarProps) {
  return (
    // Two spans, not one. The inner span owns `overflow-hidden` — that's what
    // crops a rectangular photo into a circle — so a dot positioned there would
    // be clipped away. The outer owns position and layout, which is also why
    // `className` still lands on it: every caller's `h-8 w-8` / `size-10` /
    // `mt-0.5` / `ring-2` keeps working untouched.
    <span
      className={cn(
        "relative inline-flex h-10 w-10 shrink-0 rounded-full",
        className,
      )}
    >
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-muted-foreground">
        <Image
          src={image}
          alt=""
          priority={priority}
          className="h-full w-full object-cover"
          fallback={initials(name, maxInitials)}
        />
      </span>
      {online !== undefined && (
        <span
          aria-hidden
          title={online ? "Online" : "Offline"}
          className={cn(
            "absolute -bottom-px -right-px block size-2.5 rounded-full ring-2 ring-background",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
      )}
    </span>
  );
}
```

`rounded-full` on the outer is load-bearing: `ConversationStart` passes `ring-2 ring-background`,
which now lands there and would render as a square ring without it.

Never pass `online` to the `size-4` avatars in `SeenBy` — the dot would be bigger than the avatar.

## 1.8 Add the dot at each site

The pattern everywhere is the same, and note the ternary — it's what makes the tri-state pay off:

```tsx
const { data: online } = usePresence(workspaceId);
// …
online={online ? online.has(someUserId) : undefined}
```

**(a) `MembersTable.tsx`** — start here, it's the easiest to eyeball. `workspaceId` is already a
prop (L20):

```tsx
const { data: online } = usePresence(workspaceId);
```

```tsx
<UserAvatar
  name={m.name || m.email}
  image={m.image}
  className="h-8 w-8"
  online={online ? online.has(m.userId) : undefined}
/>
```

Leave the pending-invite avatar (L122) alone — there's no user yet.

**(b) `MessageList.tsx` → `MessageRow.tsx`.** Keep the existing split: `MessageRow` is
presentational and `MessageList` resolves identity. So resolve presence in `MessageList` beside
`authorName`, and pass it down.

In `MessageList`, next to `useDirectory`:

```tsx
const { data: online } = usePresence(workspace.id);
```

and on the `<MessageRow>`:

```tsx
  authorOnline={
    // A departed author isn't a member, so they have no presence to show.
    m.authorActive === false || !online ? undefined : online.has(m.authorId)
  }
```

In `MessageRow`, add `authorOnline?: boolean` to `MessageRowProps`, destructure it, and pass it:

```tsx
<UserAvatar
  name={authorName}
  image={authorImage}
  className="mt-0.5 h-8 w-8"
  online={authorOnline}
/>
```

**(c) `ConversationStart.tsx` (`DmIntro`).** Only show a dot on a 1:1 — a 3-avatar `-space-x-2`
stack would have dots landing under the next avatar:

```tsx
const workspace = useCurrentWorkspace();
const { data: online } = usePresence(workspace.id);
const solo = people.length === 1;
```

```tsx
<UserAvatar
  key={p.userId}
  name={p.name}
  image={p.image}
  className="size-10 ring-2 ring-background"
  priority
  online={solo && online ? online.has(p.userId) : undefined}
/>
```

**(d) `DmList.tsx`** — this one needs an avatar first. Rows use a generic `<MessageSquare>` today.
`dm.participants` already carries `{userId, name, image}`, so inside the component:

```tsx
const { data: session } = useSession();
const { data: online } = usePresence(workspace.id);
```

and inside the `dms.map`, before the `<NavLink>`:

```tsx
// A 1:1 DM has exactly one other person → show their face and their status.
// A group has N, which don't collapse into one dot — keep the icon.
const others = dm.participants.filter((p) => p.userId !== session?.user.id);
const solo = others.length === 1 ? others[0] : null;
```

then replace the icon:

```tsx
{
  solo ? (
    <UserAvatar
      name={solo.name}
      image={solo.image}
      className="size-6"
      maxInitials={1}
      online={online ? online.has(solo.userId) : undefined}
    />
  ) : (
    <MessageSquare className="size-4 shrink-0" />
  );
}
```

`size-6` (24px) against the fixed `size-2.5` (10px) dot is about the tightest that still reads. If
it looks heavy, add `[&>span:last-child]:size-2` to the avatar's `className` rather than adding a
prop.

**(e) `NotificationBell.tsx`** — do this last, and consider skipping it. Two honest problems: the
bell is mounted in `workspace-rail.tsx:50`, which renders on the dashboard too, so there's **no
workspace context** to read; and each item can be from a different workspace, so presence isn't a
single lookup. Also the value is thin — whether someone who messaged you an hour ago happens to be
online right now isn't actionable in a history list.

If you want it anyway, the working shape is to move the query into the per-item `Avatar` component
(hooks per rendered component are fine, and React Query dedupes by key, so items from the same
workspace share one fetch — and the tray only renders when open):

```tsx
function Avatar({
  name,
  image,
  workspaceId,
  userId,
}: {
  name: string;
  image: string | null;
  workspaceId: string;
  userId: string;
}) {
  const { data: online } = usePresence(workspaceId);
  return (
    <UserAvatar
      name={name}
      image={image}
      maxInitials={1}
      className="size-7 text-xs"
      online={online ? online.has(userId) : undefined}
    />
  );
}
```

called as `<Avatar name={n.actorName} image={n.actorImage} workspaceId={n.workspaceId} userId={n.actorId} />`.

**Checkpoint.** Two browsers. B signs in → A's dots go green. B refreshes → **no flicker**. B closes
the tab → grey after ~8s.

---

# Part 2 — Typing

## 2.1 Protocol

**`protocol.ts`**, three edits.

Add to `ChannelEvent` — note it has no `updatedSeq`, exactly like `channel.read`:

```ts
export type ChannelEvent =
  | {
      kind: "message.created";
      channelId: string;
      updatedSeq: number;
      message: MessageWire;
    }
  | {
      kind: "message.updated";
      channelId: string;
      updatedSeq: number;
      message: MessageWire;
    }
  | {
      kind: "message.deleted";
      channelId: string;
      updatedSeq: number;
      message: MessageWire;
    }
  | {
      kind: "channel.read";
      channelId: string;
      userId: string;
      lastReadSeq: number;
    }
  | {
      kind: "typing";
      channelId: string;
      userId: string;
      state: "start" | "stop";
    };
```

**Register it as channel-scoped** — the step that's easiest to miss:

```ts
const CHANNEL_EVENT_KINDS = new Set<RealtimeEvent["kind"]>([
  "message.created",
  "message.updated",
  "message.deleted",
  "channel.read",
  "typing",
]);
```

And the client frame:

```ts
/**
 * Frames a client sends to the WORKSPACE server.
 *
 * Writes go over REST, never here — REST owns durability and the gapless
 * sequence. `typing` is not an exception to that rule because it isn't a write:
 * nothing is persisted, no sequence is consumed, no notification fires. It's
 * here rather than on a REST endpoint because the socket already knows who you
 * are and which channels you're authorized for, so a tick costs zero queries;
 * over REST it would cost three (session lookup, workspace load, membership
 * check) on every keystroke tick.
 */
export type ClientFrame =
  | { t: "subscribe"; channelIds: string[] }
  | { t: "unsubscribe"; channelIds: string[] }
  | { t: "typing"; channelId: string; state: "start" | "stop" }
  | { t: "ping" };
```

## 2.2 Server: accept and rebroadcast

**`server.ts`** — a rate limiter beside the other module constants:

```ts
/**
 * Typing frames are the only thing a client pushes that isn't a subscription,
 * and every accepted one becomes a `pg_notify` round-trip. A well-behaved client
 * sends one per 3s; this is abuse protection, not fairness, so a fixed window is
 * plenty. Keyed by socket in a WeakMap so it cleans itself up on disconnect.
 */
const TYPING_WINDOW_MS = 5_000;
const TYPING_MAX_PER_WINDOW = 6;
const typingQuota = new WeakMap<
  WebSocket,
  { windowStart: number; count: number }
>();

function allowTyping(ws: WebSocket): boolean {
  const now = Date.now();
  const q = typingQuota.get(ws);
  if (!q || now - q.windowStart > TYPING_WINDOW_MS) {
    typingQuota.set(ws, { windowStart: now, count: 1 });
    return true;
  }
  if (q.count >= TYPING_MAX_PER_WINDOW) return false;
  q.count += 1;
  return true;
}
```

Then a case in `onMessage`'s switch, beside `subscribe`:

```ts
    case "typing": {
      // Authorization is already settled: `ctx.channels` only ever contains
      // channels this socket passed `assertChannelAccess` for at subscribe time
      // (see the `subscribe` case below). So this is a Set.has() — re-running
      // the DB check here would put a query on every keystroke tick.
      const ctx = hub.contextFor(ws);
      if (!ctx || !ctx.channels.has(frame.channelId)) return;
      if (!allowTyping(ws)) return;
      await hub.publish(ctx.workspaceId, {
        kind: "typing",
        channelId: frame.channelId,
        userId: ctx.userId,
        state: frame.state,
      });
      return;
    }
```

Because `typing` is in `CHANNEL_EVENT_KINDS`, `deliverLocal` routes it to
`channelSubs.get(channelId)` — exactly the people with that conversation open. Nobody else's browser
ever sees the frame.

## 2.3 Client transport

**`echo-front/src/lib/realtime.ts`** — `sendFrame` is private; add a narrow public method rather
than widening it. Put it next to `unsubscribe`:

```ts
  /**
   * Ephemeral typing signal — the only non-subscription frame we send (see the
   * note on `ClientFrame`). `sendFrame` no-ops when the socket isn't OPEN, which
   * is exactly right here: a tick during a reconnect is simply dropped, and the
   * receiver's TTL cleans up after it.
   */
  typing(channelId: string, state: "start" | "stop"): void {
    this.sendFrame({ t: "typing", channelId, state });
  }
```

## 2.4 The typing hooks

**New file: `echo-front/src/features/channels/realtime/use-typing.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@server/infrastructure/realtime/protocol";
import { useSession } from "@/lib/auth-client";
import { useRealtime } from "./realtime-context";

/** Don't re-announce "still typing" more often than this. */
const THROTTLE_MS = 3_000;
/** Drop a typist we haven't heard from in this long, even without a "stop". */
const TTL_MS = 5_000;
/** How often to sweep expired typists out of state. */
const SWEEP_MS = 1_000;

/**
 * Outbound half: turns keystrokes into at most one frame per THROTTLE_MS.
 *
 * The throttle lives here rather than at the call site, so the composer can call
 * `onInput()` on every change without thinking about it.
 */
export function useTypingEmitter(channelId: string) {
  const { client } = useRealtime();
  const lastSentAt = useRef(0);

  const stop = useCallback(() => {
    lastSentAt.current = 0; // next keystroke opens a fresh throttle window
    client.typing(channelId, "stop");
  }, [client, channelId]);

  const onInput = useCallback(() => {
    const now = Date.now();
    if (now - lastSentAt.current < THROTTLE_MS) return;
    lastSentAt.current = now;
    client.typing(channelId, "start");
  }, [client, channelId]);

  // Leaving the conversation (or unmounting) has to clear the indicator for
  // everyone else — otherwise it hangs there until their TTL expires.
  useEffect(() => stop, [stop]);

  return { onInput, stop };
}

/**
 * Inbound half: who is currently typing in this channel, excluding me.
 *
 * React state, not React Query — this is sub-second ephemeral UI with no server
 * representation to cache or invalidate.
 *
 * TWO independent clears, because NOTIFY is at-most-once and a "stop" may never
 * arrive (dropped frame, closed laptop, crashed tab):
 *   - an explicit "stop" removes the typist immediately;
 *   - a TTL sweep removes anyone unheard-from for TTL_MS.
 * THROTTLE_MS (3s) is deliberately shorter than TTL_MS (5s), so someone typing
 * continuously always refreshes before they expire.
 */
export function useTypingParticipants(channelId: string): string[] {
  const { client } = useRealtime();
  const { data: session } = useSession();
  const myUserId = session?.user.id;

  // userId → timestamp of the last "start" we saw.
  const [typists, setTypists] = useState<Record<string, number>>({});

  useEffect(() => {
    setTypists({}); // channel changed → nothing carries over

    const offEvent = client.onEvent((event: RealtimeEvent) => {
      if (event.kind !== "typing") return;
      if (event.channelId !== channelId) return;
      if (event.userId === myUserId) return; // never show yourself

      setTypists((prev) => {
        if (event.state === "stop") {
          if (!(event.userId in prev)) return prev;
          const next = { ...prev };
          delete next[event.userId];
          return next;
        }
        return { ...prev, [event.userId]: Date.now() };
      });
    });

    const sweep = setInterval(() => {
      const cutoff = Date.now() - TTL_MS;
      setTypists((prev) => {
        const kept = Object.entries(prev).filter(([, at]) => at > cutoff);
        // Same reference when nothing expired → no re-render.
        return kept.length === Object.keys(prev).length
          ? prev
          : Object.fromEntries(kept);
      });
    }, SWEEP_MS);

    return () => {
      offEvent();
      clearInterval(sweep);
    };
  }, [client, channelId, myUserId]);

  return Object.keys(typists);
}
```

Note it registers its **own** `client.onEvent`. `onEvent` adds to a listener `Set`
([realtime.ts:137-140](echo-front/src/lib/realtime.ts#L137-L140)), so this coexists with
`useChannelStream` — no prop drilling, no coupling.

## 2.5 ⚠️ Guard `useChannelStream` — same commit as 2.4

**`echo-front/src/features/channels/realtime/use-channel-stream.ts`**, inside `handleEvent`, right
after the `isChannelEvent` guard and before the `channel.read` block:

```ts
      if (!isChannelEvent(event) || event.channelId !== channelId) return;

      if (event.kind === "typing") {
        // Ephemeral, and it carries no `updatedSeq` — it must never reach the
        // clock logic below, where `undefined` slips past BOTH comparisons and
        // hands `mergeMessage` an undefined message. Owned by
        // `useTypingParticipants`; nothing to reconcile here.
        return;
      }

      if (event.kind === "channel.read") {
```

If you skip this, the timeline throws the first time anyone types. Land it together with 2.4.

## 2.6 The indicator

**New file: `echo-front/src/features/channels/components/TypingIndicator.tsx`**

```tsx
import { useCurrentWorkspace } from "@/features/workspaces/hooks/use-current-workspace";
import { useDirectory } from "@/features/members/api/use-directory";
import { useTypingParticipants } from "../realtime/use-typing";

/**
 * "Alice is typing…" between the timeline and the composer.
 *
 * The row keeps its height whether or not anyone is typing. An element that
 * appears and disappears here would shove the timeline up and down on every
 * pause in typing, which reads as jitter.
 */
export function TypingIndicator({ channelId }: { channelId: string }) {
  const workspace = useCurrentWorkspace();
  const { data: directory } = useDirectory(workspace.id);
  const typing = useTypingParticipants(channelId);

  const names = typing
    .map((id) => directory?.[id]?.name)
    .filter((n): n is string => Boolean(n));

  let text = "";
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = "Several people are typing…";

  return (
    <div
      className="h-5 px-6 text-xs italic text-muted-foreground"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
```

**`ChannelView.tsx`**, in `ChannelMessages`' return (L141-146):

```tsx
return (
  <>
    <MessageList channel={channel} messages={messages} />
    <TypingIndicator channelId={channel.id} />
    <MessageComposer channelId={channel.id} />
  </>
);
```

## 2.7 Wire the composer

**`MessageComposer.tsx`** — three touches.

Near the other hooks (after `uploads`):

```tsx
const typing = useTypingEmitter(channelId);
```

In `submit()`, beside the existing clears (L62-64):

```tsx
setBody("");
uploads.clear();
typing.stop(); // clear everyone else's indicator immediately
if (textRef.current) textRef.current.style.height = "auto";
```

On the textarea's `onChange` (L124-127):

```tsx
          onChange={(e) => {
            setBody(e.target.value);
            autoGrow();
            // Clearing the box is a stop signal — otherwise deleting your draft
            // leaves you "typing" for the rest of the TTL.
            if (e.target.value.trim()) typing.onInput();
            else typing.stop();
          }}
```

Because a DM _is_ a channel, this covers channels and private DMs with no extra work.

---

# Build order

1. **1.1 → 1.4**, then log `announce` and verify with two browsers: one line per real transition,
   none on refresh. Don't touch the frontend until this is clean.
2. **1.5**, verify `GET /api/workspaces/<id>/presence` in the browser.
3. **1.6**, confirm the cache patches live (React Query devtools, or log in the `case`).
4. **1.7 → 1.8**, `MembersTable` first, `DmList` last, `NotificationBell` optional.
5. **2.1 → 2.2**, log the rebroadcast and confirm the rate limiter rejects a flood.
6. **2.3 → 2.5 together** — the guard is what stops the emitter from crashing the timeline.
7. **2.6 → 2.7.**

# Verification

**Automated**

- `echo-server/test/integration/` — spy on `hub.publishToWorkspaces` the way
  [dm.test.ts:44-61](echo-server/test/integration/dm.test.ts#L44-L61) spies on `publishToUsers`:
  connect announces `online:true` to the user's workspaces only; disconnect-then-reconnect inside
  the grace window announces nothing. `vi.useFakeTimers()` for the grace window.
- Frontend — `use-typing.test.ts` for TTL expiry and self-filtering (pure timer logic, fake timers),
  and a `UserAvatar` test asserting no dot when `online` is `undefined`.
  `features/notifications/realtime/notifications-provider.test.tsx` is a working template for
  stubbing a realtime client and pushing events through it.
- `bun run --filter echo-server test`, `bun run --filter echo-front test`, plus `typecheck` on both.

**Manual** — two browsers, two accounts, same workspace:

1. B signs in → A's dots go green in the timeline, members table, DM list and DM header.
2. B refreshes → **no flicker** (the 8s grace).
3. B closes the tab → grey within ~8s.
4. B types in a shared channel → A sees "B is typing…" within ~1s; it clears the instant B sends,
   and clears on its own if B closes the tab mid-sentence (the 5s TTL).
5. Same in a 1:1 DM, no extra code.
6. Regression: send a normal message and confirm the timeline still reconciles — i.e. 2.5's guard is
   in and typing frames never touch `lastClock`.
