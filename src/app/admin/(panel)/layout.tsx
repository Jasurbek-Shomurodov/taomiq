import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { PageSkeleton } from "../kit/Skeleton";
import { AdminShell } from "../shell/AdminShell";
import { NAV } from "../shell/nav";
import { NewOrdersBadge } from "../shell/NewOrdersBadge";
import { RailScript } from "../shell/rail";
import { TeamRequestsBadge } from "../shell/TeamRequestsBadge";
import { ShellFallback } from "../shell/ShellFallback";

/**
 * The frame depends on the session (rows for the role, labels in the person's language, the account), so it
 * streams in with it behind a frame-shaped fallback. Every panel page checks the session too (requireStaff is
 * memoised per request), so it renders per request.
 */
async function Shell({ children }: { children: React.ReactNode }) {
  const { staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const isOwner = staff.role === "owner";

  return (
    <AdminShell
      lang={htmlLang[staff.locale]}
      locale={staff.locale}
      items={NAV.filter((item) => !item.ownerOnly || isOwner).map((item) => ({ key: item.key, label: t.nav[item.key] }))}
      badges={{
        // Orders hold personal data: only the owner sees the row and its count. Its own boundary, so a slow or
        // failed count never holds up the frame.
        orders: isOwner ? (
          <Suspense fallback={null}>
            <NewOrdersBadge />
          </Suspense>
        ) : null,
        // People waiting for access (emails are personal data): owner only, its own boundary like the orders count.
        team: isOwner ? (
          <Suspense fallback={null}>
            <TeamRequestsBadge />
          </Suspense>
        ) : null,
      }}
      account={{ name: staff.name, email: staff.email, role: t.roles[staff.role] }}
      labels={{
        mainNav: t.shell.mainNav,
        openMenu: t.shell.openMenu,
        closeMenu: t.shell.closeMenu,
        collapse: t.shell.collapse,
        home: t.shell.home,
        signOut: t.nav.signOut,
        switcher: t.switcher.label,
        groups: t.shell.groups,
      }}
    >
      {children}
    </AdminShell>
  );
}

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      {/* Before the frame: folds a rail the person folded last time, ahead of the first paint. */}
      <RailScript />
      <Suspense
        fallback={
          <ShellFallback>
            <PageSkeleton layout="table" />
          </ShellFallback>
        }
      >
        <Shell>{children}</Shell>
      </Suspense>
    </>
  );
}
