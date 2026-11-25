import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff } from "@/lib/admin/auth";
import { canHandleOrders } from "@/lib/admin/roles";
import {
  DashboardCatalogueSkeleton,
  DashboardDaysSkeleton,
  DashboardOrdersSkeleton,
  DashboardReportsSkeleton,
} from "../kit/Skeleton";
import { CatalogueOverview } from "./CatalogueOverview";
import { DaysAheadOverview } from "./DaysAheadOverview";
import { OrdersOverview, type ChartMode } from "./OrdersOverview";
import { ReportsOverview } from "./ReportsOverview";

/**
 * The overview. Owners get the order figures first (orders hold personal data, so nobody else's page reads them),
 * then the payment-method split and the ordering hours of the last 30 days (the report functions, owner only);
 * everyone gets tomorrow's rations (owners and managers also the orders ending soon), then the dish tiles and the
 * menu readiness. Each part streams in its own boundary, so slow or failed figures never hold up the others.
 */
export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const { staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const { chart: chartParam } = await searchParams;
  const chart: ChartMode = chartParam === "value" ? "value" : "orders";

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.home.hello(staff.name)}</p>

      {staff.role === "owner" && (
        <Suspense fallback={<DashboardOrdersSkeleton />}>
          <OrdersOverview locale={staff.locale} chart={chart} />
        </Suspense>
      )}

      {/* Owner only too: payment methods and ordering hours of the last 30 days, and when the figures were read. */}
      {staff.role === "owner" && (
        <Suspense fallback={<DashboardReportsSkeleton />}>
          <ReportsOverview locale={staff.locale} />
        </Suspense>
      )}

      <Suspense fallback={<DashboardDaysSkeleton tiles={canHandleOrders(staff.role) ? 2 : 1} />}>
        <DaysAheadOverview locale={staff.locale} />
      </Suspense>

      <Suspense fallback={<DashboardCatalogueSkeleton />}>
        <CatalogueOverview locale={staff.locale} />
      </Suspense>
    </div>
  );
}
