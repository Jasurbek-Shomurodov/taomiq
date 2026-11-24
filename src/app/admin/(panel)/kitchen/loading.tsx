import { Skeleton } from "../../kit/Skeleton";
import { LoadingStatus } from "../../shell/ShellLocale";

/** Production sheet: three figure tiles, then one table panel per meal slot. */
export default function Loading() {
  return (
    <div className="adm-page" aria-busy="true">
      <LoadingStatus />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="adm-panel grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="size-8 rounded-adm-control" />
            </div>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3.5 w-40" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="adm-panel adm-panel-flush">
          <div className="adm-panel-head">
            <div className="grid gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="adm-table-head flex h-10 items-center px-4">
            <Skeleton className="h-3 w-40" />
          </div>
          {Array.from({ length: 3 }, (_, j) => (
            <div key={j} className="adm-row flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
