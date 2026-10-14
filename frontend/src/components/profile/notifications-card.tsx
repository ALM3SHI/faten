"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import {
  disablePush,
  enablePush,
  getNotificationPrefs,
  pushState,
  saveNotificationPrefs,
  sendTestPush,
  type NotificationPrefs,
  type PushState,
} from "@/lib/push";

const PREF_LABELS: [keyof NotificationPrefs, string, string][] = [
  ["lectures", "المحاضرات", "قبل كل محاضرة بساعة"],
  ["attendance", "الغياب", "إذا قربت من حد الحرمان"],
  ["exams", "الاختبارات", "قبل الاختبار بأسبوع و3 أيام ويوم"],
  ["reviews", "مراجعة المذاكرة الذكية", "صباحاً إذا حان وقت مراجعة موضوع أتقنته"],
];

const STATE_TEXT: Record<PushState, string> = {
  unsupported: "متصفحك لا يدعم الإشعارات. على الآيفون: أضف فطن للشاشة الرئيسية (مشاركة ← إضافة إلى الشاشة الرئيسية) ثم افتحه من هناك.",
  "not-configured": "الإشعارات غير مفعّلة في هذا الإصدار من فطن بعد.",
  denied: "الإشعارات محظورة لهذا الموقع في إعدادات المتصفح. اسمح بها من إعدادات الموقع ثم ارجع هنا.",
  off: "فعّلها ليوصلك تنبيه على جوالك أو جهازك حتى لو فطن مقفول.",
  on: "مفعّلة على هذا الجهاز.",
};

/** Profile card: turn phone/browser notifications on/off and pick what to receive. */
export function NotificationsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s));
    getNotificationPrefs()
      .then((p) => alive && setPrefs(p))
      .catch(() => alive && setPrefs({ lectures: true, attendance: true, exams: true }));
    return () => {
      alive = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تنفيذ الطلب، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = () =>
    run(async () => {
      if (state === "on") {
        await disablePush();
        setState("off");
        toast.info("أوقفنا الإشعارات على هذا الجهاز.");
      } else {
        const next = await enablePush();
        setState(next);
        if (next === "on") toast.success("تم تفعيل الإشعارات ✅");
      }
    });

  const setPref = (key: keyof NotificationPrefs, value: boolean) =>
    run(async () => {
      const next = { ...(prefs ?? { lectures: true, attendance: true, exams: true }), [key]: value };
      setPrefs(next);
      setPrefs(await saveNotificationPrefs(next));
    });

  const canToggle = state === "on" || state === "off";

  return (
    <Card className="glass p-6 md:p-7 rounded-[32px] border-foreground/10 space-y-5 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bell className="w-5 h-5 text-uqu-accent" aria-hidden />
            الإشعارات على الجوال
          </h2>
          <p className="text-sm text-muted-foreground leading-7 max-w-xl">{state ? STATE_TEXT[state] : "…"}</p>
        </div>
        {canToggle && (
          <Button
            onClick={toggle}
            disabled={busy}
            variant={state === "on" ? "outline" : "default"}
            className={state === "on" ? "rounded-xl gap-2" : "rounded-xl gap-2 bg-uqu-accent hover:bg-uqu-accent/90 text-white"}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : state === "on" ? <BellOff className="w-4 h-4" aria-hidden /> : <Bell className="w-4 h-4" aria-hidden />}
            {state === "on" ? "إيقاف على هذا الجهاز" : "تفعيل الإشعارات"}
          </Button>
        )}
      </div>

      <fieldset className="grid sm:grid-cols-3 gap-3" disabled={!prefs || busy}>
        <legend className="sr-only">ماذا تريد أن يصلك؟</legend>
        {PREF_LABELS.map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-3 rounded-2xl border border-foreground/10 p-4 cursor-pointer has-[:checked]:border-uqu-accent/40">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--accent)] w-4 h-4"
              checked={prefs?.[key] ?? true}
              onChange={(e) => setPref(key, e.target.checked)}
            />
            <span>
              <span className="block font-bold text-sm">{label}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {state === "on" && (
        <Button variant="ghost" size="sm" disabled={busy} className="gap-2 rounded-xl" onClick={() => run(async () => {
          await sendTestPush();
          toast.success("أرسلنا إشعاراً تجريبياً — يوصلك خلال ثوانٍ.");
        })}>
          <Send className="w-4 h-4" aria-hidden />
          إرسال إشعار تجريبي
        </Button>
      )}
    </Card>
  );
}
