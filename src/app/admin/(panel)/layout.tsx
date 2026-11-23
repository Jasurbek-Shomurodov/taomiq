import Link from "next/link";
import { Suspense } from "react";
import { Lockup } from "@/components/Logo";
import { signOut } from "@/lib/admin/actions";
import { requireStaff } from "@/lib/admin/auth";

const NAV = [
  { href: "/", label: "Обзор", ownerOnly: false },
  { href: "/orders", label: "Заказы", ownerOnly: true },
  { href: "/menu", label: "Меню на 30 дней", ownerOnly: false },
  { href: "/dishes", label: "Блюда", ownerOnly: false },
  { href: "/programs", label: "Программы и цены", ownerOnly: true },
];

const ROLE_LABELS = { owner: "Владелец", admin: "Администратор" } as const;

async function CurrentUser() {
  const { staff } = await requireStaff();
  return (
    <span className="hidden text-sm text-ivory/70 sm:inline">
      {staff.name || staff.email} · {ROLE_LABELS[staff.role]}
    </span>
  );
}

/** Navigation depends on the role, so it streams in with the session. */
async function Nav() {
  const { staff } = await requireStaff();
  return (
    <>
      {NAV.filter((item) => !item.ownerOnly || staff.role === "owner").map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="whitespace-nowrap border-b-2 border-transparent pb-3 text-ivory/80 hover:border-gold hover:text-ivory"
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh bg-ivory">
      <header className="bg-forest text-ivory">
        <div className="container-page flex h-14 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 text-lg">
            <Lockup layout="inline" markSize={30} />
            <span className="label text-gold">Admin</span>
          </Link>
          <div className="flex items-center gap-4">
            <Suspense>
              <CurrentUser />
            </Suspense>
            <form action={signOut}>
              <button type="submit" className="cursor-pointer text-sm text-ivory/70 hover:text-ivory">
                Выйти
              </button>
            </form>
          </div>
        </div>
        <nav className="container-page flex gap-6 overflow-x-auto text-sm">
          <Suspense fallback={<span className="pb-3">&nbsp;</span>}>
            <Nav />
          </Suspense>
        </nav>
      </header>

      <main className="container-page py-8">
        {/* Every panel page checks the session, so it renders per request. */}
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-ivory-deep" />}>{children}</Suspense>
      </main>
    </div>
  );
}
