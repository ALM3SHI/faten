"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpenCheck,
  Calculator,
  CalendarCheck,
  CalendarDays,
  FileText,
  MapPinned,
  MessageSquare,
  Timer,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";

// Real answer from the knowledge base (study & exams regulation, art. 14,
// UQU executive rule 1) — the landing page shows what Faten actually does.
const DEMO_QUESTION = "كم أغيب قبل ما أنحرم من الاختبار النهائي؟";
const DEMO_ANSWER =
  "تُحرم من دخول الاختبار النهائي إذا زاد غيابك عن 25% بعذر، أو عن 15% بدون عذر، من مجموع المحاضرات والدروس العملية. وفي كل الأحوال لا يجوز أن تقل نسبة حضورك عن 75%.";
const DEMO_SOURCE = "المادة 14 — لائحة الدراسة والاختبارات (القواعد التنفيذية لأم القرى)";

const FEATURES = [
  { icon: BookOpenCheck, title: "مستشار اللوائح", text: "39 لائحة ونظامًا رسميًا. تسأل بلهجتك، والإجابة تصلك مع رقم المادة.", href: "/chat" },
  { icon: MessageSquare, title: "مساعد يعرف وضعك", text: "يقرأ سجلك وجدولك، فيجيب عن معدلك وموادك ومواعيدك أنت.", href: "/chat" },
  { icon: Calculator, title: "حاسبة المعدل", text: "ارفع سجلك وجرّب الدرجات المتوقعة قبل نهاية الفصل.", href: "/gpa" },
  { icon: CalendarCheck, title: "خطة المذاكرة", text: "جلسات مراجعة موزّعة على أوقات فراغك الفعلية في جدولك.", href: "/plan" },
  { icon: CalendarDays, title: "التقويم الجامعي 1448هـ", text: "الانسحاب والاعتذار والاختبارات، مع عدّ تنازلي للموعد القادم.", href: "/dashboard" },
  { icon: Users, title: "تقييمات المواد", text: "آراء ونصائح من طلاب درسوا المادة فعلًا، قبل ما تسجّلها.", href: "/community" },
  { icon: MapPinned, title: "خريطة القاعات", text: "ابحث عن القاعة أو المكتب واعرف طريقك داخل المبنى.", href: "/locations" },
  { icon: Timer, title: "مؤقت التركيز", text: "جلسات بومودورو مرتبطة بمهام خطتك، ويُحسب إنجازك تلقائيًا.", href: "/pomodoro" },
];

const STEPS = [
  { title: "أنشئ حسابك", text: "بالبريد الإلكتروني أو حساب Google، خلال دقيقة." },
  { title: "ارفع سجلك وجدولك", text: "ملفا PDF من بوابة الجامعة، ويقرؤهما فطن تلقائيًا." },
  { title: "اسأل", text: "عن معدلك، أو موعد الانسحاب، أو أي نظام في الجامعة." },
];

const SOURCES = [
  "لائحة الدراسة والاختبارات",
  "قواعد حقوق الطلبة",
  "قواعد السلوك والانضباط الطلابي",
  "الدليل الإجرائي لسير الاختبارات",
  "لائحة الدراسات العليا",
  "دليل التدريب التعاوني",
  "لائحة صناديق الطلبة",
  "نظام الجامعات",
];

