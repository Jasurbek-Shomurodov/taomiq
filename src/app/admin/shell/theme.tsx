"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { InlineScript } from "./InlineScript";

/**
 * The back office's light or dark theme, on <html data-theme>. The person's choice lives in the admin_theme cookie
 * ("light" | "dark", host-only, so the public site never sees it); with no cookie the panel follows the device's
 * system theme, live, until someone picks one with the top bar's toggle.
 *
 * The attribute is set by <ThemeScript /> in the admin <head> while the page is parsed, before the first paint
 * (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md, "Storing the theme in a
 * cookie"). The script reads the cookie itself instead of the server: with Cache Components a cookies() read for an
 * attribute of <html> in the root layout would make every admin route request-bound (migrating-to-cache-components.md).
 * The dark palette (globals.css, .admin) applies on screens only, so paper always prints light.
 */
export type AdminTheme = "light" | "dark";

export const THEME_COOKIE = "admin_theme";
const ATTRIBUTE = "data-theme";
const EVENT = "taomiq-admin-theme";
/** The browser bar per theme: the page colour (--adm-page). */
const BAR_COLOR: Record<AdminTheme, string> = { light: "#f6f1e8", dark: "#0f1513" };
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

// One script for the first paint and for system changes later (it stays in the document across soft navigations:
// the admin has a root layout of its own, so entering it is always a full load). A missing <meta name="theme-color">
// is created; React leaves unknown nodes in <head> alone.
const THEME_SCRIPT = `(function(){try{var d=document.documentElement,q=window.matchMedia(${JSON.stringify(SYSTEM_DARK)}),c=${JSON.stringify(BAR_COLOR)};function s(){var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)/);return m?m[1]:null}function a(){var t=s()||(q.matches?"dark":"light");d.setAttribute(${JSON.stringify(ATTRIBUTE)},t);var b=document.querySelector('meta[name="theme-color"]');if(!b){b=document.createElement("meta");b.name="theme-color";document.head.appendChild(b)}b.content=c[t]}a();q.addEventListener("change",function(){if(!s()){a();window.dispatchEvent(new Event(${JSON.stringify(EVENT)}))}})}catch(e){}})()`;

function savedTheme(): AdminTheme | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)`));
  return match ? (match[1] as AdminTheme) : null;
}

function applyTheme(theme: AdminTheme) {
  document.documentElement.setAttribute(ATTRIBUTE, theme);
  let bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!bar) {
    bar = document.createElement("meta");
    bar.name = "theme-color";
    document.head.appendChild(bar);
  }
  bar.content = BAR_COLOR[theme];
}

/**
 * In the admin root layout's <head>. Also re-applies the theme after mount: React's Strict Mode remount in
 * development resets <html> to the attributes it renders, clearing the script's (a no-op in production).
 */
export function ThemeScript() {
  useLayoutEffect(() => {
    const theme = savedTheme() ?? (window.matchMedia(SYSTEM_DARK).matches ? "dark" : "light");
    if (document.documentElement.getAttribute(ATTRIBUTE) === theme) return;
    applyTheme(theme);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return <InlineScript html={THEME_SCRIPT} />;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

const currentTheme = (): AdminTheme => (document.documentElement.getAttribute(ATTRIBUTE) === "dark" ? "dark" : "light");

/** The theme on screen. "light" on the server and during hydration (the server cannot know it), the real one after. */
export function useAdminTheme(): AdminTheme {
  return useSyncExternalStore(subscribe, currentTheme, () => "light");
}

/** The person's choice: saved for a year on this device and browser, and from now on the system theme is ignored. */
export function setAdminTheme(theme: AdminTheme) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}
