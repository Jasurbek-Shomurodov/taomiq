import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { loadFinanceSettings } from "@/lib/admin/finance/queries";
import { FINANCE_SETTING_NAMES } from "@/lib/admin/finance/settings";
import {
  integrations,
  loadAppliedMigrations,
  loadBusinessSettings,
  type AppliedMigrations,
} from "@/lib/admin/settings-queries";
import { tashkentDay } from "@/lib/admin/stats";
import { Badge } from "../../kit/Badge";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { LanguageSegmented } from "../../LanguageSwitch";
import {
  AnchorField,
  CutoffField,
  FinanceField,
  PhoneField,
  SettingRow,
  TelegramField,
  ThemeChoice,
  WindowsField,
} from "./Controls";

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

  const [business, finance, migrations] = await Promise.all([
    settle("settings read", () => loadBusinessSettings(supabase)),
    settle("finance settings read", () => loadFinanceSettings(supabase)),
    settle("migrations read", () => loadAppliedMigrations(supabase)),
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
