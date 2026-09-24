import { useEffect, useRef, useState } from "react";
import type { AuthConfig } from "@orbit/types";
import { api } from "../lib/api";

/**
 * Bot check for sign-up / password reset. Renders nothing unless the API's /v1/auth/config asks for a CAPTCHA
 * (then a Cloudflare Turnstile widget). `onToken` gets the response token, or null when it expires/resets.
 * `useCaptchaConfig` is undefined while loading, null when no check is needed.
 */
export function useCaptchaConfig(): AuthConfig["captcha"] | undefined {
  const [captcha, setCaptcha] = useState<AuthConfig["captcha"] | undefined>(undefined);
  useEffect(() => {
    api.authConfig().then((c) => setCaptcha(c.captcha)).catch(() => setCaptcha(null));
  }, []);
  return captcha;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile failed to load")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load the security check. Check your connection and reload."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function Captcha({ config, onToken }: { config: NonNullable<AuthConfig["captcha"]>; onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !ref.current) return;
        id = ts.render(ref.current, {
          sitekey: config.site_key,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [config.site_key, onToken]);
  return (
    <div>
      <div ref={ref} />
      {error && <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
