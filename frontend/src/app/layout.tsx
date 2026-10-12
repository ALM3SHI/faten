import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SITE } from "@/lib/site";

// Cairo variable font, self-hosted (SIL OFL — see fonts/OFL-Cairo.txt).
// Bundling it removes the build-time fetch from Google Fonts, so builds work
// offline and the site never depends on a third-party font CDN.
const cairo = localFont({
  src: [
    { path: "./fonts/cairo-arabic-wght-normal.woff2", weight: "200 1000", style: "normal" },
    { path: "./fonts/cairo-latin-wght-normal.woff2", weight: "200 1000", style: "normal" },
  ],
  variable: "--font-cairo",
  display: "swap",
});

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
};

export const metadata: Metadata = {
  title: "فطن — المساعد الأكاديمي لجامعة أم القرى",
  applicationName: "فطن",
  appleWebApp: { capable: true, title: "فطن", statusBarStyle: "black-translucent" },
  description: "اسأل عن لوائح أم القرى وتصلك الإجابة بالمادة الرسمية، وتابع معدلك، ونظّم مذاكرتك وجدولك في مكان واحد.",
  metadataBase: new URL(SITE.url),
  openGraph: {
    type: "website",
    locale: "ar_SA",
    siteName: "فطن",
    title: "فطن — المساعد الأكاديمي لجامعة أم القرى",
    description: "لوائح الجامعة بالمادة الرسمية، معدلك، جدولك، غيابك ومذاكرتك — في مكان واحد.",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "فطن" }],
  },
  twitter: {
    card: "summary",
    title: "فطن — المساعد الأكاديمي لجامعة أم القرى",
    description: "لوائح الجامعة بالمادة الرسمية، معدلك، جدولك، غيابك ومذاكرتك — في مكان واحد.",
    images: ["/icon-512.png"],
  },
};

import { AuthProvider } from "@/components/auth-provider";
import { ToastProvider } from "@/components/toast-provider";
import { RouteGuard } from "@/components/route-guard";
import { BackendWarmup } from "@/components/backend-warmup";
import { BottomNav } from "@/components/bottom-nav";

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
          <ToastProvider>
            <BackendWarmup />
            <RouteGuard>{children}</RouteGuard>
            <BottomNav />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
