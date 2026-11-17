"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ds/button";
import { ExternalLink, Newspaper, RefreshCw } from "lucide-react";
import { PanelRoot } from "@/components/dashboard/panel-root";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NewsItem {
  title: string;
  link: string;
  published: string | null;
  summary: string;
  image: string | null;
}

const DATE_AR = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long" });

function relative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  if (days <= 6) return `قبل ${days} أيام`;
  return DATE_AR.format(d);
}

export function UniversityNewsCard({ bare, limit = 5 }: { bare?: boolean; limit?: number } = {}) {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/news?limit=5")
      .then((data: { items?: NewsItem[] }) => {
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <PanelRoot bare={bare} className="border border-line bg-surface shadow-card p-6 md:p-8 rounded-card h-full flex flex-col">
      <div className={cn("flex items-center justify-between gap-3", bare ? "mb-2" : "mb-4")}>
        <h3 className={cn("text-heading font-bold flex items-center gap-2", bare && "sr-only")}>
          <Newspaper className="w-5 h-5 text-info-ink" />
          أخبار الجامعة
        </h3>
        <a
          href="https://uqu.edu.sa/App/News"
          target="_blank"
          rel="noopener noreferrer"
          className="text-caption font-bold text-info-ink hover:underline flex items-center gap-1"
        >
          كل الأخبار <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="flex-1 space-y-2">
        {items === null ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-card bg-surface-sunken animate-pulse" />
          ))
        ) : items.length === 0 ? (
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center gap-3 text-small text-ink-muted text-center border-2 border-dashed border-line rounded-card p-4">
            {failed ? "تعذّر جلب الأخبار الآن." : "لا توجد أخبار حالياً."}
            <Button variant="bare"
              type="button"
              onClick={() => {
                setItems(null);
                setReloadKey((k) => k + 1);
              }}
              className="text-caption font-bold text-info-ink flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> إعادة المحاولة
            </Button>
          </div>
        ) : (
          items.slice(0, limit).map((n) => (
            <a
              key={n.link}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "group flex items-center gap-3 p-3 rounded-card border border-line bg-surface-sunken",
                "hover:border-info-line hover:bg-info-soft transition-colors",
              )}
            >
              {n.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.image} alt="" loading="lazy" className="w-12 h-12 rounded-control object-cover shrink-0 bg-surface-sunken" />
              ) : (
                <div className="w-12 h-12 rounded-control bg-info-soft flex items-center justify-center shrink-0">
                  <Newspaper className="w-5 h-5 text-info-ink" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-small font-bold leading-snug line-clamp-2 group-hover:text-info-ink">{n.title}</div>
                <div className="text-caption text-ink-muted mt-0.5">{relative(n.published)}</div>
              </div>
            </a>
          ))
        )}
      </div>
      <p className="mt-3 text-caption text-ink-muted text-center">المصدر: الموقع الرسمي لجامعة أم القرى</p>
    </PanelRoot>
  );
}
