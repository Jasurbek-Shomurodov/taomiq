import { CalendarClock, ChefHat } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { ENDING_SOON_DAYS, loadEndingSoon } from "@/lib/admin/deliveries";
import { loadRationCount } from "@/lib/admin/kitchen";
import { formatDay } from "@/lib/admin/orders";
import { canHandleOrders } from "@/lib/admin/roles";
import { addDays, tashkentDay } from "@/lib/admin/stats";
import { Notice } from "../kit/Notice";
import { StatTile } from "../kit/StatTile";

const DASH = "—";

/**
 * The days ahead (docs/plans/kitchen-day-sheet.md, slice 3). Everyone: tomorrow's rations to cook, opening the
 * production sheet (tomorrow is its default day). Owners and managers also: firm orders whose last delivery day falls
 * within ENDING_SOON_DAYS days from today, opening the delivery sheet of the earliest such day. The endings read goes
 * through public.delivery_orders, which carries personal data, so it is never called for anyone who does not handle
 * orders (canHandleOrders). Days are Tashkent days. A failed read prints "—" and a notice, never a made-up 0.
 */
export async function DaysAheadOverview({ locale }: { locale: Locale }) {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(locale);
  const handlesOrders = canHandleOrders(staff.role);
  // Read the clock only after the session (a request-time read), so the day is the request's.
  const today = tashkentDay(new Date())!;
  const [rations, ending] = await Promise.all([
    loadRationCount(supabase, addDays(today, 1)),
    handlesOrders ? loadEndingSoon(supabase, today) : Promise.resolve(null),
  ]);
  const retry = { href: "/", label: t.common.retry };

  return (
    <>
      {!rations && (
        <Notice tone="negative" retry={retry}>
          {t.home.tomorrowFailed}
        </Notice>
      )}
      {handlesOrders && !ending && (
        <Notice tone="negative" retry={retry}>
          {t.home.endingFailed}
        </Notice>
      )}
      {/* auto-fill, not auto-fit: one or two tiles stay as wide as the tiles of the full rows around them. */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        <StatTile
          label={t.home.tomorrowRations}
          value={rations ? rations.firm : DASH}
          icon={ChefHat}
          href="/kitchen"
          footer={
            rations && rations.awaiting > 0 ? <span>{t.home.tomorrowAwaiting(rations.awaiting)}</span> : undefined
          }
        />
        {handlesOrders && (
          <StatTile
            label={t.home.endingSoon(ENDING_SOON_DAYS)}
            value={ending ? ending.count : DASH}
            icon={CalendarClock}
            href={ending?.firstDay ? `/deliveries?date=${ending.firstDay}` : "/deliveries"}
            tone={(ending?.count ?? 0) > 0 ? "caution" : "accent"}
            footer={
              ending?.firstDay ? <span>{t.home.endingNext(formatDay(ending.firstDay, locale))}</span> : undefined
            }
          />
        )}
      </div>
    </>
  );
}
