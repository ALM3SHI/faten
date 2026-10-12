import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Faten brand mark — the same gradient tile everywhere (navbar, login,
 * landing page) so the product reads as one identity. The browser icon
 * (app/icon.svg) is drawn from the same colours.
 */
export function LogoMark({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-uqu-accent to-uqu-cyan text-white shadow-lg shadow-uqu-accent/25",
        className ?? "w-9 h-9",
      )}
      aria-hidden
    >
      <GraduationCap className={cn("w-5 h-5", iconClassName)} strokeWidth={2.2} />
    </span>
  );
}
