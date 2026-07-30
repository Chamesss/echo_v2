import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";
import {
  changeEmailTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
  workspaceInviteTemplate,
} from "./templates/index.js";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
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

interface WorkspaceInviteArgs {
  to: string;
  workspaceName: string;
  inviterName: string;
  url: string;
}

/**
 * Application-facing email API.
 *
 * Callers (Better Auth callbacks in `auth.ts`, modules that send transactional
 * email) talk to this interface — never to a provider SDK directly — so the
 * transport can be swapped without touching call sites.
 *
 * Three implementations, picked by `createEmailService` in this precedence:
 *   1. `ResendEmailService` — RESEND_API_KEY set. The default for deployments:
 *                             one API key, domain-level SPF/DKIM, delivery log.
 *   2. `SmtpEmailService`   — no Resend key but SMTP_HOST set. For self-hosters
 *                             and Mailtrap-style dev sandboxes.
 *   3. `NoOpEmailService`   — neither configured. Logs the message + URL so dev
 *                             can complete password-reset / invite flows by
 *                             copying the URL out of the server logs.
 *
 * Both a `text` and an `html` part go out on every send (see `renderText` in
 * ./templates) — HTML-only mail is scored worse by spam filters.
 */
export interface EmailService {
  sendResetPassword(args: ResetPasswordArgs): Promise<void>;
  sendVerificationEmail(args: VerifyEmailArgs): Promise<void>;
  sendChangeEmailConfirmation(args: ChangeEmailArgs): Promise<void>;
  sendWorkspaceInvite(args: WorkspaceInviteArgs): Promise<void>;
}

/**
 * Template dispatch shared by the real transports.
 *
 * Every provider does the same two things — pick the template, hand the
 * rendered parts to a transport — and differs only in how the bytes leave the
 * process. Keeping the mapping here means adding a provider is a single `send`
 * implementation, and no template can be wired to one transport but not the
 * other.
 */
abstract class TemplateEmailService implements EmailService {
  protected abstract send(args: SendArgs): Promise<void>;

  async sendResetPassword({ to, name, url }: ResetPasswordArgs): Promise<void> {
    await this.send({ to, ...resetPasswordTemplate({ name, url }) });
  }

  async sendVerificationEmail({
    to,
    name,
    url,
  }: VerifyEmailArgs): Promise<void> {
    await this.send({ to, ...verifyEmailTemplate({ name, url }) });
  }

  async sendChangeEmailConfirmation({
    to,
    name,
    newEmail,
    url,
  }: ChangeEmailArgs): Promise<void> {
    await this.send({ to, ...changeEmailTemplate({ name, newEmail, url }) });
  }

  async sendWorkspaceInvite({
    to,
    workspaceName,
    inviterName,
    url,
  }: WorkspaceInviteArgs): Promise<void> {
    await this.send({
      to,
      ...workspaceInviteTemplate({ workspaceName, inviterName, url }),
    });
  }
}

/**
 * The slice of the Resend SDK this service uses.
 *
 * Narrowed to one method so a test can pass a fake without standing up the
 * whole client (which would try to read an API key).
 */
export interface ResendMailer {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    }): Promise<{ error: { name: string; message: string } | null }>;
  };
}

export class ResendEmailService extends TemplateEmailService {
  constructor(
    private readonly client: ResendMailer,
    private readonly from: string,
  ) {
    super();
  }

  protected async send({ to, subject, html, text }: SendArgs): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject,
      html,
      text,
    });
    // Resend's SDK RESOLVES with `{ data: null, error }` on API failures — it
    // does not reject. Swallowing that would make Better Auth report a
    // successful send for mail that never left (and the invite endpoint hide a
    // token the user can only get by email), so map it onto a throw and let the
    // existing call-site semantics apply: auth hooks propagate the error, the
    // invite controller catches and logs it.
    if (error) {
      throw new Error(`Resend send failed: ${error.name} — ${error.message}`);
    }
  }
}

export class SmtpEmailService extends TemplateEmailService {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {
    super();
  }

  protected async send({ to, subject, html, text }: SendArgs): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, html, text });
  }
}

export class NoOpEmailService implements EmailService {
  async sendResetPassword({ to, name, url }: ResetPasswordArgs): Promise<void> {
    logger.warn(
      { to, name, url },
      "[NO EMAIL TRANSPORT] Password reset email — copy the url to test the flow",
    );
  }

  async sendVerificationEmail({
    to,
    name,
    url,
  }: VerifyEmailArgs): Promise<void> {
    logger.warn(
      { to, name, url },
      "[NO EMAIL TRANSPORT] Verification email — copy the url to verify the address",
    );
  }

  async sendChangeEmailConfirmation({
    to,
    name,
    newEmail,
    url,
  }: ChangeEmailArgs): Promise<void> {
    logger.warn(
      { to, name, newEmail, url },
      "[NO EMAIL TRANSPORT] Email change confirmation — copy the url to authorize the change",
    );
  }

  async sendWorkspaceInvite({
    to,
    workspaceName,
    inviterName,
    url,
  }: WorkspaceInviteArgs): Promise<void> {
    logger.warn(
      { to, workspaceName, inviterName, url },
      "[NO EMAIL TRANSPORT] Workspace invite — copy the url to accept the invitation",
    );
  }
}

/** The env slice that decides the transport. Injectable so tests can vary it. */
export type EmailEnv = Pick<
  typeof env,
  | "RESEND_API_KEY"
  | "EMAIL_FROM"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_SECURE"
  | "SMTP_USER"
  | "SMTP_PASS"
  | "SMTP_FROM"
>;

/**
 * Resolves the transport from config: Resend, else SMTP, else log-only.
 *
 * Exported (and taking its config as an argument) so the precedence is
 * unit-testable without re-importing the env module.
 */
export function createEmailService(config: EmailEnv = env): EmailService {
  if (config.RESEND_API_KEY) {
    // Resend only accepts a from-address on a domain verified in its dashboard
    // (or onboarding@resend.dev, which reaches your own account address only) —
    // anything else is rejected per-send with a 403, not at boot.
    if (!config.EMAIL_FROM) {
      logger.warn(
        "RESEND_API_KEY is set but EMAIL_FROM is missing — falling back to NoOpEmailService.",
      );
      return new NoOpEmailService();
    }
    logger.info("Resend email transport ready");
    return new ResendEmailService(
      new Resend(config.RESEND_API_KEY),
      config.EMAIL_FROM,
    );
  }

  if (config.SMTP_HOST) {
    // SMTP_FROM overrides EMAIL_FROM here so the two transports can send as
    // different addresses (see the schema comment in config/env.ts).
    const from = config.SMTP_FROM ?? config.EMAIL_FROM;
    if (!from) {
      logger.warn(
        "SMTP_HOST is set but neither SMTP_FROM nor EMAIL_FROM is — falling back to NoOpEmailService.",
      );
      return new NoOpEmailService();
    }

    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });

    logger.info("SMTP email transport ready");

    return new SmtpEmailService(transport, from);
  }

  logger.warn(
    "Neither RESEND_API_KEY nor SMTP_HOST is set — using NoOpEmailService. Outgoing emails will be logged, not delivered.",
  );
  return new NoOpEmailService();
}

export const emailService = createEmailService();
