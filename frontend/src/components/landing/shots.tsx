import { cn } from "@/lib/utils";

/**
 * Real product screenshots (public/landing, regenerated with
 * `npm run capture:landing`). Each shot exists in both themes; the one that
 * doesn't match the page is `display: none`, and lazy images that are not
 * displayed are never downloaded.
 */
function ThemedShot({
  name,
  alt,
  width,
  height,
  eager = false,
  className,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  /** Above-the-fold shot: load the default (dark) theme's image right away. */
  eager?: boolean;
  className?: string;
}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer */}
      <img
        src={`/landing/${name}-dark.webp`}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        className={cn("hidden w-full h-auto", className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer */}
      <img
        src={`/landing/${name}-light.webp`}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={cn("block w-full h-auto", className)}
      />
    </>
  );
}

/** A desktop screenshot inside a browser window. */
export function BrowserShot({
  name,
  alt,
  eager,
  className,
}: {
  name: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-card border border-line bg-surface shadow-card ",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-sunken px-4 py-2.5" aria-hidden dir="ltr">
        <span className="h-2.5 w-2.5 rounded-full bg-surface-sunken" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-sunken" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-sunken" />
        <span className="mx-auto rounded-md bg-surface-sunken px-10 py-0.5 text-caption text-ink-muted">
          fatenai.web.app
        </span>
      </div>
      <ThemedShot name={name} alt={alt} width={1920} height={1200} eager={eager} />
    </figure>
  );
}

/** A phone screenshot inside a device bezel. */
export function PhoneShot({ name, alt, className }: { name: string; alt: string; className?: string }) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-neutral-900 shadow-card ",
        className,
      )}
    >
      <ThemedShot name={name} alt={alt} width={780} height={1688} className="rounded-[1.6rem]" />
    </figure>
  );
}
