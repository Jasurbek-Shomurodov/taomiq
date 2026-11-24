"use client";

import { Moon, Sun } from "lucide-react";
import { setAdminTheme, useAdminTheme } from "./theme";

export type ThemeLabels = { dark: string; toDark: string; toLight: string };

/**
 * The top bar's light/dark switch, after the page actions. One accessible name ("Dark theme") with its state in
 * aria-pressed; the tooltip says what a press will do. Both icons are in the markup and CSS shows the one for the
 * theme on <html> (admin.css), so the icon is right from the first paint, before React knows the theme.
 */
export function ThemeToggle({ labels }: { labels: ThemeLabels }) {
  const dark = useAdminTheme() === "dark";
  return (
    <button
      type="button"
      onClick={() => setAdminTheme(dark ? "light" : "dark")}
      aria-label={labels.dark}
      aria-pressed={dark}
      title={dark ? labels.toLight : labels.toDark}
      className="adm-btn adm-btn-outline adm-btn-icon"
    >
      <Moon aria-hidden="true" className="adm-theme-moon" />
      <Sun aria-hidden="true" className="adm-theme-sun" />
    </button>
  );
}
