import Link from "next/link";
import { Suspense } from "react";
import { Lockup } from "@/components/Logo";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { signOut } from "@/lib/admin/actions";
import { requireStaff } from "@/lib/admin/auth";
import { LanguageSwitch } from "../LanguageSwitch";

const NAV = [
  { href: "/", key: "overview", ownerOnly: false },
  { href: "/orders", key: "orders", ownerOnly: true },
  { href: "/menu", key: "menu", ownerOnly: false },
  { href: "/dishes", key: "dishes", ownerOnly: false },
  { href: "/programs", key: "programs", ownerOnly: true },
] as const;

/** Name, role, language switch and sign-out: they depend on the session, so they stream in with it. */
async function Account() {
  const { staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  return (
    <div lang={htmlLang[staff.locale]} className="flex items-center gap-3 sm:gap-4">
      <span className="hidden text-sm text-ivory/70 md:inline">
        {staff.name || staff.email} · {t.roles[staff.role]}
      </span>
      <LanguageSwitch locale={staff.locale} label={t.switcher.label} />
      <form action={signOut}>
        <button type="submit" className="cursor-pointer text-sm text-ivory/70 hover:text-ivory">
          {t.nav.signOut}
        </button>
      </form>
    </div>
  );
}

/** Navigation depends on the role and the language, so it streams in with the session. */
async function Nav() {
  const { staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  return (
    <>
      {NAV.filter((item) => !item.ownerOnly || staff.role === "owner").map((item) => (
        <Link
          key={item.href}
          href={item.href}
          lang={htmlLang[staff.locale]}
          className="whitespace-nowrap border-b-2 border-transparent pb-3 text-ivory/80 hover:border-gold hover:text-ivory"
        >
          {t.nav[item.key]}
        </Link>
      ))}
    </>
  );
}

/** Marks the page content with the person's language (the root <html lang> cannot know it). */
async function Content({ children }: { children: React.ReactNode }) {
  const { staff } = await requireStaff();
  return <div lang={htmlLang[staff.locale]}>{children}</div>;
}

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-dvh bg-ivory">
      <header className="bg-forest text-ivory">
        <div className="container-page flex h-14 items-center justify-between gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 text-lg">
            <Lockup layout="inline" markSize={30} />
            <span className="label hidden text-gold sm:inline">Admin</span>
          </Link>
          <Suspense>
            <Account />
          </Suspense>
        </div>
        <nav className="container-page flex gap-6 overflow-x-auto text-sm">
          <Suspense fallback={<span className="pb-3">&nbsp;</span>}>
            <Nav />
          </Suspense>
        </nav>
      </header>

      <main className="container-page py-8">
        {/* Every panel page checks the session, so it renders per request. */}
        <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-ivory-deep" />}>
          <Content>{children}</Content>
        </Suspense>
      </main>
    </div>
  );
}
