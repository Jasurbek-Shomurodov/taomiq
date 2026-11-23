"use client";

import { useEffect, useRef } from "react";
import type { Locale } from "@/i18n/config";
import { TURNSTILE_FIELD, turnstileSiteKey, type TurnstileAction } from "@/lib/turnstile/shared";

/** The part of Cloudflare's window.turnstile this component uses. */
type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __taomiqTurnstileReady?: () => void;
  }
}

/**
 * Loaded from Cloudflare's own address (its docs: never proxy or cache api.js), in explicit-render mode with an
 * onload callback, once per page however many widgets ask for it. A failed load can be tried again later.
 */
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__taomiqTurnstileReady";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    window.__taomiqTurnstileReady = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile in managed mode, for a form that posts to a server action. Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (demo mode, the e2e build).
 *
 * The widget puts its token in a hidden input (TURNSTILE_FIELD) inside its container, so it must sit inside the
 * <form>: the token then travels with the form data and the form needs no extra state. It shows itself only
 * when Cloudflare wants the visitor to click (appearance "interaction-only"); otherwise it takes no space.
 *
 * A token is valid for 300 seconds and can be redeemed once. Turnstile renews an expired one by itself;
 * pass the form's action state as `resetKey` so every answer from the server (after which the token is spent)
 * starts a fresh challenge.
 */
export function Turnstile({
  action,
  locale,
  resetKey,
  className,
}: {
  action: TurnstileAction;
  locale: Locale;
  resetKey?: unknown;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  // Turnstile has Russian but no Uzbek: Uzbek pages follow the browser's language ("auto", English otherwise).
  const language = locale === "ru" ? "ru" : "auto";

  useEffect(() => {
    const element = container.current;
    if (!turnstileSiteKey || !element) return;
    let cancelled = false;
    let id: string | undefined;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        id = turnstile.render(element, {
          sitekey: turnstileSiteKey,
          action,
          language,
          theme: "light",
          size: "flexible",
          appearance: "interaction-only",
          "response-field-name": TURNSTILE_FIELD,
          "refresh-expired": "auto",
          // Handled (returning true keeps the console quiet): Turnstile retries by itself, and the server's
          // answer tells the visitor what to do if no token arrives.
          "error-callback": () => true,
        });
        widgetId.current = id;
      })
      .catch(() => {
        // Blocked or offline: the form still posts without a token and the server's answer says so.
      });

    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
      widgetId.current = undefined;
    };
  }, [action, language]);

  // A new server answer: the token that went with it is spent, so get a fresh one.
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (Object.is(lastResetKey.current, resetKey)) return;
    lastResetKey.current = resetKey;
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  if (!turnstileSiteKey) return null;
  return <div ref={container} className={className} />;
}
