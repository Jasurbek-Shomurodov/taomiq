import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { loadBackdateDays, loadFeeRates, loadFinanceSettings } from "@/lib/admin/finance/queries";
import { FINANCE_SETTING_NAMES } from "@/lib/admin/finance/settings";
import {
  integrations,
  loadAppliedMigrations,
  loadBusinessSettings,
  type AppliedMigrations,
} from "@/lib/admin/settings-queries";
import { formatAuditTime } from "@/lib/admin/audit";
import { tashkentDay } from "@/lib/admin/stats";
import {
  cronSecret,
  isOwnerTelegramConfigured,
  telegramBotToken,
  telegramOwnerChatId,
} from "@/lib/telegram/config";
import { loadTelegramSettings, loadTelegramStatus, type TelegramStatus } from "@/lib/telegram/queries";
import { formatMessageDay, renderTelegramMessage } from "@/lib/telegram/render";
import { outboxReason } from "@/lib/telegram/rules";
import type { Locale } from "@/i18n/config";
import { Badge } from "../../kit/Badge";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { LanguageSegmented } from "../../LanguageSwitch";
import {
  AnchorField,
  BackdateField,
  CutoffField,
  FeeRatesField,
  FinanceField,
  PhoneField,
  SettingRow,
  TelegramField,
  ThemeChoice,
  WindowsField,
} from "./Controls";
import {
  OutboxStatusBadge,
  ResendButton,
  TelegramBacklogField,
  TelegramLocaleField,
  TelegramSwitchesField,
  TelegramTestField,
} from "./TelegramControls";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  return { title: getAdminDictionary(staff.locale).nav.settings };
}

const SELF = "/settings";

