import { LoadingStatus } from "../shell/ShellLocale";

/** One shimmering block. Size and shape come from className (h-*, w-*, rounded-*). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`adm-skeleton ${className}`} />;
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

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="adm-panel grid gap-3">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
      <Rows count={4} />
    </>
  );
}

function TableSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-72 max-w-full" />
      <Rows count={8} />
    </>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="adm-panel adm-panel-flush">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="grid gap-2 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
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
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
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
