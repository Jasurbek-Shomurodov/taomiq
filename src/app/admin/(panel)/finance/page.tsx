import type { Metadata } from "next";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { FinanceTabs } from "./FinanceTabs";
import { MonthHeadline } from "./MonthHeadline";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.month} · ${t.title}` };
}

/**
 * Finance → Month. Slice 1 of docs/plans/finance-investor-payroll.md: the current month's three headline figures.
 * The month switcher, indicators, categories and daily chart come with slice 2.
 */
export default async function FinanceMonthPage() {
  const { staff } = await requireOwner();
  return (
    <div className="adm-page">
      {/* The top bar fills only once the scripts run; until then the same tabs sit on the page. */}
      <BeforeHydration>
        <FinanceTabs locale={staff.locale} />
      </BeforeHydration>
      <MonthHeadline view="month" />
    </div>
  );
}
