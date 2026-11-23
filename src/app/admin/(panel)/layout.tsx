import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { signOut } from "@/lib/admin/actions";
import { requireStaff } from "@/lib/admin/auth";

const NAV = [
  { href: "/", label: "Обзор" },
  { href: "/menu", label: "Меню на 30 дней" },
  { href: "/dishes", label: "Блюда" },
  { href: "/programs", label: "Программы и цены" },
];

async function CurrentUser() {
  const { staff } = await requireStaff();
  return <span className="hidden text-sm text-ivory/70 sm:inline">{staff.name || staff.email}</span>;
}

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh bg-ivory">
      <header className="bg-forest text-ivory">
        <div className="container-page flex h-14 items-center justify-between gap-4">
          <Link href="/" className="flex items-baseline gap-2 text-lg">
            <Logo onDark />
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
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap border-b-2 border-transparent pb-3 text-ivory/80 hover:border-gold hover:text-ivory"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="container-page py-8">
        {/* Every panel page checks the session, so it renders per request. */}
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-ivory-deep" />}>{children}</Suspense>
      </main>
    </div>
  );
}
