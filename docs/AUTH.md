# How auth works in Echo

A walkthrough. Read it top to bottom once, and you'll know the whole flow.

Verified 2026-07-30 against commit `42d6ed2`.

---

## The short version

Echo uses a library called **Better Auth** for all of authentication. We did not write any
password hashing, any token signing, or any session logic. That matters more than it sounds:
it means the answer to most "how does auth handle X?" questions is "whatever Better Auth
does", and the only file that changes its behaviour is
[auth.ts](../echo-server/src/infrastructure/auth/auth.ts).

There is exactly one credential in the whole system: **a cookie**. No JWT, no access token,
no refresh token, nothing in `localStorage`. If you understand where that cookie comes from
and who checks it, you understand Echo's auth.

The rest of this document follows that cookie.

---

## 1. Someone signs in

The user fills in the login form. The form does not talk to the server directly. It calls
the Better Auth client:

```ts
authClient.signIn.email({ email, password })
```

That sends a `POST` to `/api/auth/sign-in/email`. On the server, Better Auth:

1. Checks the request isn't over the rate limit (5 sign-ins per minute).
2. Looks up the user's password hash and verifies the password.
3. Writes a new row into the `sessions` table, with a random token and an expiry date.
4. Sends the token back as a cookie.

That's the whole thing. The cookie now proves who the user is.

### What's in the cookie

The value looks like `<random token>.<signature>`. The random half is just a lookup key for
that `sessions` row. It carries no information about the user, which is worth knowing: you
cannot read anything out of the cookie, and neither can an attacker. The second half is a
signature made with `BETTER_AUTH_SECRET`, so a tampered cookie is rejected before we even
hit the database.

The cookie is set with these flags:

- `httpOnly` so JavaScript can't read it, which is what protects it from XSS.
- `secure` in production, so it only travels over HTTPS.
- `sameSite=lax`, which blocks other websites from making requests with it, while still
  allowing the OAuth redirect to come back.

It lasts 7 days by default. If the user is active, Better Auth quietly pushes the expiry
date forward, at most once a day. There is no refresh token and the cookie is never rotated.

### Two branches worth knowing about

**If the user has two-factor enabled**, step 3 doesn't happen. Instead the server responds
with `{ twoFactorRedirect: true }` and no cookie. The form notices this and switches to a
code input rather than navigating away. A second request to `/two-factor/verify-totp` is
what actually creates the session.

**If the user signs in with Google or GitHub**, the ending is identical: a `sessions` row and
a cookie. The only interesting case is when their social email matches an existing local
account whose email was never verified. Better Auth refuses to link them and returns
`account_not_linked`. That's deliberate, and worth understanding, because it looks like a bug
when you hit it:

> Imagine an attacker signs up as `victim@example.com` with a password they chose. Later the
> real owner signs in with Google. If we auto-linked those, the victim would be logging into
> the attacker's account. So we don't. The user signs in with their password first, which
> proves they own the account, then links Google from Account settings.

The login page detects this and shows exactly that instruction.

---

## 2. Every request after that

The browser now has a cookie. Every call to our own API sends it, because our fetch wrapper
sets `credentials: 'include'`.

On the server, three checks happen in order. They answer three different questions:

```
Request with cookie
      │
      ▼
  authenticate            "Who are you?"
      │                   Looks up the session in the database.
      │                   No valid session → 401
      ▼
  loadWorkspace           "Are you allowed in this workspace?"
      │                   Looks for a membership row.
      │                   Not a member → 403
      ▼
  requireWorkspaceRole    "Are you allowed to do THIS here?"
                          Checks the member's role (admin / member).
                          Wrong role → 403
```

Only the first one is authentication. The other two are authorization, and they use a
completely separate table (`memberships`). Keeping them separate is why user-scoped routes
like notifications and preferences can sit behind `authenticate` alone, without pretending
to belong to a workspace.

