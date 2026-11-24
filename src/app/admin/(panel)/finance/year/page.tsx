import type { Metadata } from "next";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { FinanceTabs } from "../FinanceTabs";
import { MonthHeadline } from "../MonthHeadline";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.year} · ${t.title}` };
}

/**
 * Finance → Year. Slice 1 of docs/plans/finance-investor-payroll.md: until the yearly statement and the investor view
 * (slice 2) arrive, the tab shows the current month's headline and says so.
 */
export default async function FinanceYearPage() {
  const { staff } = await requireOwner();
  return (
    <div className="adm-page">
      <BeforeHydration>
        <FinanceTabs locale={staff.locale} />
      </BeforeHydration>
      <MonthHeadline view="year" />
    </div>
  );
}
