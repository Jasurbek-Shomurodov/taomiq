import type { Metadata } from "next";
import { Manrope, Noto_Serif_Display } from "next/font/google";
import "../globals.css";

const serif = Noto_Serif_Display({
  variable: "--font-noto-serif-display",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
});
const sans = Manrope({ variable: "--font-manrope", subsets: ["latin", "latin-ext", "cyrillic"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "TAOMIQ Admin", template: "%s · TAOMIQ Admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    <html lang="ru" className={`${serif.variable} ${sans.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
