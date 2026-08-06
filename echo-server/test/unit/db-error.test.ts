import { describe, expect, it } from "vitest";
import { isUniqueViolation, translateDbError } from "../../src/shared/errors/db-error.js";
import { createWorkspaceBody } from "../../src/modules/workspaces/workspaces.dto.js";

/**
 * Both halves of the wiring that `errorHandler` and `createWorkspaceBody` now
 * depend on. Before this, a constraint violation reached clients as a bare 500.
 */

/** A driver error as `pg` shapes it. */
const pgError = (code: string, extra: Record<string, string> = {}) => ({
  code,
  constraint: "workspaces_slug_unique",
  detail: "Key (slug)=(admin) already exists.",
  ...extra,
});

/** How the same error actually arrives from a drizzle query: `code` is on `.cause`. */
const wrapped = (code: string) =>
  Object.assign(new Error("Failed query: insert into \"workspaces\" …"), {
    cause: pgError(code),
  });

describe("translateDbError", () => {
  it("maps a unique violation to 409", () => {
    const e = translateDbError(pgError("23505"));
    expect(e?.statusCode).toBe(409);
    expect(e?.code).toBe("db_unique_violation");
  });

  it("never leaks the constraint name or the offending row values", () => {
    // The whole reason the messages are generic: `detail` echoes user data and
    // `constraint` names an internal schema object.
    for (const code of ["23505", "23503", "23514", "23502"]) {
      const message = translateDbError(pgError(code))?.message ?? "";
      expect(message).not.toContain("workspaces_slug_unique");
      expect(message).not.toContain("Key (slug)");
      expect(message).not.toContain("admin");
    }
  });

  it("maps foreign-key, check and not-null violations to 400", () => {
    for (const code of ["23503", "23514", "23502"]) {
      expect(translateDbError(pgError(code))?.statusCode).toBe(400);
    }
  });

  it("maps every connection-class SQLSTATE to 503 so proxies retry", () => {
    for (const code of ["08000", "08003", "08006", "57P03"]) {
      const e = translateDbError(pgError(code));
      expect(e?.statusCode).toBe(503);
      expect(e?.code).toBe("db_connection_error");
    }
  });

  it("looks through the drizzle wrapper for the SQLSTATE", () => {
    const e = translateDbError(wrapped("23505"));
    expect(e?.statusCode).toBe(409);
    expect(e?.code).toBe("db_unique_violation");
  });

  it("returns null for anything it doesn't recognise, so the caller falls through", () => {
    expect(translateDbError(pgError("42P01"))).toBeNull();
    expect(translateDbError(new Error("not a pg error"))).toBeNull();
    expect(translateDbError(undefined)).toBeNull();
  });
});

describe("isUniqueViolation", () => {
  it("is true only for 23505, wrapped or bare", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
    expect(isUniqueViolation(wrapped("23505"))).toBe(true);
    expect(isUniqueViolation(pgError("23503"))).toBe(false);
    expect(isUniqueViolation(wrapped("23503"))).toBe(false);
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
  });
});

describe("createWorkspaceBody reserved slugs", () => {
  it("rejects a slug that would shadow a system route", () => {
    for (const slug of ["admin", "api", "settings", "workspaces", "ADMIN"]) {
      expect(createWorkspaceBody.safeParse({ slug }).success).toBe(false);
    }
  });

  it("still accepts an ordinary slug", () => {
    expect(createWorkspaceBody.safeParse({ slug: "acme-corp" }).success).toBe(true);
  });
});
