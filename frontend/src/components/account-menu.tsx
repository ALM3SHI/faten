"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, MapPin, MessagesSquare, User, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCOUNT_LINKS } from "@/lib/nav";
import { isAdmin } from "@/lib/admin";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof User> = {
  "/profile": UserCog,
  "/locations": MapPin,
  "/community": MessagesSquare,
  "/admin": BarChart3,
};

/**
 * The avatar menu: everything that is not one of the four spaces —
 * profile and goals, rooms and the indoor map, course reviews, and the
 * admin dashboard for admins.
 */
export function AccountMenu({ name, active }: { name: string; active: boolean }) {
  const router = useRouter();
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    isAdmin()
      .then((ok) => alive && setAdmin(ok))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const links = ACCOUNT_LINKS.filter((l) => !l.adminOnly || admin);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="حسابي والقائمة"
        className={cn(
          "flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-foreground/5 outline-none focus-visible:ring-2 focus-visible:ring-uqu-accent/50 transition-colors",
          active && "bg-uqu-accent/10",
        )}
      >
        <span className="w-8 h-8 rounded-full bg-uqu-accent/15 flex items-center justify-center text-uqu-accent font-black text-sm" aria-hidden>
          {name ? name.trim().charAt(0) : <User className="w-4 h-4" />}
        </span>
        <span className="hidden xl:inline text-xs font-bold text-foreground max-w-32 truncate">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px] p-1.5">
        {name && (
          <>
            <div className="px-2.5 py-2">
              <div className="text-sm font-black truncate">{name}</div>
              <div className="text-xs text-muted-foreground">حسابك والقائمة</div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        {links.map((l) => {
          const Icon = ICONS[l.href] ?? User;
          return (
            <DropdownMenuItem
              key={l.href}
              onClick={() => router.push(l.href)}
              className="gap-2.5 px-2.5 py-2 text-sm font-semibold"
            >
              <Icon className="w-4 h-4 text-muted-foreground" aria-hidden />
              {l.label}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push("/privacy")}
          className="gap-2.5 px-2.5 py-2 text-xs text-muted-foreground"
        >
          الخصوصية والشروط
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
