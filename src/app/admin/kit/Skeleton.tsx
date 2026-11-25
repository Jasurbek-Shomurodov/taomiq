import { LoadingStatus } from "../shell/ShellLocale";

/** One shimmering block. Size and shape come from className (h-*, w-*, rounded-*). */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={`adm-skeleton ${className}`} style={style} />;
}

export type PageSkeletonLayout = "dashboard" | "table" | "cards" | "form" | "detail";

/**
 * A content-shaped placeholder for a whole panel page (loading.tsx), built from the real boxes: .adm-page, panels
 * and rows, so the page lands where the skeleton was. Spinners belong only inside a pressed button.
 */
export function PageSkeleton({ layout }: { layout: PageSkeletonLayout }) {
  return (
    <div className="adm-page" aria-busy="true">
      <LoadingStatus />
      {layout === "dashboard" && <DashboardSkeleton />}
      {layout === "table" && <TableSkeleton />}
      {layout === "cards" && <CardsSkeleton />}
      {layout === "form" && <FormSkeleton />}
      {layout === "detail" && <DetailSkeleton />}
    </div>
  );
}

function Lines({ count, className = "h-4" }: { count: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={`${className} ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="adm-panel adm-panel-flush">
      <div className="adm-table-head flex h-10 items-center px-4">
        <Skeleton className="h-3 w-32" />
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="adm-row flex items-center gap-4 px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** `fill` keeps empty tracks, so a short row (the days-ahead tiles) has tiles as wide as a full row's. */
function TileRow({ count = 4, fill = false }: { count?: number; fill?: boolean }) {
  return (
    <div
      className={`grid gap-4 ${fill ? "[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]" : "[grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]"}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="adm-panel grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="size-8 rounded-adm-control" />
          </div>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ))}
    </div>
  );
}

/** The overview's order figures (owner): KPI tiles, the 30-day chart and the breakdown panels. */
export function DashboardOrdersSkeleton() {
  // Fixed heights, so the shimmer does not depend on Math.random during render.
  const bars = [40, 55, 30, 65, 50, 45, 70, 35, 60, 50, 75, 45, 55, 40, 80, 60, 50, 65, 45, 70, 55, 85, 60, 50, 65, 75, 55, 70, 60, 90];
  return (
    <>
      <TileRow />
      <div className="adm-panel grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-56" />
          </div>
          <Skeleton className="h-10 w-48 rounded-xl" />
        </div>
        <div className="flex h-40 items-end gap-[3px] sm:h-48">
          {bars.map((height, i) => (
            <Skeleton key={i} className="min-w-0 flex-1 rounded-b-none" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="adm-panel grid gap-4">
            <Skeleton className="h-4 w-36" />
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="grid gap-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** The overview's report panels (owner): the payment-method split and the ordering-hours strip side by side. */
export function DashboardReportsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="adm-panel grid gap-4">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-full rounded-full" />
        {Array.from({ length: 3 }, (_, j) => (
          <div key={j} className="grid gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="adm-panel grid gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-40 w-full rounded-lg sm:h-48" />
      </div>
    </div>
  );
}

/** The overview's catalogue part (everyone): dish tiles and the menu-readiness rows. */
/** The overview's days-ahead tiles: tomorrow's rations for everyone, plus endings for owners and managers. */
export function DashboardDaysSkeleton({ tiles = 2 }: { tiles?: number }) {
  return <TileRow count={tiles} fill />;
}

export function DashboardCatalogueSkeleton() {
  return (
    <>
      <TileRow />
      <Rows count={4} />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-48" />
      <DashboardOrdersSkeleton />
      <DashboardDaysSkeleton />
      <DashboardCatalogueSkeleton />
    </>
  );
}

/** A list with a search box over it (orders). */
function TableSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Skeleton className="h-11 w-full rounded-adm-control sm:max-w-sm" />
        <Skeleton className="h-3.5 w-56 max-w-full" />
      </div>
      <Rows count={8} />
    </>
  );
}

/** A list screen's toolbar panel: the search box and two controls. */
function ToolbarSkeleton() {
  return (
    <div className="adm-panel flex flex-wrap items-center gap-3">
      <Skeleton className="h-11 w-full rounded-adm-control sm:w-auto sm:min-w-56 sm:flex-1" />
      <Skeleton className="h-11 w-44 rounded-adm-control max-sm:flex-1" />
      <Skeleton className="h-11 w-36 rounded-xl" />
    </div>
  );
}

function CardGrid() {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))] sm:gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="adm-panel adm-panel-flush">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="grid gap-2 p-3 sm:p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-1 h-3 w-2/3" />
            <Skeleton className="mt-2 h-5 w-20 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The dishes list (also inside the page, behind its <Suspense>): toolbar, count line, then cards or table rows. */
export function DishesSkeleton({ view }: { view: "cards" | "list" }) {
  return (
    <>
      <ToolbarSkeleton />
      <div className="flex min-h-10 items-center">
        <Skeleton className="h-3.5 w-24" />
      </div>
      {view === "cards" ? <CardGrid /> : <Rows count={8} />}
    </>
  );
}

function CardsSkeleton() {
  return <DishesSkeleton view="cards" />;
}

function FormSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-80 max-w-full" />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="adm-panel grid gap-4">
          <Skeleton className="h-5 w-48" />
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="grid gap-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-11 w-full rounded-adm-control" />
              </div>
            ))}
          </div>
          <Skeleton className="h-10 w-32 rounded-adm-btn" />
        </div>
      ))}
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-5">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="adm-panel grid gap-3">
              <Skeleton className="h-3.5 w-28" />
              <Lines count={3} />
            </div>
          ))}
        </div>
        <div className="grid content-start gap-5">
          <div className="adm-panel grid gap-3">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-10 w-full rounded-adm-btn" />
            <Skeleton className="h-10 w-full rounded-adm-btn" />
          </div>
          <div className="adm-panel grid gap-3">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-28 w-full rounded-adm-control" />
          </div>
        </div>
      </div>
    </>
  );
}
