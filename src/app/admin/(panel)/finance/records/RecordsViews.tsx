import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { Segmented } from "../../../kit/Segmented";

/** Records by month (the form and one month) or the whole history (slice 8), as a switch at the top of both. */
export function RecordsViews({ current, locale }: { current: "month" | "all"; locale: Locale }) {
  const v = getAdminDictionary(locale).finance.records.views;
  return (
    <Segmented
      label={v.aria}
      value={current}
      items={[
        { key: "month", label: v.month, href: "/finance/records" },
        { key: "all", label: v.all, href: "/finance/records/history" },
      ]}
      className="w-full max-w-full sm:w-auto"
    />
  );
}
