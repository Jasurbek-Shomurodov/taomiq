"use client";

import { useEffect, useRef } from "react";
import type { Locale } from "@/i18n/config";
import { TURNSTILE_FIELD, type TurnstileAction } from "@/lib/turnstile/shared";

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
 * onload callback, once per page however many widgets ask for it. A failed load (a flaky mobile network, a
 * blocker) forgets itself, so the next call tries again.
 */
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__taomiqTurnstileReady";
let loading: Promise<TurnstileApi> | null = null;
/** A script that neither loads nor fails (a stalled mobile connection) is given up on after this, so it can be retried. */
const LOAD_TIMEOUT_MS = 15_000;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (message: string) => {
      window.clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => fail("turnstile script timed out"), LOAD_TIMEOUT_MS);
    window.__taomiqTurnstileReady = () => {
      window.clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail("turnstile missing");
    };
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onerror = () => fail("turnstile script failed to load");
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile in managed mode, for a form that posts to a server action. Renders nothing when `siteKey`
 * is empty: the server page passes `turnstileWidgetKey` (src/lib/turnstile/config.ts), which is empty unless
 * the server checks tokens too (demo mode, the e2e build, half a configuration).
 *
 * The widget puts its token in a hidden input (TURNSTILE_FIELD) inside its container, so it must sit inside the
 * <form>: the token then travels with the form data and the form needs no extra state. It shows itself only
 * when Cloudflare wants the visitor to click (appearance "interaction-only"); otherwise it takes no space.
 *
 * A token is valid for 300 seconds and can be redeemed once. Turnstile renews an expired one by itself;
 * pass the form's action state as `resetKey` so every answer from the server (after which the token is spent)
 * starts a fresh challenge.
 *
 * If Cloudflare's script failed to load, there is no widget and the form posts without a token, which the server
 * refuses (it cannot tell that from a bot skipping the check) with a message to try again. So the widget is tried
 * again when the visitor next touches the form (focus inside it, or a submit) and after every server answer:
 * by the time they press the button again it usually has a token.
 */
export function Turnstile({
  siteKey,
  action,
  locale,
  resetKey,
  className,
}: {
  siteKey: string;
  action: TurnstileAction;
  locale: Locale;
  resetKey?: unknown;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  /** Renders the widget if there is none yet (loading Cloudflare's script first, again if it failed before). */
  const ensureWidget = useRef<() => void>(() => {});
  // Turnstile has Russian but no Uzbek: Uzbek pages follow the browser's language ("auto", English otherwise).
  const language = locale === "ru" ? "ru" : "auto";

  useEffect(() => {
    const element = container.current;
    if (!siteKey || !element) return;
    let cancelled = false;
    let pending = false;
    let id: string | undefined;

    const ensure = () => {
      if (cancelled || pending || id) return;
      pending = true;
      loadTurnstile()
        .then((turnstile) => {
          if (cancelled || id) return;
          id = turnstile.render(element, {
            sitekey: siteKey,
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
          // Blocked or offline: the form still posts without a token and the server's answer says what to do.
          // The next touch of the form, or the next server answer, tries again.
        })
        .finally(() => {
          pending = false;
        });
    };
    ensureWidget.current = ensure;
    ensure();

    // Safari does not focus a button on click, so a submit is listened for as well as focus.
    const form = element.closest("form");
    form?.addEventListener("focusin", ensure);
    form?.addEventListener("submit", ensure);

    return () => {
      cancelled = true;
      form?.removeEventListener("focusin", ensure);
      form?.removeEventListener("submit", ensure);
      ensureWidget.current = () => {};
      if (id) window.turnstile?.remove(id);
      widgetId.current = undefined;
    };
  }, [siteKey, action, language]);

  // A new server answer: the token that went with it is spent, so get a fresh one (or the first one, if the
  // widget never loaded).
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (Object.is(lastResetKey.current, resetKey)) return;
    lastResetKey.current = resetKey;
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
    else ensureWidget.current();
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={container} className={className} />;
}
