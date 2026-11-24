import { Skeleton } from "../kit/Skeleton";

/**
 * The frame while the session is checked (first load only: the layout stays mounted between pages). Same boxes as
 * the shell, so nothing jumps when it arrives; the page area is left to the page's own loading.tsx skeleton.
 */
export function ShellFallback({ children }: { children?: React.ReactNode }) {
  return (
    <div className="adm-shell" aria-busy="true">
      <div className="adm-rail" aria-hidden="true">
        <div className="adm-sidebar gap-6 p-4">
          <Skeleton className="h-8 w-40" />
          <div className="grid gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="adm-topbar" aria-hidden="true">
          <div className="adm-topbar-lead">
            <Skeleton className="h-5 w-36" />
          </div>
        </div>
        <main className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
