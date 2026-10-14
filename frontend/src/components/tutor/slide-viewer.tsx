"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getLectureFile, saveLectureFile, sha256Hex } from "@/lib/lecture-files";
import type { Lecture } from "@/lib/tutor";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * pdf.js 5.7 renders with Map/WeakMap.prototype.getOrInsertComputed (ES2026
 * "upsert"), which many browsers students use do not have yet. Add the two
 * methods when missing, exactly as the proposal defines them.
 */
function polyfillUpsert(): void {
  for (const C of [Map, WeakMap] as unknown as { prototype: Record<string, unknown> }[]) {
    const proto = C.prototype as {
      has(k: unknown): boolean;
      get(k: unknown): unknown;
      set(k: unknown, v: unknown): unknown;
      getOrInsert?: unknown;
      getOrInsertComputed?: unknown;
    };
    if (typeof proto.getOrInsert !== "function") {
      Object.defineProperty(proto, "getOrInsert", {
        configurable: true,
        writable: true,
        value(this: typeof proto, key: unknown, value: unknown) {
          if (!this.has(key)) this.set(key, value);
          return this.get(key);
        },
      });
    }
    if (typeof proto.getOrInsertComputed !== "function") {
      Object.defineProperty(proto, "getOrInsertComputed", {
        configurable: true,
        writable: true,
        value(this: typeof proto, key: unknown, fn: (k: unknown) => unknown) {
          if (!this.has(key)) this.set(key, fn(key));
          return this.get(key);
        },
      });
    }
  }
}

function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    polyfillUpsert();
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

async function openDoc(hash: string, blob: Blob): Promise<PDFDocumentProxy> {
  if (!docCache.has(hash)) {
    docCache.set(
      hash,
      (async () => {
        const pdfjs = await getPdfjs();
        return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      })(),
    );
  }
  return docCache.get(hash)!;
}

type Status = "loading" | "ready" | "missing" | "error";

/**
 * The original slide, rendered from the PDF kept on this device. On a device
 * without the file the student can attach it once; it is checked against the
 * lecture's fingerprint before use.
 */
export function SlideViewer({
  lecture,
  page,
  onPageChange,
  onClose,
}: {
  lecture: Lecture;
  page: number | null;
  onPageChange: (p: number) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const open = page !== null;

  useEffect(() => {
    if (page === null) return;
    let cancelled = false;
    (async () => {
      setStatus("loading");
      const blob = await getLectureFile(lecture.fileHash);
      if (cancelled) return;
      if (!blob) return setStatus("missing");
      try {
        const doc = await openDoc(lecture.fileHash, blob);
        const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const width = Math.min(900, (boxRef.current?.clientWidth || 600) - 8);
        const base = pg.getViewport({ scale: 1 });
        const scale = width / base.width;
        const ratio = window.devicePixelRatio || 1;
        const vp = pg.getViewport({ scale: scale * ratio });
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${vp.width / ratio}px`;
        canvas.style.height = `${vp.height / ratio}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return setStatus("error");
        await pg.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        if (!cancelled) setStatus("ready");
      } catch (err) {
        console.warn("[slides] render failed:", err);
        docCache.delete(lecture.fileHash);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, lecture.fileHash, reloadKey]);

  const attach = async (f: File | undefined) => {
    setAttachError(null);
    if (!f) return;
    const hash = await sha256Hex(f);
    if (hash !== lecture.fileHash) {
      setAttachError("هذا ليس نفس ملف المحاضرة. اختر الملف الذي رفعته أول مرة.");
      return;
    }
    await saveLectureFile(hash, f, f.name);
    setReloadKey((k) => k + 1);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl w-[calc(100%-1rem)] p-4 gap-3" dir="rtl">
        <DialogTitle className="text-base font-bold">
          الشريحة {page} من {lecture.pageCount}
        </DialogTitle>
        <DialogDescription className="sr-only">صفحة من ملف المحاضرة الأصلي</DialogDescription>
        <div ref={boxRef} className="relative min-h-[240px] max-h-[70vh] overflow-auto rounded-xl border border-foreground/10 bg-white flex items-start justify-center">
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground" role="status">
              <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
              <span className="sr-only">جاري تحميل الشريحة…</span>
            </div>
          )}
          {status === "missing" && (
            <div className="p-6 text-center space-y-3 text-foreground bg-card w-full">
              <p className="text-sm leading-7">
                ملف المحاضرة الأصلي غير محفوظ على هذا الجهاز. أرفقه مرة واحدة لعرض الشرائح هنا (لن يُعاد تحليله ولن يُخصم رصيد).
              </p>
              <label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-uqu-accent text-white text-sm font-bold cursor-pointer">
                <FileUp className="w-4 h-4" aria-hidden /> إرفاق ملف المحاضرة
                <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => attach(e.target.files?.[0])} />
              </label>
              {attachError && <p className="text-sm text-rose-500" role="alert">{attachError}</p>}
            </div>
          )}
          {status === "error" && <p className="p-6 text-sm text-rose-500">تعذّر عرض هذه الشريحة.</p>}
          <canvas ref={canvasRef} className={status === "ready" ? "block" : "hidden"} aria-label={`الشريحة ${page}`} />
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="gap-1 rounded-xl" disabled={!page || page <= 1} onClick={() => page && onPageChange(page - 1)}>
            <ChevronRight className="w-4 h-4" aria-hidden /> السابقة
          </Button>
          <Button variant="ghost" className="gap-1 rounded-xl" disabled={!page || page >= lecture.pageCount} onClick={() => page && onPageChange(page + 1)}>
            التالية <ChevronLeft className="w-4 h-4" aria-hidden />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