The relevant files are [authenticate.ts](../echo-server/src/shared/middleware/authenticate.ts),
[load-workspace.ts](../echo-server/src/shared/middleware/load-workspace.ts), and
[require-workspace-role.ts](../echo-server/src/shared/middleware/require-workspace-role.ts).
Which routes get which check is decided in one place, [app.ts](../echo-server/src/app.ts).

### One decision to understand here

Better Auth can cache the session in a second signed cookie, so that checking it doesn't
need a database query. **We turned that off**, and the code passes
`disableCookieCache: true` on every check.

The reason is worth remembering, because it explains a lot of the rest of this document.
With the cache on, revoking a session took effect immediately on the server but not on the
client. So the frontend still believed it was logged in while the API returned 401. The two
disagreed, each tried to correct the other, and the user bounced back and forth between
`/login` and the app.

With the cache off, every single check reads the database. Revoking a session takes effect on
the next request, everywhere, with no exceptions. That costs a query per request and it's
worth it.

---

## 3. How the frontend knows who's logged in

This surprised me, so it's worth stating plainly: **there is no session store on the
frontend.** No React context, no zustand, no redux. Better Auth's client keeps the session in
its own small store, and components read it with a hook:

```ts
const { data: session, isPending } = useSession();
```

The first component to call it triggers a fetch to `/api/auth/get-session`. After that
everyone shares the result.

Two things about this hook will bite you if you don't know them.

**First: `isPending` goes true on *every* refetch, not just the first load.** So the obvious
code is wrong:

```ts
if (isPending) return <Spinner />;   // ✗ unmounts the page on every background refetch
```

Every guard in the app works around it the same way, by remembering whether the session has
ever resolved:

```ts
const everResolved = useRef(false);
if (!isPending) everResolved.current = true;
if (isPending && !everResolved.current) return <LoadingScreen />;
```

Without this, signing in unmounts the login form mid-flow, which wipes the "waiting for your
2FA code" state and dumps the user back on an empty form.

**Second: `authClient.getSession()` does not update the hook.** It fetches, but it doesn't
write back into the store that `useSession` reads. If you want the UI to notice a session
change, you have to call `refetch()`. This is called out in three separate comments in the
codebase, which tells you how often it's been got wrong.

Two things trigger a refetch: the tab regaining focus, and any 401. Both are wired up once,
in [root-layout.tsx](../echo-front/src/components/layout/root-layout.tsx).

### How a 401 becomes an app-wide event

Our fetch wrapper doesn't know about the router, and shouldn't. So when it sees a 401 it just
shouts into the void:

```ts
// lib/api.ts
if (response.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
```

One listener, mounted at the root, picks that up and handles the redirect. What it does is
covered in section 5, because the details are the interesting part.

---

## 4. Keeping people out of pages

We use react-router in data mode, which means there's no `middleware.ts` and no route
loaders doing auth. Protection is just components wrapping other components, all set up in
[router.tsx](../echo-front/src/router.tsx).

```
RootLayout                       ← the two session hooks live here
├── /login  /register  /forgot-password
│      wrapped in RedirectIfAuthed     "already signed in? go to the app"
│
├── /reset-password               ← deliberately NOT guarded (see below)
├── /accept-invite/:token         ← public, handles logged-in and logged-out
│
└── RequireAuth                   "not signed in? go to /login"
    │   guards everything below it in one place
    ├── /
    ├── /workspaces/create
    └── /dashboard/:workspaceId
        ├── channels, members, settings…
        └── RequireAdmin          "not an admin? go home"
```

`/reset-password` is intentionally left open. Someone might be signed in on their laptop
while resetting their password on their phone, and blocking the recovery flow because of that
would be worse than useless.

Notice that `RequireAuth` and `RedirectIfAuthed` point at each other. That's fine when the
session is known, but it's the ingredient that made the bug in section 6 possible.

---

## 5. Logging out

There are five ways a session ends:

