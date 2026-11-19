import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "غرفة الأخبار | كشيدة",
  description: "تيار الأخبار من المصادر التي تختارها غرفة التحرير.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
