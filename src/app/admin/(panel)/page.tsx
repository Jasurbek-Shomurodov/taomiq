import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff } from "@/lib/admin/auth";
import { DashboardCatalogueSkeleton, DashboardDaysSkeleton, DashboardOrdersSkeleton } from "../kit/Skeleton";
import { CatalogueOverview } from "./CatalogueOverview";
import { DaysAheadOverview } from "./DaysAheadOverview";
import { OrdersOverview, type ChartMode } from "./OrdersOverview";

/**
 * The overview. Owners get the order figures first (orders hold personal data, so nobody else's page reads them);
 * everyone gets tomorrow's rations (the owner also the orders ending soon), then the dish tiles and the menu
 * readiness. Each part streams in its own boundary, so slow or failed figures never hold up the others.
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

      <Suspense fallback={<DashboardDaysSkeleton tiles={staff.role === "owner" ? 2 : 1} />}>
        <DaysAheadOverview locale={staff.locale} />
      </Suspense>

      <Suspense fallback={<DashboardCatalogueSkeleton />}>
        <CatalogueOverview locale={staff.locale} />
      </Suspense>
    </div>
  );
}
