import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";
import {
  changeEmailTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from "./templates/index.js";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

interface ResetPasswordArgs {
  to: string;
  name: string;
  url: string;
}

interface VerifyEmailArgs {
  to: string;
  name: string;
  url: string;
}

interface ChangeEmailArgs {
  to: string;
  name: string;
  newEmail: string;
  url: string;
}

interface WelcomeArgs {
  to: string;
  name: string;
}

/**
 * Application-facing email API.
 *
 * Callers (Better Auth callbacks in `auth.ts`, future modules that send
 * transactional email) talk to this interface — not to nodemailer directly
 * — so the underlying transport can be swapped (SES SDK, Resend SDK, etc.)
 * without touching call sites.
 *
 * Two implementations:
 *   - `SmtpEmailService`  — real nodemailer transport when SMTP_HOST is set
 *   - `NoOpEmailService`  — logs the message + URL when SMTP isn't configured,
 *                           so dev can complete password-reset flows by
 *                           copying the reset URL out of the server logs
 */
export interface EmailService {
  sendResetPassword(args: ResetPasswordArgs): Promise<void>;
  sendVerificationEmail(args: VerifyEmailArgs): Promise<void>;
  sendChangeEmailConfirmation(args: ChangeEmailArgs): Promise<void>;
  sendWelcome(args: WelcomeArgs): Promise<void>;
}

class SmtpEmailService implements EmailService {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  private async send({ to, subject, html }: SendArgs): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, html });
  }

  async sendResetPassword({ to, name, url }: ResetPasswordArgs): Promise<void> {
    const { subject, html } = resetPasswordTemplate({ name, url });
    await this.send({ to, subject, html });
  }

  async sendVerificationEmail({ to, name, url }: VerifyEmailArgs): Promise<void> {
    const { subject, html } = verifyEmailTemplate({ name, url });
    await this.send({ to, subject, html });
  }

  async sendChangeEmailConfirmation({ to, name, newEmail, url }: ChangeEmailArgs): Promise<void> {
    const { subject, html } = changeEmailTemplate({ name, newEmail, url });
    await this.send({ to, subject, html });
  }

  async sendWelcome({ to, name }: WelcomeArgs): Promise<void> {
    const { subject, html } = welcomeTemplate({ name });
    await this.send({ to, subject, html });
  }
}

class NoOpEmailService implements EmailService {
  async sendResetPassword({ to, name, url }: ResetPasswordArgs): Promise<void> {
    logger.warn(
      { to, name, url },
      "[NO SMTP] Password reset email — copy the url to test the flow",
    );
  }

  async sendVerificationEmail({ to, name, url }: VerifyEmailArgs): Promise<void> {
    logger.warn(
      { to, name, url },
      "[NO SMTP] Verification email — copy the url to verify the address",
    );
  }

  async sendChangeEmailConfirmation({ to, name, newEmail, url }: ChangeEmailArgs): Promise<void> {
    logger.warn(
      { to, name, newEmail, url },
      "[NO SMTP] Email change confirmation — copy the url to authorize the change",
    );
  }

  async sendWelcome({ to, name }: WelcomeArgs): Promise<void> {
    logger.info({ to, name }, "[NO SMTP] Welcome email (skipped)");
  }
}

function createEmailService(): EmailService {
  if (!env.SMTP_HOST) {
    logger.warn(
      "SMTP_HOST not set — using NoOpEmailService. Outgoing emails will be logged, not delivered.",
    );
    return new NoOpEmailService();
  }
  if (!env.SMTP_FROM) {
    logger.warn(
      "SMTP_HOST is set but SMTP_FROM is missing — falling back to NoOpEmailService.",
    );
    return new NoOpEmailService();
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });

  logger.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
    "SMTP transport ready",
  );

  return new SmtpEmailService(transport, env.SMTP_FROM);
}

export const emailService = createEmailService();
