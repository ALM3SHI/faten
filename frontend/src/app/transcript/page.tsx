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
import { assessRecord } from "@/lib/record-status";
import { RecordStatusNote } from "@/components/record-status-note";
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
    <div className="ds-page min-h-screen bg-canvas text-ink pb-20">
      <Navbar />
      <div className="aurora">
        <div className="aurora-blob blob-1 opacity-10" />
        <div className="aurora-blob blob-2 opacity-10" />
      </div>

      <main className="container mx-auto pt-24 px-4 max-w-5xl">

        <SectionTabs className="mb-6" />
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="رجوع" className="rounded-control border border-line bg-surface shadow-card">
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-title font-bold flex items-center gap-3">
              محلل السجل الأكاديمي
            </h1>
            <p className="text-ink-muted text-small">ارفع سجلك من البوابة الأكاديمية (PDF) ونستخرج منه موادك ودرجاتك تلقائياً.</p>
          </div>
        </div>

        {!parsedData && !isParsing ? (
          <Card className="border border-line bg-surface shadow-card border-dashed rounded-card p-12 text-center flex flex-col items-center gap-6 group hover:border-info-line transition-all cursor-pointer relative overflow-hidden" onClick={() => document.getElementById('file-upload')?.click()}>
            <div className="aurora-blob blob-1 opacity-5 scale-150" />
            <div className="w-24 h-24 rounded-card bg-info-soft flex items-center justify-center group-hover:scale-110 transition-transform">
              <Upload className="w-10 h-10 text-info-ink" />
            </div>
            <div>
              <h2 className="text-heading font-bold mb-2">ارفع سجلك الأكاديمي (PDF)</h2>
              <p className="text-ink-muted max-w-sm mx-auto">
                اسحبه هنا أو اضغط لاختياره من جهازك.
              </p>
            </div>
            <input type="file" id="file-upload" className="hidden" accept=".pdf" onChange={handleFileChange} />
            {file && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-control bg-surface-sunken border border-line animate-in zoom-in-95">
                <FileText className="w-4 h-4 text-info-ink" />
                <span className="text-small font-medium">{file.name}</span>
                <Button onClick={(e) => { e.stopPropagation(); parseTranscript(); }} className="mr-4 rounded-control bg-brand hover:bg-brand-hover">تحليل الآن</Button>
              </div>
            )}
          </Card>
        ) : isParsing ? (
          <div className="border border-line bg-surface shadow-card rounded-card p-20 text-center flex flex-col items-center gap-8">
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-4 border-info-line border-t-brand animate-spin" />
              <Sparkles className="w-8 h-8 text-info-ink absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h2 className="text-heading font-bold">جاري التحليل الذكي...</h2>
              <p className="text-ink-muted">نقوم الآن بقراءة وتدقيق بياناتك الأكاديمية بدقة عالية.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8">
            {/* Local-parse failure */}
            {parsedData && "error" in parsedData && (
              <Card className="p-6 border-danger-line bg-danger-soft text-danger-ink rounded-card flex items-center gap-4">
                <AlertCircle className="w-8 h-8 shrink-0" />
                <div>
                  <h4 className="font-bold">فشل التحليل</h4>
                  <p className="text-small opacity-90">{parsedData.error}</p>
                </div>
                <Button onClick={() => setParsedData(null)} variant="outline" className="mr-auto rounded-control border-danger-line text-danger-ink">إعادة المحاولة</Button>
              </Card>
            )}

            {/* Successful local parse — render immediately, AI advisory streams in */}
            {parsedData && !("error" in parsedData) && (
              <>
                <RecordStatusNote assessment={assessRecord(parsedData)} />
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="border border-line bg-surface shadow-card p-6 rounded-card">
                    <div className="text-caption text-ink-muted uppercase font-bold mb-1">المعدل التراكمي</div>
                    <div className="text-title font-bold text-info-ink">{parsedData.gpa?.toFixed(2) || "0.00"}</div>
                  </div>
                  <div className="border border-line bg-surface shadow-card p-6 rounded-card">
                    <div className="text-caption text-ink-muted uppercase font-bold mb-1">الساعات المكتسبة</div>
                    <div className="text-title font-bold text-info-ink">{parsedData.earnedHours ?? "0"}</div>
                  </div>
                  <div className="border border-line bg-surface shadow-card p-6 rounded-card">
                    <div className="text-caption text-ink-muted uppercase font-bold mb-1">الساعات المعتمدة (المسجلة)</div>
                    <div className="text-title font-bold text-ink">{parsedData.attemptedHours ?? "---"}</div>
                  </div>
                  <div className="border border-line bg-surface shadow-card p-6 rounded-card">
                    <div className="text-caption text-ink-muted uppercase font-bold mb-1">عدد المواد</div>
                    <div className="text-title font-bold text-success-ink">{parsedData.completedCourses?.length || 0}</div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="border shadow-card p-8 rounded-card border-info-line bg-info-soft">
                    <h3 className="text-heading font-bold mb-4 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-info-ink" />
                      التحليل الذكي للسجل
                      {parsedData.isAnalyzing && (
                        <Loader2 className="w-4 h-4 text-info-ink animate-spin mr-auto" />
                      )}
                    </h3>

                    {parsedData.isAnalyzing ? (
                      <p className="text-small text-ink-muted leading-relaxed">
                        جاري إعداد التحليل الأكاديمي... ({parsedData.completedCourses.length} مادة تم استخراجها بدقة 100%).
                      </p>
                    ) : parsedData.analysisError ? (
                      <div className="space-y-3">
                        <p
                          className={
                            "text-small leading-relaxed " +
                            (parsedData.analysisQuotaHit
                              ? "text-warning-ink "
                              : "text-danger-ink")
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
                            className="rounded-control border border-line bg-surface shadow-card border-warning-line text-warning-ink hover:bg-warning-soft gap-2"
                          >
                            <ArrowLeft className="w-4 h-4" />
                            متابعة بالإدخال اليدوي
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <span className="text-caption font-bold text-info-ink">💪 نقاط القوة:</span>
                          <div className="flex flex-wrap gap-2">
                            {parsedData.analysis?.strengths?.map((s, i) => (
                              <Badge key={`strength-${i}`} variant="outline" className="bg-success-soft text-success-ink border-success-line">{s}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-caption font-bold text-danger-ink">⚠️ تحتاج تركيز:</span>
                          <div className="flex flex-wrap gap-2">
                            {parsedData.analysis?.needs_focus?.map((w, i) => (
                              <Badge key={`focus-${i}`} variant="outline" className="bg-danger-soft text-danger-ink border-danger-line">{w}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>

                  <Card className="border border-line bg-surface shadow-card p-8 rounded-card">
                    <h3 className="text-heading font-bold mb-4 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-success-ink" />
                      توصيات الأكاديمي
                      {parsedData.isAnalyzing && (
                        <Loader2 className="w-4 h-4 text-success-ink animate-spin mr-auto" />
                      )}
                    </h3>
                    {parsedData.isAnalyzing ? (
                      <p className="text-small text-ink-muted">جاري إعداد التوصيات...</p>
                    ) : parsedData.analysisError ? (
                      <p className="text-small text-danger-ink">—</p>
                    ) : (
                      <ul className="space-y-3">
                        {parsedData.analysis?.recommendations?.map((r, i) => (
                          <li key={`rec-${i}`} className="text-small flex items-start gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>

                <Card className="border border-line bg-surface shadow-card rounded-card overflow-hidden">
                  <div className="p-8 border-b border-line flex items-center justify-between bg-surface-sunken">
                    <h3 className="font-bold flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-info-ink" />
                      المواد المكتشفة
                      <Badge variant="outline" className="bg-success-soft text-success-ink border-success-line mr-2">
                        دقة {parsedData.confidence}%
                      </Badge>
                    </h3>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setParsedData(null)} className="rounded-control border border-line bg-surface shadow-card">إلغاء</Button>
                      <Button onClick={saveAndContinue} size="sm" className="rounded-control bg-brand hover:bg-brand-hover">حفظ ومتابعة</Button>
                    </div>
                  </div>
                  <div className="p-8">
                    <div className="space-y-3">
                      {/* A retaken course appears once per attempt (same code, other term):
                          the key needs the position, not only the code. */}
                      {parsedData.completedCourses.slice(0, 10).map((c, i) => (
                        <div key={`${c.code}-${c.semester ?? ""}-${i}`} className="flex items-center justify-between p-4 rounded-card bg-surface-sunken border border-line">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-control bg-surface-sunken flex items-center justify-center font-bold text-caption">
                              {c.code}
                            </div>
                            <div>
                              <h4 className="text-small font-bold">{c.nameAr || c.nameEn || c.name}</h4>
                              <p className="text-caption text-ink-muted">{c.semester || "مكتملة"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-center">
                              <div className="text-caption text-ink-muted font-bold">الساعات</div>
                              <div className="text-caption font-bold">{c.creditHours}</div>
                            </div>
                            <div className="w-10 h-10 rounded-control bg-info-soft border border-info-line flex items-center justify-center text-info-ink font-bold">
                              {c.grade || "—"}
                            </div>
                          </div>
                        </div>
                      ))}
                      {parsedData.completedCourses.length > 10 && (
                        <p className="text-center text-caption text-ink-muted pt-4">+ {parsedData.completedCourses.length - 10} مواد أخرى تم تحليلها بنجاح</p>
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
