import { periodParams, type ReportPeriod } from "./reports";
import type { PaymentMethod, PurchaseTab } from "./purchases";

/*
 * Addresses of the Purchases screen (/purchases): the tab, the period of History, Analytics and Sheet (the Reports
 * screen's period rules: `?period=` or `?from=&to=`, the last 30 days by default) and the History filters. Server
 * side: the period helpers live in lib/admin/reports.ts.
 */

export type PurchaseFilters = { q?: string; category?: string | null; method?: PaymentMethod | null; page?: number };

export function purchasesHref({
  tab,
  period,
  filters = {},
}: {
  tab: PurchaseTab;
  period?: Pick<ReportPeriod, "from" | "to" | "preset"> | null;
  filters?: PurchaseFilters;
}): string {
  const params = new URLSearchParams();
  if (tab !== "new") params.set("tab", tab);
  if (tab !== "new" && period) for (const [key, value] of periodParams(period)) params.set(key, value);
  if (tab === "history") {
    if (filters.q) params.set("q", filters.q);
    if (filters.category) params.set("category", filters.category);
    if (filters.method) params.set("method", filters.method);
    if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  }
  const query = params.toString();
  return query ? `/purchases?${query}` : "/purchases";
}
