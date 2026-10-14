"use client";

/**
 * Admin dashboard (/admin): usage numbers, students' ratings of the
 * assistant and reported course reviews. The server decides who is an
 * admin (ADMIN_EMAILS); everyone else gets a 403 and a short message.
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Bell, Cpu, EyeOff, Flag, Loader2, MessageSquare, RefreshCw, ShieldAlert, ThumbsDown, ThumbsUp, UserPlus, Users } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { TutorInsights } from "@/components/admin/tutor-insights";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { fetchAdminOverview, moderateReview, toolName, type AdminOverview } from "@/lib/admin";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: AdminOverview; at: Date }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string };

async function fetchState(): Promise<State> {
  try {
    return { kind: "ready", data: await fetchAdminOverview(), at: new Date() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "تعذّر تحميل البيانات.";
    return err instanceof ApiError && err.status === 403 ? { kind: "forbidden", message } : { kind: "error", message };
  }
}

export default function AdminPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetchState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    fetchState().then(setState);
  }, []);

  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-28 md:pt-32 px-4 max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-uqu-accent" aria-hidden />
              لوحة الإدارة
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              أرقام الاستخدام وتقييم الطلاب لإجابات فطن والبلاغات — بدون أسماء أو بيانات شخصية.
            </p>
          </div>
          {state.kind === "ready" && (
            <Button
              variant="ghost"
              className="rounded-xl gap-2"
              onClick={load}
            >
              <RefreshCw className="w-4 h-4" aria-hidden />
              تحديث
            </Button>
          )}
        </div>

        {state.kind === "loading" && (
          <div className="flex justify-center py-20 text-muted-foreground" role="status">
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
            <span className="sr-only">جاري التحميل…</span>
          </div>
        )}
        {state.kind === "forbidden" && (
          <Card className="glass rounded-3xl p-8 text-center space-y-2">
            <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-black">{state.message}</h2>
            <p className="text-sm text-muted-foreground">إذا كنت المشرف، تأكد إنك داخل بالإيميل المسجّل في إعدادات الخادم وإنه مُفعّل.</p>
          </Card>
        )}
        {state.kind === "error" && (
          <Card className="glass rounded-3xl p-8 text-center space-y-4">
            <p className="text-sm">{state.message}</p>
            <Button onClick={load} className="rounded-xl">حاول مرة ثانية</Button>
          </Card>
        )}
        {state.kind === "ready" && <Dashboard data={state.data} at={state.at} onChanged={load} />}
      </main>
    </div>
  );
}

function Dashboard({ data, at, onChanged }: { data: AdminOverview; at: Date; onChanged: () => void }) {
  const fb = data.feedback;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat icon={Users} label="المستخدمون" value={data.users.total} hint={`+${data.users.new_7d} هذا الأسبوع`} />
        <Stat icon={UserPlus} label="جدد آخر 30 يوم" value={data.users.new_30d} />
        <Stat icon={MessageSquare} label="استخدموا المساعد اليوم" value={data.usage.active_today} hint={`${data.usage.active_7d} آخر 7 أيام`} />
        <Stat icon={BarChart3} label="طلبات اليوم" value={data.usage.requests_today} hint={data.usage.refunded_today ? `بالرصيد اليومي · أُعيد ${data.usage.refunded_today} بسبب أعطال` : "بالرصيد اليومي"} />
        <Stat icon={Bell} label="فعّلوا الإشعارات" value={data.devices} />
        {data.ai_gate && (
          <Stat
            icon={Cpu}
            label="طلبات الذكاء الاصطناعي آخر دقيقة"
            value={data.ai_gate.per_minute_limit ? `${data.ai_gate.last_minute}/${data.ai_gate.per_minute_limit}` : data.ai_gate.last_minute}
            hint={`اليوم ${data.ai_gate.today}${data.ai_gate.per_day_limit ? `/${data.ai_gate.per_day_limit}` : ""}${data.ai_gate.rejected ? ` · رُدّ ${data.ai_gate.rejected} بسبب الزحمة` : ""}`}
          />
        )}
        <Stat
          icon={ThumbsUp}
          label={`الرضا (آخر ${fb.days} يوم)`}
          value={fb.satisfaction === null ? "—" : `${fb.satisfaction}%`}
          hint={`${fb.up} 👍 · ${fb.down} 👎`}
        />
      </div>

      <TutorInsights />

      <Card className="glass rounded-3xl p-6 space-y-4">
        <h2 className="text-lg font-black">تقييم الإجابات حسب الأداة</h2>
        {Object.keys(fb.by_tool).length === 0 ? (
          <p className="text-sm text-muted-foreground">ما فيه تقييمات في آخر {fb.days} يوم.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs">
                  <th className="text-right font-bold py-2">الأداة</th>
                  <th className="font-bold py-2 w-20">👍</th>
                  <th className="font-bold py-2 w-20">👎</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fb.by_tool).map(([tool, s]) => (
                  <tr key={tool} className="border-t border-foreground/10">
                    <td className="py-2">{toolName(tool)}</td>
                    <td className="py-2 text-center tabular-nums">{s.up}</td>
                    <td className={cn("py-2 text-center tabular-nums", s.down > 0 && "text-rose-700 dark:text-rose-300 font-bold")}>{s.down}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="glass rounded-3xl p-6 space-y-4">
        <h2 className="text-lg font-black flex items-center gap-2">
          <ThumbsDown className="w-5 h-5 text-rose-600 dark:text-rose-300" aria-hidden />
          آخر الإجابات اللي ما عجبت الطلاب
        </h2>
        {fb.recent_down.length === 0 ? (
          <p className="text-sm text-muted-foreground">ما فيه تقييمات سلبية في آخر {fb.days} يوم. 🎉</p>
        ) : (
          <ul className="space-y-3">
            {fb.recent_down.map((r, i) => (
              <li key={i} className="rounded-2xl border border-foreground/10 p-4 space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span>{(r.tools ?? []).map(toolName).join("، ") || "بدون أداة"}</span>
                  <span>{formatDate(r.createdAt)}</span>
                </div>
                {r.question && <p className="font-bold" dir="auto">س: {r.question}</p>}
                {r.answer && <p className="text-foreground/80 line-clamp-3 leading-7" dir="auto">ج: {r.answer}</p>}
                {r.comment && <p className="rounded-xl bg-rose-500/10 px-3 py-2" dir="auto">ملاحظة الطالب: {r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ReportedReviews reviews={data.reported_reviews} onChanged={onChanged} />

      <p className="text-xs text-muted-foreground text-center">
        آخر تحديث {at.toLocaleTimeString("ar-SA-u-ca-gregory-nu-latn", { hour: "numeric", minute: "2-digit" })}
      </p>
    </>
  );
}

function ReportedReviews({ reviews, onChanged }: { reviews: AdminOverview["reported_reviews"]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (code: string, id: string, action: "restore" | "hide") => {
    setBusy(id + action);
    try {
      await moderateReview(code, id, action);
      toast.success(action === "restore" ? "رجع التقييم ظاهر وانمسحت بلاغاته." : "انخفى التقييم.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تنفيذ الإجراء.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="glass rounded-3xl p-6 space-y-4">
      <h2 className="text-lg font-black flex items-center gap-2">
        <Flag className="w-5 h-5 text-amber-700 dark:text-amber-300" aria-hidden />
        تقييمات مقررات عليها بلاغات
      </h2>
      <p className="text-xs text-muted-foreground">التقييم ينخفي تلقائياً بعد 3 بلاغات. راجعه وقرّر: ترجّعه أو يبقى مخفي.</p>
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">ما فيه بلاغات.</p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.code + r.id} className="rounded-2xl border border-foreground/10 p-4 space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {r.course} <span className="text-xs text-muted-foreground font-mono">{r.code}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <span className="rounded-lg bg-amber-500/10 px-2 py-0.5">{r.reports} بلاغ</span>
                  {r.hidden && (
                    <span className="rounded-lg bg-foreground/10 px-2 py-0.5 inline-flex items-center gap-1">
                      <EyeOff className="w-3 h-3" aria-hidden /> مخفي
                    </span>
                  )}
                </span>
              </div>
              <p className="leading-7" dir="auto">{r.tip || <span className="text-muted-foreground">بدون نص — تقييم بالأرقام فقط.</span>}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" className="rounded-xl" disabled={busy !== null} onClick={() => act(r.code, r.id, "restore")}>
                  إظهار ومسح البلاغات
                </Button>
                {!r.hidden && (
                  <Button size="sm" variant="ghost" className="rounded-xl text-rose-700 dark:text-rose-300" disabled={busy !== null} onClick={() => act(r.code, r.id, "hide")}>
                    إخفاء
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: number | string; hint?: string }) {
  return (
    <Card className="glass rounded-2xl p-4 space-y-1">
      <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <Icon className="w-4 h-4 text-uqu-accent" aria-hidden />
        {label}
      </div>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "short" });
}
