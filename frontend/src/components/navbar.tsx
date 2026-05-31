"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

const navItems = [
  { name: "اللوحة", href: "/dashboard" },
  { name: "الدردشة", href: "/chat" },
  { name: "المعدل", href: "/gpa" },
  { name: "الخطة", href: "/plan" },
  { name: "بومودورو", href: "/pomodoro" },
  { name: "القاعات", href: "/locations" },
  { name: "البروفايل", href: "/profile" },
];

import { useAuth } from "@/components/auth-provider";
import { useProfileStore } from "@/store/profileStore";
import { User } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const profileName = useProfileStore((s) => s.basic.name.trim());
  const [scrolled, setScrolled] = useState(false);
  // Source of truth on the client is the `.dark` class set by the inline
  // boot script in app/layout.tsx. We mirror that into local state on mount
  // so React-rendered icons (Sun/Moon) match the actual document state.
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Sync local state with whatever the pre-hydration script applied.
  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("uqu-theme", next);
    } catch {
      // localStorage may be unavailable (private mode, etc.) — non-fatal.
    }
  };

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
              <div className="w-9 h-9 bg-gradient-to-br from-uqu-accent to-uqu-cyan rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-uqu-accent/25 transition-shadow">
                <span className="text-xl">🎓</span>
              </div>
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
                        pathname === item.href
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
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-full"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>

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
                <Button size="sm" className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 text-foreground font-bold px-6">
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
                      pathname === item.href
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
