"use client";

import { Navbar } from "@/components/navbar";
import { SectionTabs } from "@/components/section-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, FileText, CheckCircle2, AlertCircle, BarChart3, ArrowLeft, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { parseTranscriptPDF, type ParsedTranscript } from "@/lib/transcript-parser";
import { useTranscriptStore } from "@/store/transcriptStore";

// What the UI works with: the parsed transcript + optional AI analysis
// that arrives moments later. `error` is for the local-parse failure
// case (no network involved); `analysisError` is for the AI call.
type UIState = (ParsedTranscript & {
  analysis?: { strengths: string[]; needs_focus: string[]; recommendations: string[] };
  analysisError?: string;
  // Sprint-4 Bug #2: surfaced when the advisor call hits a Gemini
  // quota / 429. The render branch flips to a manual-entry fallback CTA.
  analysisQuotaHit?: boolean;
  isAnalyzing?: boolean;
}) | { error: string } | null;

export default function TranscriptParserPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<UIState>(null);
  const router = useRouter();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const parseTranscript = async () => {
    if (!file) return;

    setIsParsing(true);
    try {
      // Step 1 — Local parse via pdfjs. Deterministic, fast, accurate.
      const parsed = await parseTranscriptPDF(file);

      // Show extraction results immediately so the user sees the courses
      // appear within a second, even before the AI advisory finishes.
      setParsedData({ ...parsed, isAnalyzing: true });
      setIsParsing(false);

      // Step 2 — Send the clean structured data to the backend advisor.
      // The backend's only job is to produce the strengths / needs_focus /
      // recommendations block. No PDF bytes cross the wire.
      try {
        const response = await fetchWithAuth("/api/transcript/analyze", {
          method: "POST",
          body: JSON.stringify({
            name: parsed.name,
            nameEn: parsed.nameEn,
            studentId: parsed.studentId,
            university: parsed.university,
            major: parsed.major,
            majorEn: parsed.majorEn,
            faculty: parsed.faculty,
            degree: parsed.degree,
            gpa: parsed.gpa,
            earnedHours: parsed.earnedHours,
            planHours: parsed.planHours,
            totalPoints: parsed.totalPoints,
            confidence: parsed.confidence,
            completedCourses: parsed.completedCourses,
            registeredCourses: parsed.registeredCourses,
            semesters: parsed.semesters,
          }),
          headers: { "Content-Type": "application/json" },
        });

        setParsedData((prev) =>
          prev && !("error" in prev)
            ? { ...prev, analysis: response.analysis, isAnalyzing: false }
            : prev,
        );
      } catch (err: unknown) {
        console.error("Advisor error:", err);
        // Sprint-4 Bug #2: explicitly catch Gemini quota exhaustion and
        // surface a graceful Arabic message + manual-entry fallback,
        // instead of leaving the user staring at a generic "تعذّر".
        const raw = String(err instanceof Error ? err.message : err ?? "");
        const isQuota =
          /429|resource_exhausted|rate.?limit|quota|too many requests/i.test(raw);
        const friendly = isQuota
          ? "الخدمة تواجه ضغطاً حالياً، يرجى استخدام الإدخال اليدوي مؤقتاً."
          : raw ||
            "تعذّر الاتصال بمحرّك التحليل. تم استخراج البيانات بنجاح ويمكنك المتابعة.";
        setParsedData((prev) =>
          prev && !("error" in prev)
            ? {
                ...prev,
                isAnalyzing: false,
                analysisError: friendly,
                analysisQuotaHit: isQuota,
              }
            : prev,
        );
      }
    } catch (error: unknown) {
      console.error("Local parsing error:", error);
      setIsParsing(false);
      setParsedData({
        error:
          (error instanceof Error && error.message) ||
          "تعذّر قراءة ملف PDF. تأكد من أنه سجل أكاديمي صالح وليس صورة ممسوحة.",
      });
    }
  };

  const saveAndContinue = () => {
    if (!parsedData || "error" in parsedData) return;

    // Commit to transcriptStore → PATCH /api/workspace/transcript → syncTranscript safety net.
    const {
      analysis: _analysis,
      analysisError: _analysisError,
      analysisQuotaHit: _analysisQuotaHit,
      isAnalyzing: _isAnalyzing,
      ...transcript
    } = parsedData;
    useTranscriptStore.getState().setTranscript(transcript as ParsedTranscript);
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-24 px-4 max-w-5xl">

        <SectionTabs className="mb-6" />
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-xl glass border-foreground/10">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-black flex items-center gap-3">
              محلل السجل الأكاديمي
            </h1>
            <p className="text-muted-foreground text-sm">استخرج بياناتك الأكاديمية تلقائياً من ملف الـ PDF.</p>
          </div>
        </div>

        {!parsedData && !isParsing ? (
          <Card className="glass border-dashed border-foreground/10 rounded-[40px] p-12 text-center flex flex-col items-center gap-6 group hover:border-uqu-accent/30 transition-all cursor-pointer relative overflow-hidden" onClick={() => document.getElementById('file-upload')?.click()}>
            <div className="aurora-blob blob-1 opacity-5 scale-150" />
            <div className="w-24 h-24 rounded-3xl bg-uqu-accent/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Upload className="w-10 h-10 text-uqu-accent" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">ارفع ملف الـ PDF</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                قم بسحب وإفلات ملف السجل الأكاديمي هنا أو انقر للاختيار من جهازك.
              </p>
            </div>
            <input type="file" id="file-upload" className="hidden" accept=".pdf" onChange={handleFileChange} />
            {file && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground/5 border border-foreground/10 animate-in zoom-in-95">
                <FileText className="w-4 h-4 text-uqu-cyan" />
                <span className="text-sm font-medium">{file.name}</span>
                <Button onClick={(e) => { e.stopPropagation(); parseTranscript(); }} className="mr-4 rounded-lg bg-uqu-accent hover:bg-uqu-accent/90">تحليل الآن</Button>
              </div>
            )}
          </Card>
        ) : isParsing ? (
          <div className="glass border-foreground/10 rounded-[40px] p-20 text-center flex flex-col items-center gap-8">
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-4 border-uqu-accent/20 border-t-uqu-accent animate-spin" />
              <Sparkles className="w-8 h-8 text-uqu-accent absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">جاري التحليل الذكي...</h2>
              <p className="text-muted-foreground">نقوم الآن بقراءة وتدقيق بياناتك الأكاديمية بدقة عالية.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8">
            {/* Local-parse failure */}
            {parsedData && "error" in parsedData && (
              <Card className="p-6 border-rose-500/50 bg-rose-500/10 text-rose-500 rounded-[32px] flex items-center gap-4">
                <AlertCircle className="w-8 h-8 shrink-0" />
                <div>
                  <h4 className="font-bold">فشل التحليل</h4>
                  <p className="text-sm opacity-90">{parsedData.error}</p>
                </div>
                <Button onClick={() => setParsedData(null)} variant="outline" className="mr-auto rounded-xl border-rose-500/20 text-rose-500">إعادة المحاولة</Button>
              </Card>
            )}

            {/* Successful local parse — render immediately, AI advisory streams in */}
            {parsedData && !("error" in parsedData) && (
              <>
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="glass p-6 rounded-3xl border-foreground/10">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">المعدل التراكمي</div>
                    <div className="text-3xl font-black text-uqu-accent">{parsedData.gpa?.toFixed(2) || "0.00"}</div>
                  </div>
                  <div className="glass p-6 rounded-3xl border-foreground/10">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">الساعات المكتسبة</div>
                    <div className="text-3xl font-black text-uqu-cyan">{parsedData.earnedHours ?? "0"}</div>
                  </div>
                  <div className="glass p-6 rounded-3xl border-foreground/10">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">ساعات الخطة</div>
                    <div className="text-3xl font-black text-foreground">{parsedData.planHours ?? "---"}</div>
                  </div>
                  <div className="glass p-6 rounded-3xl border-foreground/10">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">عدد المواد</div>
                    <div className="text-3xl font-black text-emerald-400">{parsedData.completedCourses?.length || 0}</div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="glass p-8 rounded-[40px] border-uqu-accent/20 bg-uqu-accent/5">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-uqu-accent" />
                      التحليل الذكي للسجل
                      {parsedData.isAnalyzing && (
                        <Loader2 className="w-4 h-4 text-uqu-accent animate-spin mr-auto" />
                      )}
                    </h3>

                    {parsedData.isAnalyzing ? (
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        جاري إعداد التحليل الأكاديمي... ({parsedData.completedCourses.length} مادة تم استخراجها بدقة 100%).
                      </p>
                    ) : parsedData.analysisError ? (
                      <div className="space-y-3">
                        <p
                          className={
                            "text-sm leading-relaxed " +
                            (parsedData.analysisQuotaHit
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-rose-400")
                          }
                        >
                          {parsedData.analysisError}
                        </p>
                        {parsedData.analysisQuotaHit && (
                          // Sprint-4 Bug #2 fallback: keep the user
                          // moving — they can still get value from the
                          // manual GPA planner without the AI advisor.
                          <Button
                            onClick={() => router.push("/gpa")}
                            variant="outline"
                            className="rounded-xl glass border-amber-500/30 text-amber-700 dark:text-amber-200 hover:bg-amber-500/10 gap-2"
                          >
                            <ArrowLeft className="w-4 h-4" />
                            متابعة بالإدخال اليدوي
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <span className="text-xs font-bold text-uqu-accent">💪 نقاط القوة:</span>
                          <div className="flex flex-wrap gap-2">
                            {parsedData.analysis?.strengths?.map((s, i) => (
                              <Badge key={`strength-${i}`} variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{s}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-xs font-bold text-rose-500">⚠️ تحتاج تركيز:</span>
                          <div className="flex flex-wrap gap-2">
                            {parsedData.analysis?.needs_focus?.map((w, i) => (
                              <Badge key={`focus-${i}`} variant="outline" className="bg-rose-500/10 text-rose-500 border-rose-500/20">{w}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>

                  <Card className="glass p-8 rounded-[40px] border-foreground/10">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      توصيات الأكاديمي
                      {parsedData.isAnalyzing && (
                        <Loader2 className="w-4 h-4 text-emerald-500 animate-spin mr-auto" />
                      )}
                    </h3>
                    {parsedData.isAnalyzing ? (
                      <p className="text-sm text-muted-foreground">جاري إعداد التوصيات...</p>
                    ) : parsedData.analysisError ? (
                      <p className="text-sm text-rose-400">—</p>
                    ) : (
                      <ul className="space-y-3">
                        {parsedData.analysis?.recommendations?.map((r, i) => (
                          <li key={`rec-${i}`} className="text-sm flex items-start gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-uqu-accent mt-1.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>

                <Card className="glass border-foreground/10 rounded-[40px] overflow-hidden">
                  <div className="p-8 border-b border-foreground/10 flex items-center justify-between bg-foreground/5">
                    <h3 className="font-bold flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-uqu-accent" />
                      المواد المكتشفة
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 mr-2">
                        دقة {parsedData.confidence}%
                      </Badge>
                    </h3>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setParsedData(null)} className="rounded-xl glass border-foreground/10">إلغاء</Button>
                      <Button onClick={saveAndContinue} size="sm" className="rounded-xl bg-uqu-accent hover:bg-uqu-accent/90 shadow-lg">حفظ ومتابعة</Button>
                    </div>
                  </div>
                  <div className="p-8">
                    <div className="space-y-3">
                      {parsedData.completedCourses.slice(0, 10).map((c) => (
                        <div key={c.code} className="flex items-center justify-between p-4 rounded-2xl bg-foreground/5 border border-foreground/10">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center font-bold text-xs">
                              {c.code}
                            </div>
                            <div>
                              <h4 className="text-sm font-bold">{c.nameAr || c.nameEn || c.name}</h4>
                              <p className="text-[10px] text-muted-foreground">{c.semester || "مكتملة"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-center">
                              <div className="text-[9px] text-muted-foreground font-bold">الساعات</div>
                              <div className="text-xs font-bold">{c.creditHours}</div>
                            </div>
                            <div className="w-10 h-10 rounded-xl bg-uqu-accent/10 border border-uqu-accent/20 flex items-center justify-center text-uqu-accent font-black">
                              {c.grade || "—"}
                            </div>
                          </div>
                        </div>
                      ))}
                      {parsedData.completedCourses.length > 10 && (
                        <p className="text-center text-xs text-muted-foreground pt-4">+ {parsedData.completedCourses.length - 10} مواد أخرى تم تحليلها بنجاح</p>
                      )}
                    </div>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