async function settle<T>(what: string, load: () => Promise<T>): Promise<{ value: T } | null> {
  try {
    return { value: await load() };
  } catch (error) {
    console.error(`settings: ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Settings (owner only; docs/plans/zarkebab-feature-port.md, slice 1): the business settings in sections, each control
 * saving on its own (Controls.tsx), then appearance and a read-only System panel. A section whose read failed shows a
 * notice with a retry instead of its controls, so a failed read never offers defaults to save over real values.
 */
export default async function SettingsPage() {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const s = t.settings;
  // Read the clock only after the session (a request-time read). Tashkent day, as the menu cycle counts it.
  const today = tashkentDay(new Date())!;

  const [business, finance, backdate, feeRates, migrations, telegram, outbox] = await Promise.all([
    settle("settings read", () => loadBusinessSettings(supabase)),
    settle("finance settings read", () => loadFinanceSettings(supabase)),
    settle("backdate read", () => loadBackdateDays(supabase)),
    settle("fee rates read", () => loadFeeRates(supabase)),
    settle("migrations read", () => loadAppliedMigrations(supabase)),
    settle("telegram settings read", () => loadTelegramSettings(supabase)),
    settle("telegram status read", () => loadTelegramStatus(supabase)),
  ]);

  const failed = (
    <Notice tone="negative" retry={{ href: SELF, label: t.common.retry }} className="m-4 sm:m-5">
      {s.loadFailed}
    </Notice>
  );

  return (
    <div className="adm-page">
      <div className="grid w-full max-w-4xl gap-5">
        <p className="adm-muted">{s.lead}</p>

        <Section id="delivery" title={s.sections.delivery.title} lead={s.sections.delivery.lead}>
          {business ? (
            <>
              <WindowsField initial={business.value.deliveryWindows} locale={locale} />
              <CutoffField initial={business.value.cutoffHour} locale={locale} />
            </>
          ) : (
            failed
          )}
        </Section>

        <Section id="menu" title={s.sections.menu.title} lead={s.sections.menu.lead}>
          {business ? <AnchorField initial={business.value.cycleAnchor} today={today} locale={locale} /> : failed}
        </Section>

        <Section id="contacts" title={s.sections.contacts.title} lead={s.sections.contacts.lead}>
          {business ? (
            <>
              <PhoneField initial={business.value.contactPhone} locale={locale} />
              <TelegramField initial={business.value.contactTelegram} locale={locale} />
            </>
          ) : (
            failed
          )}
        </Section>

        <Section id="finance" title={s.sections.finance.title} lead={s.sections.finance.lead}>
          {finance ? (
            FINANCE_SETTING_NAMES.map((name) => (
              <FinanceField key={name} name={name} initial={finance.value[name]} locale={locale} />
            ))
          ) : (
            <Notice tone="negative" retry={{ href: SELF, label: t.common.retry }} className="m-4 sm:m-5">
              {t.finance.settings.loadFailed}
            </Notice>
          )}
          {/* Slice 8 (migration 0024): how far back records may be dated, and bank fee rates for the estimate. */}
          {backdate ? (
            <BackdateField initial={backdate.value} locale={locale} />
          ) : (
            <Notice tone="negative" retry={{ href: SELF, label: t.common.retry }} className="m-4 sm:m-5">
              {s.loadFailed}
            </Notice>
          )}
          {feeRates ? (
            <FeeRatesField rates={feeRates.value} today={today} locale={locale} />
          ) : (
            <Notice tone="negative" retry={{ href: SELF, label: t.common.retry }} className="m-4 sm:m-5">
              {t.finance.fees.loadFailed}
            </Notice>
          )}
        </Section>

        {/* Slice 9a (migration 0026): the owner group's messages. */}
        <Section id="telegram" title={s.sections.telegram.title} lead={s.sections.telegram.lead}>
          <TelegramConnection t={t} />
          {telegram ? (
            <>
              <TelegramSwitchesField initial={telegram.value.switches} locale={locale} />
              <TelegramLocaleField initial={telegram.value.locale} locale={locale} />
            </>
          ) : (
            failed
          )}
          <TelegramTestField configured={isOwnerTelegramConfigured} locale={locale} />
          {outbox && outbox.value.pending > 0 && <TelegramBacklogField pending={outbox.value.pending} locale={locale} />}
          <TelegramDeliveries outbox={outbox} t={t} locale={locale} />
        </Section>

        <Section id="appearance" title={s.sections.appearance.title} lead={s.sections.appearance.lead}>
          <SettingRow label={s.appearance.language}>
            <div className="w-full max-w-xs">
              <LanguageSegmented locale={locale} label={s.appearance.language} />
            </div>
          </SettingRow>
          <SettingRow label={s.appearance.theme}>
            <div>
              <ThemeChoice locale={locale} />
            </div>
          </SettingRow>
        </Section>

        <Section id="system" title={s.sections.system.title} lead={s.sections.system.lead}>
          <SystemRows migrations={migrations} t={t} />
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <Panel flush id={id} title={title} description={lead} className="scroll-mt-32">
      {children}
    </Panel>
  );
}

function SystemRows({ migrations, t }: { migrations: { value: AppliedMigrations | null } | null; t: AdminDictionary }) {
  const sys = t.settings.system;
  const applied = migrations?.value ?? null;
  return (
    <>
      <SettingRow label={sys.migrations}>
        {!migrations ? (
          <p className="text-sm text-adm-negative sm:pt-2.5">{sys.migrationsFailed}</p>
        ) : !applied ? (
          <p className="adm-muted text-sm sm:pt-2.5">{sys.migrationsNone}</p>
        ) : (
          <div className="grid gap-0.5 sm:pt-2.5">
            <p className="text-sm font-medium tabular-nums text-adm-text">{sys.migrationsValue(applied.count)}</p>
            {applied.latest && <p className="adm-caption break-all">{sys.migrationsLatest(applied.latest)}</p>}
          </div>
        )}
      </SettingRow>
      <SettingRow label={sys.integrations}>
        <ul className="grid gap-3 sm:pt-1.5">
          {integrations().map((item) => (
            <li key={item.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-adm-text">
                  {sys.names[item.key]}
                  {item.detail && <span className="font-normal text-adm-muted"> · {item.detail}</span>}
                </p>
                <p className="adm-caption break-all">
                  <span className="sr-only">{sys.env}: </span>
                  {item.env.map((name, i) => (
                    <span key={name}>
                      {i > 0 && ", "}
                      <code className="font-mono text-[12px]">{name}</code>
                    </span>
                  ))}
                </p>
              </div>
              <Badge tone={item.on ? "positive" : "neutral"} status>
                {item.on ? sys.on : sys.off}
              </Badge>
            </li>
          ))}
        </ul>
      </SettingRow>
    </>
  );
}

/** Which of the Telegram section's variables are set, by name only. */
function TelegramConnection({ t }: { t: AdminDictionary }) {
  const tg = t.settings.tg;
  const vars = [
    { name: "TELEGRAM_BOT_TOKEN", on: Boolean(telegramBotToken) },
    { name: "TELEGRAM_OWNER_CHAT_ID", on: Boolean(telegramOwnerChatId) },
    { name: "CRON_SECRET", on: Boolean(cronSecret) },
  ] as const;
  return (
    <SettingRow label={tg.connection} hint={tg.connectionHint}>
      <div className="grid gap-3 sm:pt-1.5">
        <ul className="grid gap-3">
          {vars.map((item) => (
            <li key={item.name} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-adm-text">
                  <code className="font-mono text-[12px]">{item.name}</code>
                </p>
                <p className="adm-caption">{tg.vars[item.name]}</p>
              </div>
              <Badge tone={item.on ? "positive" : "neutral"} status>
                {item.on ? tg.set : tg.notSet}
              </Badge>
            </li>
          ))}
        </ul>
        {!isOwnerTelegramConfigured && (
          <Notice tone="caution">{tg.notConfigured}</Notice>
        )}
      </div>
    </SettingRow>
  );
}

/** "25.11.2026 14:05" in Tashkent. */
function deliveryTime(iso: string, locale: Locale): string {
  const day = tashkentDay(iso);
  return day ? `${formatMessageDay(day)} ${formatAuditTime(iso, locale)}` : "—";
}

/** The latest 20 messages with their status, a reason for a failure, and "Send again" for a failed or uncertain one. */
function TelegramDeliveries({
  outbox,
  t,
  locale,
}: {
  outbox: { value: TelegramStatus } | null;
  t: AdminDictionary;
  locale: Locale;
}) {
  const tg = t.settings.tg;
  if (!outbox) {
    return (
      <SettingRow label={tg.deliveries}>
        <Notice tone="negative" retry={{ href: `${SELF}#telegram`, label: t.common.retry }}>
          {tg.loadFailed}
        </Notice>
      </SettingRow>
    );
  }
  const { counts, recent, waitingRetry } = outbox.value;
  return (
    <SettingRow label={tg.deliveries} hint={tg.deliveriesHint}>
      <div className="grid gap-3 sm:pt-2.5">
        <p className="adm-caption tabular-nums">{tg.week(counts.sent, counts.failed, counts.uncertain)}</p>
        {waitingRetry > 0 && <p className="adm-caption tabular-nums">{tg.waitingRetry(waitingRetry)}</p>}
        {recent.length === 0 ? (
          <p className="adm-muted text-sm">{tg.empty}</p>
        ) : (
          <ul className="grid gap-2">
            {recent.map((item) => {
              const what =
                item.kind === "test"
                  ? tg.kindTest
                  : renderTelegramMessage(item.kind, item.payload, locale).split("\n")[0];
              const reason = item.lastError ? outboxReason(item.lastError) : null;
              const reasonText =
                item.lastError && reason
                  ? reason === "refused" || reason === "other"
                    ? tg.reasons[reason](item.lastError)
                    : tg.reasons[reason]
                  : null;
              return (
                <li
                  key={item.id}
                  className="grid gap-1.5 rounded-adm-control border border-adm-border px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 text-sm font-medium text-adm-text">{what}</p>
                    <OutboxStatusBadge status={item.status} locale={locale} />
                  </div>
                  <p className="adm-caption tabular-nums">
                    {deliveryTime(item.sentAt ?? item.createdAt, locale)}
                    {item.attempts > 1 && <> · {tg.attempts(item.attempts)}</>}
                  </p>
                  {reasonText && item.status !== "sent" && <p className="adm-caption">{reasonText}</p>}
                  {(item.status === "failed" || item.status === "uncertain") && (
                    <ResendButton id={item.id} what={what} locale={locale} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingRow>
  );
}
