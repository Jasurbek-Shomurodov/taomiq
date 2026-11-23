"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Turnstile } from "@/components/Turnstile";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { requestEmailCode, startOAuth, verifyEmailCode, type EmailCodeState } from "@/lib/account/actions";
import type { AuthMethod, OAuthMethod } from "@/lib/account/methods";

type T = Dictionary["account"];

const RESEND_SECONDS = 60;

/**
 * Telegram first (nearly every customer in Tashkent has it), then Google, then an email code. Only the
 * methods switched on in NEXT_PUBLIC_AUTH_METHODS are shown.
 */
export function LoginForm({
  locale,
  next,
  methods,
  t,
  error,
  turnstileKey,
}: {
  locale: Locale;
  next: string;
  methods: AuthMethod[];
  t: T;
  /** One sentence from /login?error=… (provider cancelled or failed, rate limited). */
  error?: string;
  /** Turnstile site key, "" when the bot check is off (src/lib/turnstile/config.ts). */
  turnstileKey: string;
}) {
  const oauth = methods.filter((m): m is OAuthMethod => m !== "email");
  const email = methods.includes("email");

  return (
    <div className="container-page max-w-md py-10 md:py-14">
      {error && (
        <p role="alert" className="mb-6 rounded-2xl border border-danger/30 bg-danger/10 p-4 text-graphite">
          {error}
        </p>
      )}

      {oauth.length > 0 && (
        <div className="grid gap-3">
          {oauth.map((method) => (
            <form key={method} action={startOAuth.bind(null, method, locale, next)}>
              <ProviderButton method={method} label={t[method]} pendingLabel={t.redirecting} />
            </form>
          ))}
        </div>
      )}

      {email && (
        <>
          {oauth.length > 0 && (
            <div className="my-8 flex items-center gap-4 text-sm text-muted" aria-hidden>
              <span className="h-px flex-1 bg-line" />
              {t.or}
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
          <EmailCodeForm locale={locale} next={next} t={t} turnstileKey={turnstileKey} />
        </>
      )}
    </div>
  );
}

function ProviderButton({ method, label, pendingLabel }: { method: OAuthMethod; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  const style =
    method === "telegram"
      ? "btn btn-forest"
      : "btn btn-outline border-line bg-white text-forest hover:bg-ivory-deep";
  return (
    <button type="submit" disabled={pending} className={`${style} min-h-12 w-full disabled:opacity-60`}>
      {method === "telegram" ? <TelegramIcon /> : <GoogleIcon />}
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Email → 6-digit code → signed in, on one page. The code step offers "send again" after 60 seconds
 * and "change email". The two server actions are wrapped in one client action so the step and the
 * address live in a single state.
 */
function EmailCodeForm({ locale, next, t, turnstileKey }: { locale: Locale; next: string; t: T; turnstileKey: string }) {
  const [state, dispatch, pending] = useActionState<EmailCodeState, FormData>(
    async (prev, form) => {
      const intent = form.get("intent");
      if (intent === "change") return { step: "email", email: prev.email };
      if (intent === "verify") return verifyEmailCode(prev, form);
      return requestEmailCode(prev, form);
    },
    { step: "email" },
  );

  const alert = state.error && (
    <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
      {state.error}
    </p>
  );

  if (state.step === "email") {
    return (
      <form action={dispatch} className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <div>
          <label htmlFor="login-email" className="label text-muted">
            {t.email}
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email ?? ""}
            className="field mt-2"
          />
        </div>
        <Turnstile siteKey={turnstileKey} action="email-code" locale={locale} resetKey={state} />
        {alert}
        <button type="submit" name="intent" value="send" disabled={pending} className="btn btn-gold min-h-12 w-full disabled:opacity-60">
          {pending ? t.sending : t.sendCode}
        </button>
      </form>
    );
  }

  return (
    <form action={dispatch} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={state.email ?? ""} />
      <input type="hidden" name="sentAt" value={state.sentAt ?? ""} />
      <p className="text-graphite" role="status">
        {t.codeSent.replace("{email}", state.email ?? "")}
      </p>
      <CodeInput label={t.code} />
      {/* For "send again" only: checking the code needs no bot check. */}
      <Turnstile siteKey={turnstileKey} action="email-code" locale={locale} resetKey={state} />
      {alert}
      <button type="submit" name="intent" value="verify" disabled={pending} className="btn btn-gold min-h-12 w-full disabled:opacity-60">
        {pending ? t.verifying : t.verify}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <ResendButton key={state.sentAt} t={t} disabled={pending} />
        <button
          type="submit"
          name="intent"
          value="change"
          formNoValidate
          disabled={pending}
          className="press inline-flex min-h-11 items-center text-forest underline underline-offset-4"
        >
          {t.changeEmail}
        </button>
      </div>
    </form>
  );
}

function CodeInput({ label }: { label: string }) {
  const input = useRef<HTMLInputElement>(null);
  // The code step replaces the email step: move focus to the new field.
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <div>
      <label htmlFor="login-code" className="label text-muted">
        {label}
      </label>
      <input
        ref={input}
        id="login-code"
        name="code"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        className="field mt-2 text-center font-semibold tracking-[0.5em]"
      />
    </div>
  );
}

/** "Send again" waits 60 seconds from the last send. Keyed by the send time, so a new code restarts it. */
function ResendButton({ t, disabled }: { t: T; disabled: boolean }) {
  const [remaining, setRemaining] = useState(RESEND_SECONDS);
  useEffect(() => {
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const waiting = remaining > 0;
  return (
    <button
      type="submit"
      name="intent"
      value="send"
      formNoValidate
      disabled={disabled || waiting}
      className="press inline-flex min-h-11 items-center text-forest underline underline-offset-4 disabled:text-muted disabled:no-underline"
    >
      {waiting ? t.resendIn.replace("{s}", String(remaining)) : t.resend}
    </button>
  );
}

function TelegramIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.4 4.2 2.9 11.4c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.3-.5-1.9-1.6-1.4ZM8.9 14l9.3-5.9c.4-.3.8-.1.5.2l-7.6 6.9-.3 3.2L8.9 14Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8l3.6-2.8Z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}
