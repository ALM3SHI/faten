"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
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
    <div className="text-[15px] leading-relaxed text-foreground break-words [&_p]:my-0 [&_p+p]:mt-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── Block-level ──────────────────────────────────────
          p: ({ children }) => (
            <p className="whitespace-pre-wrap">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="text-lg font-black mt-3 mb-1.5">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-bold mt-3 mb-1">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[15px] font-bold mt-2.5 mb-1">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pr-5 my-1.5 space-y-0.5 marker:text-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pr-5 my-1.5 space-y-0.5 marker:text-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-r-2 border-uqu-accent/50 pr-3 text-muted italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-foreground/10" />,
          strong: ({ children }) => (
            <strong className="font-bold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,

          // ── Tables (the big win) ─────────────────────────────
          // Wrapped in a horizontally scrollable container so a wide
          // 8-column weekly schedule doesn't blow out the chat bubble.
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-xl border border-foreground/10 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-foreground/15 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-[13px] border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-uqu-accent/10 text-foreground">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="[&>tr:nth-child(even)]:bg-foreground/[0.03]">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-foreground/5 last:border-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-right align-top">{children}</td>
          ),

          // ── Inline & code ────────────────────────────────────
          a: ({ href, children }) => {
            const raw = typeof href === "string" ? href : "";
            const slide = onSlide ? slideFromHref(raw) : null;
            if (slide !== null && onSlide) {
              return (
                <button
                  type="button"
                  onClick={() => onSlide(slide)}
                  className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-uqu-accent/10 border border-uqu-accent/25 text-uqu-accent text-[12px] font-bold hover:bg-uqu-accent/20 transition-colors align-baseline"
                >
                  {children}
                </button>
              );
            }
            // Internal path → Next.js <Link> for SPA soft-nav.
            if (raw && INTERNAL_PATH_RE.test(raw)) {
              return (
                <Link
                  href={raw}
                  className="text-uqu-accent font-bold underline underline-offset-2 hover:text-uqu-cyan transition-colors"
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
                className="text-uqu-accent font-bold underline underline-offset-2 hover:text-uqu-cyan transition-colors"
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
                <pre className="my-2 p-3 rounded-xl bg-foreground/5 border border-foreground/10 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-foreground/90">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code className="px-1.5 py-0.5 rounded-md bg-foreground/5 border border-foreground/10 font-mono text-[12.5px]">
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
