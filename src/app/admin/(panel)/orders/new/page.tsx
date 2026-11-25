import { PackageX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { listDurations, listPrograms } from "@/lib/admin/queries";
import { loadBusinessSettings } from "@/lib/admin/settings-queries";
import { tashkentDay } from "@/lib/admin/stats";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { NewOrderForm, type FormDuration, type FormProgram } from "../OrderForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).orderForm.newTitle };
}

/**
 * A new order taken by phone or Telegram (docs/plans/zarkebab-feature-port.md, slice 2). Owners and managers. Only
 * active programs, levels and durations are offered (the database refuses others too); the delivery windows are the
 * ones the site offers now.
 */
export default async function NewOrderPage() {
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  // Read the clock only after the session (a request-time read).
  const today = tashkentDay(new Date())!;

  let data: { programs: FormProgram[]; durations: FormDuration[]; windows: string[] } | null = null;
  try {
    const [programs, durations, settings] = await Promise.all([
      listPrograms(supabase),
      listDurations(supabase),
      loadBusinessSettings(supabase),
    ]);
    data = {
      programs: programs
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          name: p.name,
          variants: p.variants
            .filter((v) => v.active)
            .map((v) => ({ id: v.id, kcal: v.kcal, price: v.price_per_day })),
        }))
        .filter((p) => p.variants.length > 0),
      durations: durations.map((d) => ({ days: d.days, markup: Number(d.markup_pct) })),
      windows: settings.deliveryWindows,
    };
  } catch (error) {
    console.error("new order: catalogue read failed", error instanceof Error ? error.message : error);
  }

  return (
    <div className="adm-page">
      <TopBarBack href="/orders" label={t.order.back} />
      <TopBarTitle>
        <span className="adm-truncate">{t.orderForm.newTitle}</span>
      </TopBarTitle>
      {!data ? (
        <Notice tone="negative" retry={{ href: "/orders/new", label: t.common.retry }}>
          {t.orderForm.loadFailed}
        </Notice>
      ) : data.programs.length === 0 || data.durations.length === 0 ? (
        <Panel>
          <EmptyState
            icon={PackageX}
            action={
              staff.role === "owner" ? (
                <Link href="/programs" className="adm-btn adm-btn-outline">
                  {t.nav.programs}
                </Link>
              ) : undefined
            }
          >
            {t.orderForm.noPrograms}
          </EmptyState>
        </Panel>
      ) : (
        <NewOrderForm
          programs={data.programs}
          durations={data.durations}
          windows={data.windows}
          today={today}
          locale={locale}
        />
      )}
    </div>
  );
}
