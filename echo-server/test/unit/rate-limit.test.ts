import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { rateLimit, CREATE_LIMIT, SEND_MESSAGE_LIMIT } from "../../src/shared/middleware/rate-limit.js";
import { AppError } from "../../src/shared/errors/app-error.js";

// Tiny windows on purpose: the shipped limits are unreachable by hand, so
// asserting on them directly would mean firing 300 requests.
function call(
  middleware: ReturnType<typeof rateLimit>,
  userId: string,
): { error: unknown; retryAfter: string | undefined } {
  const headers = new Map<string, string>();
  const req = { user: { id: userId }, ip: "10.0.0.1" } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => headers.set(k, v),
  } as unknown as Response;

  let error: unknown;
  middleware(req, res, (e?: unknown) => {
    error = e;
  });
  return { error, retryAfter: headers.get("Retry-After") };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("rateLimit", () => {
  it("allows up to the limit, then rejects with 429 and a Retry-After", () => {
    const mw = rateLimit({ limit: 3, windowMs: 10_000 });

    for (let i = 0; i < 3; i++) {
      expect(call(mw, "u1").error).toBeUndefined();
    }

    const { error, retryAfter } = call(mw, "u1");
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(429);
    expect((error as AppError).code).toBe("too_many_requests");
    // Never 0 — that would invite a retry guaranteed to fail again.
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("recovers once the window has passed", async () => {
    const mw = rateLimit({ limit: 1, windowMs: 50 });

    expect(call(mw, "u1").error).toBeUndefined();
    expect(call(mw, "u1").error).toBeInstanceOf(AppError); // spent

    await sleep(70);

    expect(call(mw, "u1").error).toBeUndefined(); // new window
  });

  it("budgets each caller separately", () => {
    const mw = rateLimit({ limit: 1, windowMs: 10_000 });

    expect(call(mw, "alice").error).toBeUndefined();
    expect(call(mw, "alice").error).toBeInstanceOf(AppError);
    // Bob is unaffected by Alice exhausting hers.
    expect(call(mw, "bob").error).toBeUndefined();
  });

  it("gives each mount its own budget", () => {
    // Separate `rateLimit()` calls close over separate bucket maps, so
    // exhausting one route's budget must not spend another's.
    const sends = rateLimit({ limit: 1, windowMs: 10_000 });
    const creates = rateLimit({ limit: 1, windowMs: 10_000 });

    expect(call(sends, "u1").error).toBeUndefined();
    expect(call(sends, "u1").error).toBeInstanceOf(AppError);
    expect(call(creates, "u1").error).toBeUndefined();
  });

  it("falls back to IP when there is no authenticated user", () => {
    const mw = rateLimit({ limit: 1, windowMs: 10_000 });
    const req = { ip: "10.0.0.9" } as unknown as Request;
    const res = { setHeader: () => undefined } as unknown as Response;

    const run = () => {
      let error: unknown;
      mw(req, res, (e?: unknown) => {
        error = e;
      });
      return error;
    };

    expect(run()).toBeUndefined();
    expect(run()).toBeInstanceOf(AppError);
  });

  it("ships limits that a person cannot reach", () => {
    // Guards the intent, not the implementation: these exist to stop a script,
    // and a human mashing send must never see a 429. If someone tightens them
    // toward human speed, this fails and asks them to justify it.
    expect(SEND_MESSAGE_LIMIT.limit / (SEND_MESSAGE_LIMIT.windowMs / 1000)).toBeGreaterThanOrEqual(5);
    expect(CREATE_LIMIT.limit).toBeGreaterThanOrEqual(30);
  });
});
