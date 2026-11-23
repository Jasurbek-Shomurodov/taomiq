"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * "Kirish / Войти" in the header and the mobile menu; "Kabinet / Кабинет" once signed in.
 * Marketing pages stay static: the server always renders the signed-out link, and the browser swaps it
 * after reading its own session cookie (no network call unless the token needs refreshing). It looks
 * again on every page change, so signing in or out through a server action shows up at once.
 * Display only: /account and every server action check the session with the auth server.
 * Rendered only when sign-in is switched on (NEXT_PUBLIC_AUTH_METHODS), see SiteChrome.
 */
export function AccountLink({
  locale,
  labels,
  className,
}: {
  locale: Locale;
  labels: { login: string; account: string };
  className?: string;
}) {
  const pathname = usePathname() ?? `/${locale}`;
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let current = true;
    createBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (current) setSignedIn(Boolean(data.session));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [pathname]);

  const onAuthPage = pathname.startsWith(`/${locale}/login`) || pathname.startsWith(`/${locale}/account`);
  const href = signedIn
    ? `/${locale}/account`
    : onAuthPage
      ? `/${locale}/login`
      : `/${locale}/login?next=${encodeURIComponent(pathname)}`;

  return (
    <Link href={href} prefetch={false} className={className}>
      <svg aria-hidden width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10" cy="7" r="3.25" />
        <path d="M3.75 17c.9-3 3.3-4.5 6.25-4.5S15.35 14 16.25 17" strokeLinecap="round" />
      </svg>
      {signedIn ? labels.account : labels.login}
    </Link>
  );
}
