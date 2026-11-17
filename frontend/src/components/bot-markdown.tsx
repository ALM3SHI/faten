"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { Button } from "@/components/ds/button";
import { linkPageRefs, slideFromHref } from "@/lib/tutor";

/**
 * BotMarkdown
 * ────────────────────────────────────────────────────────────────
 * Renders AI replies as Markdown with GFM extensions enabled, so the
 * agent can output tables, task lists, strikethrough, and autolinks
 * and they render natively in the chat bubble.
 *
 *   • Tables get a polished striped look (great for course comparisons,
 *     weekly plans, grade summaries).
 *   • Internal links (`/plan`, `/dashboard`, …) use Next.js <Link> so
 *     navigation is a soft SPA transition, not a hard reload — same
 *     soft-nav contract as the manual CTA buttons.
 *   • Code blocks render as a quiet card; inline `code` keeps its
 *     monospace styling without breaking RTL line flow.
 *   • All overrides go through `components={...}` — we don't depend
 *     on @tailwindcss/typography (the `prose` plugin isn't installed
 *     in this project, and adding it would touch the global theme).
 */

const INTERNAL_PATH_RE = /^\/[a-zA-Z0-9_\-/?&=#%.]*$/;

/**
 * `onSlide` (study mode): citations like «[ص 12]» become buttons that open
 * page 12 of the original lecture. Without it nothing changes.
 */
export function BotMarkdown({ content, onSlide }: { content: string; onSlide?: (page: number) => void }) {
  return (
    <div className="break-words text-body text-inherit [&_p]:my-0 [&_p+p]:mt-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── Block-level ──────────────────────────────────────
          p: ({ children }) => (
            <p className="whitespace-pre-wrap">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1.5 text-heading font-bold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1 text-subheading font-bold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2.5 mb-1 text-body font-bold">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-1 ps-5 marker:text-ink-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-1 ps-5 marker:text-ink-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-s-2 border-brand ps-3 text-ink-muted">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-line" />,
          strong: ({ children }) => (
            <strong className="font-bold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,

          // ── Tables (the big win) ─────────────────────────────
          // Wrapped in a horizontally scrollable container so a wide
          // 8-column weekly schedule doesn't blow out the chat bubble.
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-control border border-line">
              <table className="nums w-full border-collapse text-small">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-sunken text-ink">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="[&>tr:nth-child(even)]:bg-surface-sunken/60">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-line last:border-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="whitespace-nowrap px-3 py-2 text-start font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-start align-top">{children}</td>
          ),

          // ── Inline & code ────────────────────────────────────
          a: ({ href, children }) => {
            const raw = typeof href === "string" ? href : "";
            const slide = onSlide ? slideFromHref(raw) : null;
            if (slide !== null && onSlide) {
              return (
                <Button
                  size="sm"
                  onClick={() => onSlide(slide)}
                  className="mx-0.5 h-auto min-h-0 rounded-control border-info-line bg-info-soft px-1.5 py-0.5 align-baseline text-caption font-semibold text-info-ink hover:border-info-ink hover:bg-info-soft"
                >
                  {children}
                </Button>
              );
            }
            // Internal path → Next.js <Link> for SPA soft-nav.
            if (raw && INTERNAL_PATH_RE.test(raw)) {
              return (
                <Link
                  href={raw}
                  className="rounded-sm font-semibold text-info-ink underline underline-offset-2 hover:no-underline focus-ring"
                >
                  {children}
                </Link>
              );
            }
            // External → safe new-tab anchor.
            return (
              <a
                href={raw}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm font-semibold text-info-ink underline underline-offset-2 hover:no-underline focus-ring"
              >
                {children}
              </a>
            );
          },
          code: ({ className, children, ...props }) => {
            // ReactMarkdown gives block code a language-* class; inline
            // code has no className. Use that signal — `inline` was
            // removed from the prop list in react-markdown v9.
            const isBlock = typeof className === "string"
              && className.startsWith("language-");
            if (isBlock) {
              return (
                <pre className="my-2 overflow-x-auto rounded-control border border-line bg-surface-sunken p-3 font-mono text-small text-ink" dir="ltr">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code className="rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-small">
                {children}
              </code>
            );
          },
        }}
      >
        {onSlide ? linkPageRefs(content) : content}
      </ReactMarkdown>
    </div>
  );
}