export default function LandingPage() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const startHref = user ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Navbar />

      {/* ── Hero: the product answering a real question ── */}
      <section className="container mx-auto max-w-6xl px-4 pt-28 pb-16 md:pt-36 md:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-7 text-center lg:text-right">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.15] tracking-tight text-balance">
              اسأل عن جامعتك،
              <br />
              وخذ الجواب من اللائحة.
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto lg:mx-0">
              فطن مساعد أكاديمي لطلاب جامعة أم القرى. يجيب عن أنظمة الدراسة بنص المادة الرسمية،
              ويقرأ سجلك وجدولك، ويرتّب مذاكرتك حتى نهاية الفصل.
            </p>
            <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
              <Button
                render={<Link href={startHref} />}
                nativeButton={false}
                size="lg"
                className="h-12 px-7 rounded-xl text-base font-bold bg-uqu-accent hover:bg-uqu-accent/90 text-white"
              >
                {user ? "افتح لوحتك" : "ابدأ مجانًا"}
              </Button>
              <Button
                render={<Link href="#features" />}
                nativeButton={false}
                size="lg"
                variant="outline"
                className="h-12 px-7 rounded-xl text-base font-bold"
              >
                وش يقدر يسوي؟
              </Button>
            </div>
          </div>

          {/* Chat demo */}
          <div className="relative">
            <div className="absolute -inset-6 rounded-[40px] bg-gradient-to-br from-uqu-accent/20 to-uqu-cyan/10 blur-3xl" aria-hidden />
            <div className="relative rounded-3xl border border-border bg-card shadow-2xl shadow-black/10 p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <LogoMark className="w-7 h-7" iconClassName="w-4 h-4" />
                <span className="font-bold text-sm">فطن</span>
                <span className="mr-auto text-[11px] text-muted-foreground">مثال حقيقي</span>
              </div>

              <div className="flex justify-start">
                <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-uqu-accent text-white px-4 py-2.5 text-sm font-medium">
                  {DEMO_QUESTION}
                </p>
              </div>

              <motion.div
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.5 }}
                className="flex justify-end"
              >
                <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-border bg-background px-4 py-3 space-y-3">
                  <p className="text-sm leading-7">{DEMO_ANSWER}</p>
                  <p className="flex items-start gap-1.5 text-[12px] font-semibold text-uqu-accent border-t border-border pt-2.5">
                    <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {DEMO_SOURCE}
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ── What it does ── */}
      <section id="features" className="border-t border-border bg-card/40 scroll-mt-16">
        <div className="container mx-auto max-w-6xl px-4 py-16 md:py-24">
          <h2 className="text-3xl md:text-4xl font-black mb-3">كل ما تحتاجه في فصلك الدراسي</h2>
          <p className="text-muted-foreground mb-12 max-w-2xl">
            أدوات مترابطة: ما ترفعه مرة واحدة يستفيد منه المساعد والخطة والحاسبة.
          </p>
          <ul className="grid gap-x-10 gap-y-2 md:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text, href }) => (
              <li key={title}>
                <Link
                  href={href}
                  className="group flex gap-4 rounded-2xl p-4 -mx-4 transition-colors hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-uqu-accent"
                >
                  <span className="mt-0.5 w-11 h-11 shrink-0 rounded-xl bg-uqu-accent/10 text-uqu-accent flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span>
                    <span className="block font-bold group-hover:text-uqu-accent transition-colors">{title}</span>
                    <span className="block text-sm text-muted-foreground leading-relaxed mt-1">{text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Getting started (a real sequence) ── */}
      <section className="container mx-auto max-w-6xl px-4 py-16 md:py-24">
        <h2 className="text-3xl md:text-4xl font-black mb-12">تبدأ في ثلاث خطوات</h2>
        <ol className="grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative pr-14">
              <span className="absolute right-0 top-0 w-10 h-10 rounded-full border-2 border-uqu-accent text-uqu-accent font-black flex items-center justify-center">
                {i + 1}
              </span>
              <h3 className="font-bold text-lg">{s.title}</h3>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Sources ── */}
      <section className="border-t border-border">
        <div className="container mx-auto max-w-6xl px-4 py-16 md:py-20 grid gap-10 lg:grid-cols-[1fr_1.4fr] items-start">
          <div>
            <h2 className="text-3xl font-black mb-3">مبني على المصادر الرسمية</h2>
            <p className="text-muted-foreground leading-relaxed">
              إجابات الأنظمة مأخوذة من لوائح جامعة أم القرى وقواعدها التنفيذية وأدلتها المنشورة،
              ويذكر فطن المادة التي اعتمد عليها حتى تتحقق بنفسك.
            </p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <li key={s} className="px-3.5 py-2 rounded-xl border border-border bg-card text-sm font-medium">
                {s}
              </li>
            ))}
            <li className="px-3.5 py-2 rounded-xl text-sm text-muted-foreground">وغيرها…</li>
          </ul>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="container mx-auto max-w-6xl px-4 pb-20">
        <div className="rounded-3xl bg-gradient-to-br from-uqu-accent to-uqu-cyan text-white p-8 md:p-12 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <h2 className="text-2xl md:text-3xl font-black">جاهز لفصل أهدأ؟</h2>
            <p className="text-white/85 mt-2">مجاني لطلاب جامعة أم القرى.</p>
          </div>
          <Button
            render={<Link href={startHref} />}
            nativeButton={false}
            size="lg"
            className="h-12 px-8 rounded-xl text-base font-bold bg-white text-uqu-accent hover:bg-white/90"
          >
            {user ? "افتح لوحتك" : "أنشئ حسابك"}
          </Button>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="container mx-auto max-w-6xl px-4 py-8 flex flex-col md:flex-row gap-4 md:items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <LogoMark className="w-7 h-7" iconClassName="w-4 h-4" />
            <span className="font-bold text-foreground">فطن</span>
          </div>
          <p className="leading-relaxed">
            مشروع طلابي مستقل، وليس جهة رسمية تابعة لجامعة أم القرى. المرجع النهائي هو عمادة القبول والتسجيل.
          </p>
        </div>
      </footer>
    </div>
  );
}
