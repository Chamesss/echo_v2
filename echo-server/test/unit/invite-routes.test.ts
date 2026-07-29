import { describe, expect, it } from "vitest";
import { acceptInvitesRouter } from "../../src/modules/members/accept-invites.routes.js";

/**
 * Guards the security-relevant auth split on the invite routes: viewing an invite
 * must stay PUBLIC (so an unregistered invitee can see it and sign up), while
 * accepting must stay AUTHENTICATED. We assert the per-route handler stacks so a
 * future edit can't silently re-add auth to GET or drop it from POST.
 */
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: unknown[]; // one entry per handler on the route
  };
}

const layers = (acceptInvitesRouter as unknown as { stack: RouteLayer[] }).stack.filter(
  (l) => l.route,
);
const get = layers.find((l) => l.route!.path === "/:token" && l.route!.methods.get);
const post = layers.find((l) => l.route!.path === "/:token/accept" && l.route!.methods.post);

describe("invite route auth split", () => {
  it("GET /:token is public (controller only, no authenticate middleware)", () => {
    expect(get).toBeTruthy();
    expect(get!.route!.stack).toHaveLength(1);
  });

  it("POST /:token/accept is authenticated (authenticate + controller)", () => {
    expect(post).toBeTruthy();
    expect(post!.route!.stack).toHaveLength(2);
  });
});
