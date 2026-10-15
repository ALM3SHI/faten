"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath, normalizePath } from "@/lib/routes";
import { NO_APP_NAV, sectionFor } from "@/lib/nav";
import { useSectionLinks } from "@/components/nav-sections";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoMark } from "@/components/logo";

import { useAuth } from "@/components/auth-provider";
import { useProfileStore } from "@/store/profileStore";
import { AccountMenu } from "@/components/account-menu";

export function Navbar() {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const profileName = useProfileStore((s) => s.basic.name.trim());
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = useSectionLinks();
  const activeSection = sectionFor(pathname)?.id;
  // Phones use the bottom bar; the ☰ menu only exists where that bar is hidden.
  const showMenuButton = NO_APP_NAV.has(normalizePath(pathname));

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile menu after navigation
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300 h-16 border-b",
          scrolled
            ? "bg-background/80 backdrop-blur-xl border-border shadow-lg"
            : "bg-transparent border-transparent"
        )}
      >
        <div className="container mx-auto h-full flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-6">
            <Link href="/" prefetch={false} className="flex items-center gap-2 group" aria-label="فطن — الصفحة الرئيسية">
              <LogoMark />
              <div className="hidden md:block">
                <span className="font-bold text-lg">فطن</span>
              </div>
            </Link>

            {/* prefetch={false} on app links: prefetching every tab pulled the heavy
                routes (map data, PDF reader, charts) into whatever page was open. */}
            <nav className="hidden lg:block" aria-label="الأقسام">
              <ul className="flex items-center gap-1">
                {sections.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      aria-current={activeSection === item.id ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors",
                        activeSection === item.id
                          ? "text-uqu-accent bg-uqu-accent/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      <item.Icon className="w-4 h-4" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />

            {authLoading ? (
              <div
                className="h-1.5 w-8 rounded-full bg-muted-foreground/30 animate-pulse"
                aria-hidden
              />
            ) : user ? (
              <AccountMenu
                name={profileName || user.displayName || user.email?.split("@")[0] || ""}
                active={["/profile", "/locations", "/community", "/admin"].some((h) => isActivePath(pathname, h))}
              />
            ) : (
              <Link href="/login">
                <Button size="sm" className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white font-bold px-6">
                  دخول
                </Button>
              </Link>
            )}

            {showMenuButton && (
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden rounded-full"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? "إغلاق القائمة" : "فتح القائمة"}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileOpen && showMenuButton && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <nav aria-label="الأقسام" className="absolute top-16 left-0 right-0 bg-background/95 backdrop-blur-xl border-b border-foreground/10 shadow-2xl animate-in slide-in-from-top-2 duration-200">
            <ul className="container mx-auto px-4 py-4 space-y-1">
              {sections.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                  >
                    <item.Icon className="w-5 h-5" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
