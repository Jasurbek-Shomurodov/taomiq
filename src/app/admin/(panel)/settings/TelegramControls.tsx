"use client";

import { LoaderCircle, RotateCw, Send, SkipForward } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { locales, localeName, type Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import {
  resendTelegram,
  saveTelegramLocale,
  saveTelegramSwitches,
  sendTelegramTest,
  skipTelegramBacklog,
} from "@/lib/telegram/actions";
import { TELEGRAM_KINDS, type OutboxStatus, type TelegramKind, type TelegramSwitches } from "@/lib/telegram/rules";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { Badge, type Tone } from "../../kit/Badge";
import { FormMessage } from "../finance/payroll/FormMessage";
import { SaveLine, SettingRow, useSave } from "./Controls";

/*
 * The Telegram section's controls (docs/plans/zarkebab-feature-port.md, slice 9a): the switches per kind of message
 * and the language, each saved on its own like every other setting; the test message; and the "Send again" button of
 * a failed or uncertain delivery. The list itself is drawn by the page (server), which renders each row's text.
 */

const switchesKey = (switches: TelegramSwitches) => TELEGRAM_KINDS.map((kind) => (switches[kind] ? "1" : "0")).join("");

/** One checkbox per kind, saved together. */
export function TelegramSwitchesField({ initial, locale }: { initial: TelegramSwitches; locale: Locale }) {
  const tg = getAdminDictionary(locale).settings.tg;
  const id = useId();
  const [switches, setSwitches] = useState(initial);
  const [saved, setSaved] = useState(() => switchesKey(initial));
  const current = switchesKey(switches);
  const { formAction, pending, message, clear } = useSave(saveTelegramSwitches, () => setSaved(current));

  return (
    <SettingRow label={tg.kinds} hint={tg.kindsHint}>
      <form action={formAction} className="grid gap-3">
        <ul className="grid gap-2 sm:pt-2">
          {TELEGRAM_KINDS.map((kind: TelegramKind) => (
            <li key={kind}>
              <label htmlFor={`${id}-${kind}`} className="flex items-start gap-2.5 text-sm text-adm-text">
                <input
                  id={`${id}-${kind}`}
                  type="checkbox"
                  name="on"
                  value={kind}
                  checked={switches[kind]}
                  disabled={pending}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setSwitches((prev) => ({ ...prev, [kind]: on }));
                    if (message.ok || message.error) clear();
                  }}
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>{tg.kindNames[kind]}</span>
              </label>
            </li>
          ))}
        </ul>
        <SaveLine pending={pending} disabled={current === saved} message={message} problem={null} locale={locale} />
      </form>
    </SettingRow>
  );
}

/** The messages' language, for the whole group. */
export function TelegramLocaleField({ initial, locale }: { initial: Locale; locale: Locale }) {
  const tg = getAdminDictionary(locale).settings.tg;
  const id = useId();
  const [value, setValue] = useState<Locale>(initial);
  const [saved, setSaved] = useState<Locale>(initial);
  const { formAction, pending, message, clear } = useSave(saveTelegramLocale, () => setSaved(value));

  return (
    <SettingRow label={tg.language} hint={tg.languageHint} htmlFor={id}>
      <form action={formAction} className="grid gap-3">
        <select
          id={id}
          name="value"
          value={value}
          disabled={pending}
          onChange={(event) => {
            setValue(event.currentTarget.value as Locale);
            if (message.ok || message.error) clear();
          }}
          className="adm-input w-56"
        >
          {locales.map((option) => (
            <option key={option} value={option}>
              {localeName[option]}
            </option>
          ))}
        </select>
        <SaveLine pending={pending} disabled={value === saved} message={message} problem={null} locale={locale} />
      </form>
    </SettingRow>
  );
}

/** "Send a test message": off until the group is configured. */
export function TelegramTestField({ configured, locale }: { configured: boolean; locale: Locale }) {
  const tg = getAdminDictionary(locale).settings.tg;
  const [state, formAction, pending] = useActionState<FormState, FormData>(sendTelegramTest, {});

  return (
    <SettingRow label={tg.test} hint={tg.testHint}>
      <form action={formAction} className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:pt-1">
        <button
          type="submit"
          disabled={pending || !configured}
          aria-busy={pending || undefined}
          className="adm-btn adm-btn-outline"
        >
          {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
          {pending ? tg.testSending : tg.testButton}
        </button>
        {configured ? (
          <FormMessage message={state} pending={pending} />
        ) : (
          <span className="adm-caption">{tg.testOff}</span>
        )}
      </form>
    </SettingRow>
  );
}

const TONES: Record<OutboxStatus, Tone> = {
  pending: "info",
  sending: "info",
  sent: "positive",
  failed: "negative",
  uncertain: "caution",
  skipped: "neutral",
};

export function OutboxStatusBadge({ status, locale }: { status: OutboxStatus; locale: Locale }) {
  return (
    <Badge tone={TONES[status]} status>
      {getAdminDictionary(locale).settings.tg.statuses[status]}
    </Badge>
  );
}

/** "Send again" for one failed or uncertain message. */
export function ResendButton({ id, what, locale }: { id: number; what: string; locale: Locale }) {
  const tg = getAdminDictionary(locale).settings.tg;
  const [state, formAction, pending] = useActionState<FormState, FormData>(resendTelegram, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        aria-label={`${tg.resend}: ${what}`}
        className="adm-btn adm-btn-ghost adm-btn-sm"
      >
        {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RotateCw aria-hidden="true" />}
        {pending ? tg.resending : tg.resend}
      </button>
      <FormMessage message={state} pending={pending} />
    </form>
  );
}

/**
 * "Start from now": skips every pending message (asks first, naming the count), so switching the chat on does not send
 * what queued before. The page shows it only while something is pending.
 */
export function TelegramBacklogField({ pending: count, locale }: { pending: number; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const b = t.settings.tg.backlog;
  const [state, formAction, pending] = useActionState<FormState, FormData>(skipTelegramBacklog, {});
  return (
    <SettingRow label={b.label} hint={b.hint}>
      <form action={formAction} className="grid gap-2 sm:pt-1">
        <p className="adm-caption tabular-nums">{b.pending(count)}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ConfirmDialog
            trigger={
              <>
                <SkipForward aria-hidden="true" />
                {b.button}
              </>
            }
            triggerClassName="adm-btn adm-btn-outline"
            disabled={pending}
            title={b.title}
            description={b.text(count)}
            confirmLabel={b.confirm}
            pendingLabel={b.skipping}
            cancelLabel={t.common.cancel}
            destructive
            pending={pending}
          />
          <FormMessage message={state} pending={pending} />
        </div>
      </form>
    </SettingRow>
  );
}
