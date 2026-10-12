"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoMark } from "@/components/logo";

const navItems = [
  { name: "اللوحة", href: "/dashboard" },
  { name: "الدردشة", href: "/chat" },
  { name: "المعدل", href: "/gpa" },
  { name: "الخطة", href: "/plan" },
  { name: "الغياب", href: "/attendance" },
  { name: "بومودورو", href: "/pomodoro" },
  { name: "القاعات", href: "/locations" },
  { name: "المجتمع", href: "/community" },
  { name: "الملف الشخصي", href: "/profile" },
];

import { useAuth } from "@/components/auth-provider";
import { useProfileStore } from "@/store/profileStore";
import { User } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const profileName = useProfileStore((s) => s.basic.name.trim());
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
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
            <Link href="/" className="flex items-center gap-2 group">
              <LogoMark />
              <div className="hidden md:block">
                <span className="font-bold text-lg">فطن</span>
              </div>
            </Link>

            <nav className="hidden lg:block">
              <ul className="flex items-center gap-1">
                {navItems.filter(i => i.href !== '/profile' || user).map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                        isActivePath(pathname, item.href)
                          ? "text-uqu-accent bg-uqu-accent/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      )}
                    >
                      {item.name}
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
              <Link href="/profile">
                <Button variant="ghost" size="sm" className="rounded-xl gap-2 hover:bg-foreground/5">
                  <div className="w-8 h-8 rounded-full bg-uqu-accent/20 flex items-center justify-center text-uqu-accent">
                     <User className="w-4 h-4" />
                  </div>
                  <span className="hidden sm:inline text-xs font-bold text-foreground">
                    {profileName || user.displayName || user.email?.split("@")[0]}
                  </span>
                </Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button size="sm" className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-white font-bold px-6">
                  دخول
                </Button>
              </Link>
            )}

            <Button 
              variant="ghost" 
              size="icon" 
              className="lg:hidden rounded-full"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <nav className="absolute top-16 left-0 right-0 bg-background/95 backdrop-blur-xl border-b border-foreground/10 shadow-2xl animate-in slide-in-from-top-2 duration-200">
            <ul className="container mx-auto px-4 py-4 space-y-1">
              {navItems.filter(i => i.href !== '/profile' || user).map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center px-4 py-3 rounded-xl text-sm font-bold transition-colors",
                      isActivePath(pathname, item.href)
                        ? "text-uqu-accent bg-uqu-accent/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                    )}
                  >
                    {item.name}
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
