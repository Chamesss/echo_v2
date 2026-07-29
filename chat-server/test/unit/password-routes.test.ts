import { describe, expect, it } from "vitest";
import { usersRouter } from "../../src/modules/users/users.routes.js";
import { setPasswordBody } from "../../src/modules/users/users.dto.js";

/**
 * `POST /api/users/me/password` sets a FIRST password for social-only accounts,
 * so it is the one password path with no current-password check. That makes two
 * things load-bearing: it must stay authenticated, and its length bounds must
 * keep matching `emailAndPassword` in `infrastructure/auth/auth.ts` (Better Auth
 * rejects out-of-range values itself, and we'd rather fail in the DTO than
 * surface its error text to the user).
 */
interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
}

const layers = (usersRouter as unknown as { stack: RouteLayer[] }).stack.filter((l) => l.route);
const setPassword = layers.find((l) => l.route!.path === "/me/password" && l.route!.methods.post);

describe("set-password route", () => {
  it("is mounted with validate + controller (auth comes from the router mount)", () => {
    expect(setPassword).toBeTruthy();
    expect(setPassword!.route!.stack).toHaveLength(2);
  });
});

describe("set-password body", () => {
  it("accepts a password within the configured bounds", () => {
    expect(setPasswordBody.safeParse({ newPassword: "a".repeat(8) }).success).toBe(true);
    expect(setPasswordBody.safeParse({ newPassword: "a".repeat(128) }).success).toBe(true);
  });

  it("rejects passwords outside them", () => {
    expect(setPasswordBody.safeParse({ newPassword: "a".repeat(7) }).success).toBe(false);
    expect(setPasswordBody.safeParse({ newPassword: "a".repeat(129) }).success).toBe(false);
  });

  it("has no currentPassword field to satisfy", () => {
    // The whole point: a social-only user has no current password to give.
    expect(setPasswordBody.safeParse({ newPassword: "abcd1234" }).success).toBe(true);
  });
});