| How | What happens on the server |
|---|---|
| The user clicks Sign out | The `sessions` row is deleted and the cookie cleared |
| Their session expired or was revoked mid-use | Nothing — it's already gone |
| They revoke a device from Account → Sessions | That row is deleted |
| An admin bans or impersonates them | Handled by the admin plugin |
| The expiry date simply passes | The lookup starts returning nothing |

Because we don't cache sessions (section 2), **all five behave identically from the client's
point of view**: the next request fails, and the user gets sent to `/login`. That uniformity
is the payoff for the cookie-cache decision.

### When the user clicks Sign out

```ts
signOut(undefined, {
  onSuccess: () => {
    clearLastWorkspaceId();
    clearCachedPreferences();
    toast.success("Signed out");
    navigate(paths.login);
  },
});
```

Five things get cleared, and they're in four different places:

1. The session row and the cookie, on the server.
2. Better Auth's session store, by the library.
3. The React Query cache, in [use-sign-out.ts](../echo-front/src/features/auth/api/use-sign-out.ts).
4. `echo.last_workspace_id` in localStorage, or the next person on this browser gets
   redirected into a stranger's workspace.
5. `echo.appearance` in localStorage, or they inherit the previous user's theme.

And there's a sixth thing that nothing in that code touches: **the two WebSockets.**

They close by unmounting. `navigate(paths.login)` makes `RequireAuth` fail, which unmounts
the notifications provider, whose cleanup function closes the user socket. Same story for the
workspace socket one level down. It works, and it's clean, but it's invisible at the call
site — if either provider ever moves outside the guard, sockets will quietly outlive
sign-out.

### When the session dies on its own

```
a request 401s
   └─ "auth:unauthorized" event
        └─ if another 401 is already being handled, stop here
           1. refetch the session, so the guards agree it's gone
           2. redirect to /login
           3. clear the React Query cache
```

That order is not arbitrary. Section 6 is about why.

---

## 6. The logout loop, and why the code looks the way it does

This is the one piece of history worth knowing, because if you tidy up the code in section 5
without knowing it, you'll put the bug back.

**The symptom:** in production, signing out made the app flip back and forth between
`/login` and the dashboard, sometimes until the browser complained about too many history
entries. It never happened on anyone's laptop.

It never happened locally because of latency. On localhost the session check came back fast
enough that the cycle resolved before it could repeat.

There were actually two loops running at once.

**Loop one: clearing the cache restarted the requests that had just failed.**

Clearing a React Query cache doesn't just empty it. Any component still on screen that was
displaying that data now has no data, so it immediately refetches. And the component that
owns the Sign out button is, of course, still on screen at the moment you click it.

So: sign out succeeded, the cookie was gone, the cache was cleared, the sidebar's queries
refetched against a dead cookie, they 401'd, the 401 handler's first action was to clear the
cache, and around we went.

**Loop two: a slow session check brought the session back to life.**

Several queries 401'd at the same moment, so the handler ran several times concurrently, each
one checking the session. One of those checks had been sent *before* the cookie was deleted,
but its answer arrived *after*. It said "yes, this user is logged in", and wrote that into
the session store. `RedirectIfAuthed` saw a logged-in user sitting on `/login` and helpfully
sent them back into the app. Which had no cookie. Which 401'd.

**Three changes fixed it**, and each one kills a specific part of the cycle:

| Change | Why |
|---|---|
| Clear the cache in `onSettled` instead of `onSuccess` | React Query runs the hook's `onSuccess` *before* the caller's, so the cache was being cleared while the sidebar was still mounted and before `navigate()` had run. `onSettled` runs after the caller, once the redirect is already underway. |
| Reorder the 401 handler to refetch → redirect → **clear last** | Clearing last means the components that would refetch are already unmounting. |
| Add a `running` flag so overlapping 401s collapse into one pass | Only one session check is ever in flight, so a stale answer can't overwrite a fresh one. |
| Never retry a 401 or 403 | `retry: 1` was doubling every failed request, and therefore every event. An auth failure isn't a temporary blip; retrying can't fix it. |

