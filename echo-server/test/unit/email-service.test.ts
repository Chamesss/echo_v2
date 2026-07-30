import { describe, expect, it, vi } from "vitest";
import {
  createEmailService,
  NoOpEmailService,
  ResendEmailService,
  SmtpEmailService,
  type EmailEnv,
  type ResendMailer,
} from "../../src/infrastructure/email/email-service.js";
import {
  changeEmailTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
  workspaceInviteTemplate,
} from "../../src/infrastructure/email/templates/index.js";

/**
 * Covers the two things that can break email without any visible symptom:
 *
 *   1. Resend's SDK RESOLVES with `{ error }` instead of rejecting, so a service
 *      that ignores it reports success for mail that never left. Every auth flow
 *      would look healthy while password resets vanished.
 *   2. A template that drops its plaintext part, or forgets to escape an
 *      attacker-controlled display name into HTML.
 *
 * Plus the transport precedence, which decides whether a deploy sends anything
 * at all.
 */

function fakeResend(error: { name: string; message: string } | null = null) {
  const send = vi.fn().mockResolvedValue({ data: null, error });
  const client: ResendMailer = { emails: { send } };
  return { client, send };
}

/** An `env` slice with everything off; override only what a case is about. */
function emailEnv(over: Partial<EmailEnv> = {}): EmailEnv {
  return { SMTP_PORT: 587, SMTP_SECURE: false, ...over };
}

describe("ResendEmailService", () => {
  it("sends from/to/subject with BOTH an html and a text part", async () => {
    const { client, send } = fakeResend();
    const service = new ResendEmailService(client, "Echo <no-reply@echo.test>");

    await service.sendResetPassword({
      to: "user@example.com",
      name: "Ada",
      url: "https://echo.test/reset-password?token=abc123",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0];
    expect(payload.from).toBe("Echo <no-reply@echo.test>");
    expect(payload.to).toBe("user@example.com");
    expect(payload.subject).toBe("Reset your Echo password");
    expect(payload.html).toContain("token=abc123");
    expect(payload.text).toContain("token=abc123");
  });

  it("throws when Resend RESOLVES with an error instead of rejecting", async () => {
    const { client } = fakeResend({
      name: "validation_error",
      message: "The echo.test domain is not verified",
    });
    const service = new ResendEmailService(client, "Echo <no-reply@echo.test>");

    await expect(
      service.sendResetPassword({
        to: "user@example.com",
        name: "Ada",
        url: "https://echo.test/reset-password?token=abc123",
      }),
    ).rejects.toThrow(/Resend send failed: validation_error/);
  });

  it("routes every template through the transport", async () => {
    const { client, send } = fakeResend();
    const service = new ResendEmailService(client, "Echo <no-reply@echo.test>");
    const url = "https://echo.test/x?token=t";

    await service.sendVerificationEmail({ to: "a@b.test", name: "Ada", url });
    await service.sendChangeEmailConfirmation({
      to: "a@b.test",
      name: "Ada",
      newEmail: "new@b.test",
      url,
    });
    await service.sendWorkspaceInvite({
      to: "a@b.test",
      workspaceName: "Acme",
      inviterName: "Grace",
      url,
    });

    expect(send).toHaveBeenCalledTimes(3);
    for (const [payload] of send.mock.calls) {
      expect(payload.subject).toBeTruthy();
      expect(payload.html).toContain("token=t");
      expect(payload.text).toContain("token=t");
    }
  });
});

describe("templates", () => {
  const url = "https://echo.test/action?token=raw&next=/home";
  const cases = [
    ["resetPassword", resetPasswordTemplate({ name: "Ada", url })],
    ["verifyEmail", verifyEmailTemplate({ name: "Ada", url })],
    [
      "changeEmail",
      changeEmailTemplate({ name: "Ada", newEmail: "new@b.test", url }),
    ],
    [
      "workspaceInvite",
      workspaceInviteTemplate({
        workspaceName: "Acme",
        inviterName: "Grace",
        url,
      }),
    ],
  ] as const;

  for (const [name, rendered] of cases) {
    it(`${name} returns a subject, an html part and a text part`, () => {
      expect(rendered.subject).toBeTruthy();
      expect(rendered.html).toContain("<!doctype html>");
      expect(rendered.text.length).toBeGreaterThan(0);
      expect(rendered.text).not.toContain("<");
    });

    it(`${name} keeps the url usable in both parts`, () => {
      // The html part escapes `&` per HTML rules; the text part must not, or the
      // user pastes a broken link into their browser.
      expect(rendered.html).toContain("token=raw&amp;next=/home");
      expect(rendered.text).toContain(url);
    });
  }

  it("escapes an attacker-controlled display name into html, not text", () => {
    const name = '<script>alert("xss")</script> & co';
    const { html, text } = resetPasswordTemplate({ name, url });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(text).toContain(name);
  });
});

describe("createEmailService transport precedence", () => {
  const from = "Echo <no-reply@echo.test>";

  it("prefers Resend when RESEND_API_KEY is set, even alongside SMTP", () => {
    const service = createEmailService(
      emailEnv({
        RESEND_API_KEY: "re_test_key",
        EMAIL_FROM: from,
        SMTP_HOST: "smtp.example.test",
      }),
    );
    expect(service).toBeInstanceOf(ResendEmailService);
  });

  it("falls back to SMTP when only SMTP_HOST is set", () => {
    const service = createEmailService(
      emailEnv({ SMTP_HOST: "smtp.example.test", EMAIL_FROM: from }),
    );
    expect(service).toBeInstanceOf(SmtpEmailService);
  });

  it("accepts SMTP_FROM alone as the SMTP transport's from-address", () => {
    // SMTP_FROM overrides EMAIL_FROM on that transport, so it has to satisfy
    // the from-address requirement on its own.
    const service = createEmailService(
      emailEnv({ SMTP_HOST: "smtp.example.test", SMTP_FROM: from }),
    );
    expect(service).toBeInstanceOf(SmtpEmailService);
  });

  it("ignores SMTP_FROM on the Resend transport", () => {
    // Resend must never pick up the SMTP address — it'd send from a domain
    // that isn't verified there and 403 on every message.
    expect(
      createEmailService(
        emailEnv({ RESEND_API_KEY: "re_test_key", SMTP_FROM: from }),
      ),
    ).toBeInstanceOf(NoOpEmailService);
  });

  it("degrades to NoOp when a transport is configured without a from-address", () => {
    expect(
      createEmailService(emailEnv({ RESEND_API_KEY: "re_test_key" })),
    ).toBeInstanceOf(NoOpEmailService);
    expect(
      createEmailService(emailEnv({ SMTP_HOST: "smtp.example.test" })),
    ).toBeInstanceOf(NoOpEmailService);
  });

  it("degrades to NoOp when nothing is configured", () => {
    expect(createEmailService(emailEnv())).toBeInstanceOf(NoOpEmailService);
  });
});
