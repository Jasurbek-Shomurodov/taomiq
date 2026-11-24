import { requireOwner } from "@/lib/admin/auth";
import { TopBarTabs } from "../../shell/TopBarSlot";
import { FinanceTabs } from "./FinanceTabs";

/**
 * Finance (docs/plans/finance-investor-payroll.md): owner only. Managers and admins are sent back to the overview
 * here and by each page; the table and the functions refuse them too (migration 0013). The top bar keeps the nav
 * label "Finance" as its title and shows the sections beside it.
 */
export default async function FinanceLayout({ children }: LayoutProps<"/admin/finance">) {
  const { staff } = await requireOwner();
  return (
    <>
      <TopBarTabs>
        <FinanceTabs locale={staff.locale} />
      </TopBarTabs>
      {children}
    </>
  );
}