All of this is pinned down by
[use-unauthorized-redirect.test.tsx](../echo-front/src/hooks/use-unauthorized-redirect.test.tsx),
which fires four 401s and asserts the handler redirects once, checks the session once, and
clears the cache *after* redirecting. The mock deliberately answers slowly, so the test fails
if someone removes the `running` flag.

**So if you touch this code:** don't clear a cache while signed-in components are still
mounted, and don't allow two session checks at once.

---

## 7. WebSockets

Sockets need their own explanation for one reason: **CORS does not apply to WebSockets.** Any
website can open a socket to our server and the browser will attach the user's cookie. So we
check the origin ourselves.

Three checks, in [realtime/server.ts](../echo-server/src/infrastructure/realtime/server.ts):

1. Is the `Origin` header in our allowed list?
2. Is there a valid session? (Same database lookup as the REST API.)
3. Is this user a member of the workspace they asked for?

There's one oddity in how this is implemented. **The checks run after the connection is
accepted, not before.** Bun's WebSocket layer requires the upgrade to complete synchronously,
so we can't `await` a database query first. Instead the server accepts every socket, buffers
whatever it sends (up to 32 frames), runs the checks, and then either registers it or closes
it with an error code.

The buffering isn't optional: the client sends its channel subscriptions the instant the
socket opens, which is now before we know who it is. Dropping those would silently lose the
subscriptions until the next reconnect.

When the server rejects a socket, it closes with a code in the 4400s:

| Code | Meaning |
|---|---|
| 4400 | Malformed request, or too many frames before auth |
| 4401 | No valid session |
| 4403 | Untrusted origin, or not a member of that workspace |
| 1011 | Something threw. Deliberately *not* in the 44xx range |

That distinction matters on the client. A 44xx means "the server has decided about you", so
the client stops trying — retrying could only produce the same answer. A 1011 means "we
don't know", so the client keeps its reconnect backoff. This is also why the sockets never
contributed to the logout loop: a dead session shuts them down permanently instead of
hammering the server.

Two more things keep the socket boundary narrow. Subscribing to a channel is re-checked
against channel membership, and channels the user can't see are silently skipped. And
**nothing is ever written over the socket** — every change goes through the authenticated
REST API. The socket only delivers.

---

## 8. Where everything lives

**Server**

| What | Where |
|---|---|
| All auth configuration | [infrastructure/auth/auth.ts](../echo-server/src/infrastructure/auth/auth.ts) |
| The auth route (one line) | [modules/auth/auth.routes.ts](../echo-server/src/modules/auth/auth.routes.ts) |
| Which routes are protected | [app.ts](../echo-server/src/app.ts) |
| The three middleware checks | [shared/middleware/](../echo-server/src/shared/middleware/) |
| WebSocket authorization | [infrastructure/realtime/server.ts](../echo-server/src/infrastructure/realtime/server.ts) |
| Tables | [database/control/schema.ts](../echo-server/src/infrastructure/database/control/schema.ts) |
| Env vars | [config/env.ts](../echo-server/src/config/env.ts) |

**Frontend**

| What | Where |
|---|---|
| The Better Auth client | [lib/auth-client.ts](../echo-front/src/lib/auth-client.ts) |
| Fetch wrapper, where 401s are caught | [lib/api.ts](../echo-front/src/lib/api.ts) |
| The 401 handler | [hooks/use-unauthorized-redirect.ts](../echo-front/src/hooks/use-unauthorized-redirect.ts) |
| Guards | [features/auth/guards/](../echo-front/src/features/auth/guards/) |
| Route tree | [router.tsx](../echo-front/src/router.tsx) |

**Tables**, all in the shared `public` schema — identity is never per-workspace:

