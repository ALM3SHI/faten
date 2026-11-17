"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, ImageIcon, Loader2, Shapes } from "lucide-react";
import { Button } from "@/components/ds/button";
import { Diagram } from "@/components/tutor/diagram";
import { renderLecturePage } from "@/components/tutor/slide-viewer";
import { loadVisual, type Visual } from "@/lib/tutor";

/**
 * The one picture of a lesson part (backend: services/tutor/visuals.py):
 *   diagram  drawn from the lecture by the app
 *   slide    the page of the student's own file, rendered on this device
 *   photo    a freely licensed Wikimedia Commons picture the tutor looked at
 *            first; while it is still being looked up, a quiet placeholder
 *            asks again a few times and disappears if nothing fits.
 * Every picture says where it comes from.
 */
/** Which lecture the conversation belongs to (set once by the tutor page). */
export const LectureRef = createContext<{ id: string; fileHash: string } | null>(null);

export function LessonVisual({
  visual: initial,
  topicId,
  segment,
  onSlide,
}: {
  visual: Visual;
  topicId?: string;
  segment?: number;
  onSlide: (page: number) => void;
}) {
  const lecture = useContext(LectureRef);
  const lectureId = lecture?.id ?? "";
  const fileHash = lecture?.fileHash ?? "";
  const [visual, setVisual] = useState<Visual | null>(initial);
  const pending = visual?.kind === "photo" && visual.status === "pending";

  // A photo is looked up in the background (search → model ranks → model looks).
  useEffect(() => {
    if (!pending || !lectureId || !topicId || typeof segment !== "number") return;
    let tries = 0;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      tries += 1;
      try {
        const next = await loadVisual(lectureId, topicId, segment);
        if (stop) return;
        if (!next || !(next.kind === "photo" && next.status === "pending")) return setVisual(next);
      } catch {
        /* offline or server waking: try again later */
      }
      if (tries < 6 && !stop) timer = setTimeout(poll, 8000 * tries);
      else if (!stop) setVisual(null); // not found in time: no picture rather than a spinner forever
    };
    timer = setTimeout(poll, 6000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [pending, lectureId, topicId, segment]);

  if (!visual) return null;
  if (visual.kind === "photo" && visual.status === "pending") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-control border border-dashed border-line px-3 py-2.5 text-small text-ink-muted" role="status">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        نختار صورة توضيحية لهذا الجزء…
      </div>
    );
  }

  return (
    <figure className="mt-4">
      <div className="overflow-hidden rounded-control border border-line bg-canvas p-3">
        {visual.kind === "diagram" && <Diagram diagram={visual.diagram} caption={visual.caption} />}
        {visual.kind === "slide" && <SlideThumb fileHash={fileHash} page={visual.page} caption={visual.caption} onSlide={onSlide} />}
        {visual.kind === "photo" && visual.status === "ready" && (
          // eslint-disable-next-line @next/next/no-img-element -- a remote Commons thumbnail; the site is a static export
          <img
            src={visual.photo.url}
            alt={visual.caption || visual.photo.title || "صورة توضيحية"}
            width={visual.photo.width}
            height={visual.photo.height}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="mx-auto block h-auto max-h-96 w-auto max-w-full rounded-control"
          />
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-small text-ink-muted">
        <SourceTag visual={visual} />
        {visual.caption && <span>{visual.caption}</span>}
        {visual.kind === "photo" && visual.status === "ready" && (
          <a
            href={visual.photo.page}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline"
          >
            {[visual.photo.artist, visual.photo.license].filter(Boolean).join(" · ") || "Wikimedia Commons"}
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(صفحة الصورة وترخيصها على ويكيميديا)</span>
          </a>
        )}
      </figcaption>
    </figure>
  );
}

function SourceTag({ visual }: { visual: Visual }) {
  const [Icon, text] =
    visual.kind === "diagram"
      ? [Shapes, "مخطط من محاضرتك"]
      : visual.kind === "slide"
        ? [FileText, `من شرائحك · صفحة ${visual.page}`]
        : [ImageIcon, "صورة بترخيص مفتوح"];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-caption font-bold text-info-ink">
      <Icon className="size-3" aria-hidden />
      {text}
    </span>
  );
}

/** The slide itself, drawn from the file on this device; a button when it is not here. */
function SlideThumb({ fileHash, page, caption, onSlide }: { fileHash: string; page: number; caption: string; onSlide: (p: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const el = canvas.current;
      if (!el) return;
      try {
        const width = Math.min(560, (box.current?.clientWidth || 480) - 4);
        const ok = await renderLecturePage(fileHash, page, el, width);
        if (!cancelled) setState(ok ? "ready" : "missing");
      } catch {
        if (!cancelled) setState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileHash, page]);

  return (
    <div ref={box}>
      <Button
        variant="bare"
        type="button"
        onClick={() => onSlide(page)}
        className={state === "ready" ? "mx-auto block rounded-control focus-visible:outline-2" : "hidden"}
        aria-label={`كبّر الشريحة ${page}${caption ? `: ${caption}` : ""}`}
      >
        <canvas ref={canvas} className="mx-auto block rounded-control border border-line" />
      </Button>
      {state !== "ready" && (
        <Button variant="bare" type="button" onClick={() => onSlide(page)} className="flex w-full items-center justify-center gap-2 py-6 text-small font-bold text-info-ink">
          {state === "loading" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <FileText className="size-4" aria-hidden />}
          اعرض الشريحة {page}
        </Button>
      )}
    </div>
  );
}
