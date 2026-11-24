import type { AdminDictionary } from "@/i18n/admin";
import { balanceState } from "@/lib/admin/finance/math";
import { Badge } from "../../../kit/Badge";
import { sumText } from "../figures";

/*
 * Small pieces shared by the payroll list and a person's page. No data access.
 */

/** "4 000 000 сум в месяц", "150 000 сум в день", or "No rate". */
export function rateLine(amount: number | null, unit: "daily" | "monthly" | null, t: AdminDictionary): string {
  const p = t.finance.payroll;
  return amount === null || unit === null ? p.noRate : p.rateText[unit](sumText(amount, t));
}

/** Due (owed to the person), advance (paid ahead, info tone) or settled. */
export function BalanceBadge({ balance, t }: { balance: number; t: AdminDictionary }) {
  const p = t.finance.payroll;
  const state = balanceState(balance);
  const tone = state.kind === "due" ? "caution" : state.kind === "advance" ? "info" : "neutral";
  return <Badge tone={tone}>{p.balance[state.kind]}</Badge>;
}
