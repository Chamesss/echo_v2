import { z } from 'zod';

/**
 * Frontend environment variables.
 *
 * Vite only exposes vars prefixed with `VITE_` to client code. Parsed at
 * import time so a missing/malformed value crashes the dev server immediately
 * instead of producing a vague runtime error inside a fetch call.
 */
const schema = z.object({
  VITE_API_URL: z.string().url(),
  // Cloudflare Turnstile site key. When present, the auth forms render a
  // Turnstile widget and attach its token to sign-in/sign-up/reset requests.
  // Optional: leave unset to disable CAPTCHA in dev (mirrors the server, which
  // only enforces it when TURNSTILE_SECRET_KEY is set).
  VITE_TURNSTILE_SITE_KEY: z.string().optional(),
});

export const env = schema.parse(import.meta.env);
