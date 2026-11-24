import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { FINANCE_LIMITS } from "@/lib/admin/finance/categories";
import { formatMonth, monthKeys, type FinanceMonth } from "@/lib/admin/finance/month";
import { MonthSwitcher } from "../../kit/MonthSwitcher";

/**
 * The month switcher of the Finance pages (Month, Records): every month from the ledger's first (FINANCE_LIMITS.firstDay)
 * to the current one. `hrefFor` builds the page's address for a month and gets null for the current month, which is
 * the address without ?m.
 */
export function FinanceMonthSwitcher({
  month,
  today,
  locale,
  hrefFor,
}: {
  month: FinanceMonth;
  /** Tashkent "YYYY-MM-DD". */
  today: string;
  locale: Locale;
  hrefFor: (monthParam: string | null) => string;
}) {
  const labels = getAdminDictionary(locale).finance.monthSwitch;
  const current = today.slice(0, 7);
  const href = (key: string) => hrefFor(key === current ? null : key);
  return (
    <MonthSwitcher
      value={month.key}
      months={monthKeys(FINANCE_LIMITS.firstDay.slice(0, 7), current).map((key) => ({
        key,
        label: formatMonth(key, locale),
        href: href(key),
      }))}
      prev={month.prev ? href(month.prev) : null}
      next={month.next ? href(month.next) : null}
      labels={labels}
    />
  );
}
