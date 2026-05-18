import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: "المساعد الأكاديمي الذكي — UQU",
  description: "المساعد الأكاديمي الذكي لجامعة أم القرى — منصة متكاملة للمحادثة، حساب المعدل، وخطط المذاكرة",
};

import { AuthProvider } from "@/components/auth-provider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Inline pre-hydration script: read the saved theme from localStorage and
  // apply the `dark` class on <html> BEFORE React boots. This avoids the
  // flash-of-wrong-theme on first paint and prevents hydration mismatch.
  // Defaults to dark so existing users keep the look they expect.
  const themeBootScript = `
    (function() {
      try {
        var saved = localStorage.getItem('uqu-theme');
        var isDark = saved ? saved === 'dark' : true;
        if (isDark) document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
      } catch (e) {
        document.documentElement.classList.add('dark');
      }
    })();
  `;

  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={`${cairo.variable} font-sans antialiased`} suppressHydrationWarning>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
