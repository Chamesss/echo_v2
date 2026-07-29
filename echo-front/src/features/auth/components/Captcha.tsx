import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { TURNSTILE_SITE_KEY } from "@/config/env";

/**
 * Cloudflare Turnstile integration for the auth forms.
 *
 * Exports:
 *   - `captchaEnabled`        — true only when VITE_TURNSTILE_SITE_KEY is set.
 *                               When false the widget renders nothing and the
 *                               request helper sends no header, so a dev
 *                               environment without keys behaves exactly as
 *                               before. This mirrors the server, which only
 *                               enforces CAPTCHA when TURNSTILE_SECRET_KEY is
 *                               configured.
 *   - `captchaRequestOptions` — spread into a Better Auth client call so the
 *                               token rides along in the `x-captcha-response`
 *                               header the server's captcha plugin reads.
 *   - `useCaptcha` + `Captcha` — token state plus the rendered widget. The
 *                               widget reports the token via `onToken`; the
 *                               parent calls `reset()` after a failed submit
 *                               because Turnstile tokens are single-use.
 */

const SITE_KEY = TURNSTILE_SITE_KEY;
export const captchaEnabled = Boolean(SITE_KEY);

// `render=explicit` keeps us in control of when/where the widget mounts instead
// of Turnstile auto-scanning the DOM for `.cf-turnstile` elements.
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
}

interface TurnstileApi {
  render: (el: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Injects the Turnstile script once; resolves when `window.turnstile` exists. */
function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // let a later mount retry
      reject(new Error("Failed to load Cloudflare Turnstile"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Spread into a Better Auth client call, e.g.
 *   signIn.email({ ...input, ...captchaRequestOptions(token) })
 *
 * Returns `{}` when CAPTCHA is disabled or no token has been produced yet, so
 * the call shape is unchanged in those cases (and we never send an empty
 * header).
 */
export function captchaRequestOptions(token: string | null): {
  fetchOptions?: { headers: Record<string, string> };
} {
  if (!captchaEnabled || !token) return {};
  return { fetchOptions: { headers: { "x-captcha-response": token } } };
}

export interface CaptchaHandle {
  /** Clears the token and resets the widget so the user can solve a fresh one. */
  reset: () => void;
}

/** Holds the token and a ref to wire into <Captcha> for post-failure resets. */
export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<CaptchaHandle>(null);
  const reset = useCallback(() => {
    ref.current?.reset();
  }, []);
  return { token, setToken, reset, ref, enabled: captchaEnabled };
}

interface CaptchaProps {
  onToken: (token: string | null) => void;
}

/**
 * Renders the Turnstile widget, or nothing when CAPTCHA is disabled. Reports
 * the solved token through `onToken` and exposes `reset()` via the forwarded
 * ref (used by the forms after a failed attempt).
 */
export const Captcha = forwardRef<CaptchaHandle, CaptchaProps>(function Captcha(
  { onToken },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Keep the latest onToken in a ref so the render effect can stay mount-only
  // (depending on onToken would tear down + recreate the widget every render).
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
        onTokenRef.current(null);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!captchaEnabled || !SITE_KEY) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current) return; // already rendered (StrictMode remount)
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme: "auto",
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => onTokenRef.current(null),
          "expired-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // Script blocked/offline: token stays null and the form blocks submit
        // with a clear message rather than failing silently at the API.
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  if (!captchaEnabled) return null;
  return <div ref={containerRef} />;
});
