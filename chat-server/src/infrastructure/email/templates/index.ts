/**
 * HTML email templates used by `email-service.ts`.
 *
 * Kept as plain template literals — no templating engine, no MJML. The
 * subset of HTML/CSS that survives across Gmail / Outlook / Apple Mail is
 * narrow enough that hand-written tables-and-inline-styles is the realistic
 * approach for a starter app. When the email surface grows past a handful
 * of templates we'd switch to a library (react-email is the popular pick).
 *
 * Each `*Template` function returns `{ subject, html }` so the calling
 * service doesn't have to know template internals.
 */

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wraps body HTML in the shared chrome (centered card on a light background).
 *
 * The `preview` text shows up in the inbox preview pane (Gmail/Apple Mail)
 * but is hidden in the rendered email. Worth setting per-template so users
 * see a meaningful summary before opening.
 */
function renderLayout(title: string, preview: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
    <div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escape(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8f9fa;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
            <tr>
              <td style="padding:40px;">
                ${body}
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" style="max-width:520px;">
            <tr>
              <td style="padding:16px 8px;text-align:center;color:#9ca3af;font-size:12px;">
                Chat &middot; This is an automated email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `
    <p style="margin:0 0 24px;">
      <a href="${escape(url)}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">
        ${escape(label)}
      </a>
    </p>
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
      Or paste this link into your browser:
      <br>
      <span style="color:#1a1a1a;word-break:break-all;">${escape(url)}</span>
    </p>
  `;
}

/**
 * Sent in response to POST /api/auth/request-password-reset.
 *
 * Called from `email-service.ts#sendResetPassword`. The `url` includes the
 * one-time token Better Auth generated; clicking it lands the user on
 * /reset-password?token=... on the frontend.
 */
export function resetPasswordTemplate({ name, url }: { name: string; url: string }) {
  return {
    subject: "Reset your Chat password",
    html: renderLayout(
      "Reset your password",
      "Click the link to choose a new password.",
      `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Reset your password</h1>
        <p style="margin:0 0 16px;line-height:1.5;">Hi ${escape(name)},</p>
        <p style="margin:0 0 24px;line-height:1.5;color:#374151;">
          We received a request to reset your Chat password. Click the button
          below to choose a new one. This link expires in 1 hour.
        </p>
        ${ctaButton("Reset password", url)}
        <p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
          If you didn't request a password reset, you can safely ignore this email
          — your password won't change.
        </p>
      `,
    ),
  };
}

/**
 * Sent on sign-up when `AUTH_REQUIRE_EMAIL_VERIFICATION=true`, or any time
 * `authClient.sendVerificationEmail` is called from the frontend.
 */
export function verifyEmailTemplate({ name, url }: { name: string; url: string }) {
  return {
    subject: "Verify your email for Chat",
    html: renderLayout(
      "Verify your email",
      "Confirm your email address to finish setting up your account.",
      `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Verify your email</h1>
        <p style="margin:0 0 16px;line-height:1.5;">Hi ${escape(name)},</p>
        <p style="margin:0 0 24px;line-height:1.5;color:#374151;">
          Click the button below to verify your email address and finish
          activating your Chat account.
        </p>
        ${ctaButton("Verify email", url)}
      `,
    ),
  };
}

/**
 * Sent to the OLD email address when a user requests to change their email.
 *
 * The user must click the link from their CURRENT inbox to authorize the
 * change. This prevents an attacker who has the session cookie but not the
 * email account from silently taking over the address.
 */
export function changeEmailTemplate({
  name,
  newEmail,
  url,
}: {
  name: string;
  newEmail: string;
  url: string;
}) {
  return {
    subject: "Confirm your new email address",
    html: renderLayout(
      "Confirm email change",
      `Confirm changing your email to ${newEmail}`,
      `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Confirm email change</h1>
        <p style="margin:0 0 16px;line-height:1.5;">Hi ${escape(name)},</p>
        <p style="margin:0 0 24px;line-height:1.5;color:#374151;">
          You requested to change your Chat email address to
          <strong>${escape(newEmail)}</strong>. Click the button below to
          confirm. This link expires in 1 hour.
        </p>
        ${ctaButton("Confirm email change", url)}
        <p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
          If you didn't request this change, ignore this email and consider
          changing your password — someone else may have access to your account.
        </p>
      `,
    ),
  };
}

/**
 * Sent once on first sign-up. Cosmetic — Better Auth doesn't gate anything on
 * delivery, so a missed send is fine (logged via NoOpEmailService in dev).
 */
export function welcomeTemplate({ name }: { name: string }) {
  return {
    subject: "Welcome to Chat",
    html: renderLayout(
      "Welcome",
      `Welcome to Chat, ${name}!`,
      `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Welcome to Chat</h1>
        <p style="margin:0 0 16px;line-height:1.5;">Hi ${escape(name)},</p>
        <p style="margin:0 0 16px;line-height:1.5;color:#374151;">
          Your account is ready. Create a workspace to start chatting with your
          team, or join one you've been invited to.
        </p>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
          Reply to this email if you have any questions.
        </p>
      `,
    ),
  };
}
