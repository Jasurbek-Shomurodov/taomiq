import type { Metadata } from "next";
import { Manrope, Noto_Serif_Display } from "next/font/google";
import "../globals.css";
import "./admin.css";
import { ThemeScript } from "./shell/theme";

const serif = Noto_Serif_Display({
  variable: "--font-noto-serif-display",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "800"], // 800: the TQ monogram (components/Logo.tsx)
  display: "swap",
});
const sans = Manrope({ variable: "--font-manrope", subsets: ["latin", "latin-ext", "cyrillic"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "TAOMIQ Admin", template: "%s · TAOMIQ Admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    // suppressHydrationWarning: inline scripts set data-* attributes on <html> before the first paint (the theme,
    // shell/theme.tsx; the folded sidebar, shell/rail.tsx), which React would otherwise report as a mismatch.
    <html lang="ru" className={`${serif.variable} ${sans.variable} antialiased`} suppressHydrationWarning>
      <head>
        {/* Light or dark from the admin_theme cookie, else the system theme, before anything is painted. */}
        <ThemeScript />
      </head>
      {/* .admin scopes the back-office kit tokens (--adm-* in globals.css). */}
      <body className="admin min-h-dvh">{children}</body>
    </html>
  );
}
