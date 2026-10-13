"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { isAdmin } from "@/lib/admin";

/** Shortcut to /admin, shown only when the server says this account is an admin. */
export function AdminLink() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    isAdmin().then((ok) => alive && setAdmin(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (!admin) return null;
  return (
    <div className="flex justify-center mt-3">
      <Link
        href="/admin"
        prefetch={false}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-uqu-accent hover:bg-uqu-accent/10"
      >
        <BarChart3 className="w-4 h-4" aria-hidden />
        لوحة الإدارة
      </Link>
    </div>
  );
}