`users`, `sessions`, `accounts` (one row per login method; holds the password hash, which is
null for OAuth users), `verifications` (short-lived email tokens), `two_factors`,
`auth_events` (an audit log), and `memberships` (authorization, not authentication).

**Env vars worth knowing.** They're validated when the process starts, so a bad one crashes
at boot rather than failing mysteriously later.

- `BETTER_AUTH_SECRET` signs the cookie.
- `BETTER_AUTH_URL` also decides whether the cookie is marked `secure`.
- `CORS_ORIGINS` feeds three different things: CORS, Better Auth's trusted origins, and the
  WebSocket origin check.
- `TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY` must both be set or both be unset. Setting
  only the secret makes the server demand a CAPTCHA token the frontend can't produce, which
  breaks email login entirely.
- `RESEND_API_KEY` + `EMAIL_FROM` decide how the three auth emails (password reset, email
  verification, change-email confirmation) actually leave the process. Precedence is Resend,
  then `SMTP_HOST`, then log-only —
  [email-service.ts](../echo-server/src/infrastructure/email/email-service.ts). With neither
  configured, the flows still *work* in development: the token URL is written to the server
  log for you to copy. In production that same fallback means password reset silently does
  nothing, so set one.

---

## Findings from the audit

Seven things worth knowing, none of them fixed. Reported 2026-07-30.

**1. `BETTER_AUTH_SECRET` only requires 8 characters, but says it requires 32.**
[env.ts](../echo-server/src/config/env.ts) has
`z.string().min(8, "BETTER_AUTH_SECRET must be at least 32 characters")`. The rule and its own
error message disagree, and that secret signs every session cookie. Production is fine today
only because `render.yaml` generates the value automatically — any self-host or copied `.env`
can ship a weak key with no warning. The fix is one character, but note that `min(32)` will
reject existing short dev secrets, so local `.env` files need updating too.

**2. Rate limiting is configured but mostly not in effect.** The limits look careful (5
sign-ins a minute, 3 sign-ups an hour). But Better Auth only enables rate limiting in
production, so it's off in development *and in tests*, meaning nothing verifies it works. And
it stores counters in memory per process, so running two instances doubles every limit. Also,
none of our own routes are rate limited at all — only `/api/auth/*`. This is the finding I'd
act on first.

**3. We trust GitHub for account linking without having written down why.** The config trusts
Google and GitHub, and the comment above it carefully explains why Google's verified-email
claim is trustworthy. It says nothing about GitHub, which can return unverified emails.
Another guard mitigates the actual attack, so this is a documentation gap rather than a hole —
but an undocumented reason is a reason that gets lost.

**4. Attachment URLs never expire.** `GET /api/files?key=…` is deliberately unauthenticated,
because `<img>` tags can't send a cross-origin cookie, and the unguessable object key acts as
the credential. The sharp edge is duration: a fresh signature is minted per request, so a key
that leaks through a log, a referrer header, or a copied URL grants access forever, with no
way to revoke it short of moving the file.

**5. Nothing limits how fast someone can open WebSockets.** Each socket is bounded (32-frame
buffer, 30-second heartbeat), but a peer can open and abandon sockets in a loop, and each one
costs a database session lookup.

**6. There's a dead duplicate of `useRevokeOtherSessions`.** Two files define it. The one in
`use-sessions.ts` is used. The one in `use-revoke-other-sessions.ts` is unused *and* is
missing the cache invalidation — so the dead copy is the subtly broken one, which is the
dangerous way round. Importing it by mistake would leave a stale session list on screen.
Delete the file.

**7. Sign out pushes a history entry; the 401 path replaces one.** The buttons call
`navigate(paths.login)` while the 401 handler uses `{ replace: true }`. So after signing out
manually, pressing Back returns to an app URL and gets bounced again. Harmless, but it's the
last inconsistency left in a flow whose entire bug was about history.
