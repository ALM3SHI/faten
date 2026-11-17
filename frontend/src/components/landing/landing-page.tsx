"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  BookOpenCheck,
  Calculator,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  GraduationCap,
  Lock,
  MapPinned,
  MessageSquare,
  ShieldCheck,
  Smartphone,
  Timer,
  Users,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { BrowserShot, PhoneShot } from "@/components/landing/shots";
import { LANDING_FAQ, LANDING_STATS } from "@/lib/landing-content";

// Real answer from the knowledge base (study & exams regulation, art. 14,
// UQU executive rule 1) — the landing page shows what Faten actually does.
const DEMO_QUESTION = "كم أغيب قبل ما أنحرم من الاختبار النهائي؟";
const DEMO_ANSWER =
  "تُحرم من دخول الاختبار النهائي إذا زاد غيابك عن 25% بعذر، أو عن 15% بدون عذر، من مجموع المحاضرات والدروس العملية. وفي كل الأحوال لا يجوز أن تقل نسبة حضورك عن 75%.";
const DEMO_SOURCE = "المادة 14 — لائحة الدراسة والاختبارات (القواعد التنفيذية لأم القرى)";

/** The four spaces of the app, each shown with its real screen. */
const SHOWCASE = [
  {
    id: "ask",
    eyebrow: "فطن",
    icon: BookOpenCheck,
    title: "جواب من اللائحة، مع رقم المادة",
    text: "تسأل بلهجتك عن الحرمان أو الاعتذار أو الانسحاب، فيبحث فطن في اللوائح الرسمية ويجيبك ويعرض المصدر. تضغط على المادة وتقرأ نصها بنفسك.",
    points: ["39 لائحة ونظامًا ودليلًا منشورًا", "رابط للمصدر الرسمي في موقع الجامعة", "يعرف سجلك وجدولك فيجيب عن وضعك أنت"],
    shot: "chat",
    alt: "شاشة المحادثة: سؤال عن الحرمان وإجابة فطن مع بطاقة المصدر «المادة 14 — لائحة الدراسة والاختبارات»",
    href: "/chat",
    cta: "اسأل فطن",
  },
  {
    id: "gpa",
    eyebrow: "معدّلي",
    icon: Calculator,
    title: "معدلك، وكيف توصل للّي تبيه",
    text: "ارفع سجلك مرة واحدة، وشوف معدلك وساعاتك وتطورك فصلًا بفصل. جرّب درجات هذا الفصل قبل ما تطلع، واعرف أي مادة ترفع معدلك أكثر.",
    points: ["حاسبة على السلّم الرسمي من 4.00", "المعدل المطلوب للوصول إلى هدفك", "المرشد الأكاديمي: مواد الفصل القادم وطريق التخرج"],
    shot: "record",
    alt: "شاشة «معدّلي»: المعدل التراكمي، الساعات المنجزة، المعدل المستهدف، ومنحنى تطور المعدل عبر الفصول",
    href: "/record",
    cta: "افتح معدّلي",
  },
  {
    id: "time",
    eyebrow: "وقتي",
    icon: CalendarCheck,
    title: "أسبوعك كله في شاشة واحدة",
    text: "محاضراتك واختباراتك وجلسات المذاكرة في أسبوع واحد. فطن يوزّع المراجعة على أوقات فراغك الفعلية، ويحسب غيابك وينبّهك قبل ما تقرب من الحرمان.",
    points: ["خطة مذاكرة تبتعد عن محاضراتك ويوم راحتك", "عدّاد غياب لكل مادة", "مؤقت تركيز مرتبط بمهام خطتك"],
    shot: "time",
    alt: "شاشة «وقتي»: أيام الأسبوع مع المحاضرات وجلسات المذاكرة وزر بناء خطة الأسبوع",
    href: "/time",
    cta: "افتح وقتي",
  },
  {
    id: "map",
    eyebrow: "الخريطة",
    icon: MapPinned,
    title: "تعرف طريقك للقاعة",
    text: "ابحث عن القاعة أو المعمل أو مكتب الدكتور، ويرسم لك فطن المسار داخل المبنى من المدخل الرئيسي مع المسافة والوقت التقريبي.",
    points: ["89 موقعًا: قاعات ومعامل ومكاتب", "مسار مرسوم على مخطط المبنى", "زر «وين القاعة؟» من محاضرتك القادمة مباشرة"],
    shot: "map",
    alt: "شاشة الخريطة: مخطط الدور الأرضي لمبنى الكلية مع قائمة القاعات والمكاتب والبحث",
    href: "/locations",
    cta: "افتح الخريطة",
  },
] as const;

const MORE = [
  { icon: MessageSquare, title: "ذاكر محاضرة", text: "ارفع ملف المحاضرة، ويشرحه لك فطن موضوعًا موضوعًا ويختبر فهمك قبل ما ينتقل." },
  { icon: GraduationCap, title: "المرشد الأكاديمي", text: "مواد الفصل القادم ومخاطر الخطة وسيناريوهات التخرج، محسوبة من خطة تخصصك الرسمية." },
  { icon: CalendarDays, title: "التقويم الجامعي 1448هـ", text: "الانسحاب والاعتذار والاختبارات، مع عدّ تنازلي للموعد القادم." },
  { icon: Users, title: "تقييمات المواد", text: "آراء ونصائح من طلاب درسوا المادة فعلًا، بدون أسماء." },
  { icon: Timer, title: "مؤقت التركيز", text: "جلسات بومودورو مرتبطة بمهام خطتك، ويُحسب إنجازك تلقائيًا." },
  { icon: Smartphone, title: "تطبيق على جوالك", text: "أضف فطن إلى الشاشة الرئيسية وفعّل تنبيهات المحاضرات والاختبارات." },
] as const;

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

const TRUST = [
  { icon: ShieldCheck, text: "لا نبيع بياناتك ولا نشاركها للإعلانات" },
  { icon: Lock, text: "لا نطلب كلمة مرور بوابة الجامعة" },
  { icon: FileText, text: "كل حكم نظامي معه مصدره" },
];

export function LandingPage() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const startHref = user ? "/dashboard" : "/login";

  // Sections fade up once as they scroll into view. The static HTML ships the
  // hidden starting state, so the reveal must always run: with reduced motion
  // it still happens, just instantly and without movement.
  const reveal = {
    initial: { opacity: 0, y: reduce ? 0 : 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-80px" },
    transition: { duration: reduce ? 0 : 0.5, ease: "easeOut" as const },
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-[60] focus:rounded-xl focus:bg-uqu-accent focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
      >
        تخطَّ إلى المحتوى
      </a>
      <Navbar />

      <main id="main">
        {/* ── Hero: the product answering a real question ── */}
        <section className="relative">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(60%_60%_at_80%_0%,var(--accent-glow),transparent_70%),radial-gradient(45%_50%_at_10%_20%,var(--accent-2-dim),transparent_70%)]"
            aria-hidden
          />
          <div className="container mx-auto max-w-6xl px-4 pt-28 pb-12 md:pt-36 md:pb-16">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
              <div className="space-y-7 text-center lg:text-right">
                <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-bold text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-uqu-success" aria-hidden />
                  لطلاب جامعة أم القرى · مجاني
                </p>
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
                    {user ? "افتح فطن" : "ابدأ مجانًا"}
                  </Button>
                  <Button
                    render={<Link href="#tour" />}
                    nativeButton={false}
                    size="lg"
                    variant="outline"
                    className="h-12 px-7 rounded-xl text-base font-bold"
                  >
                    وش يقدر يسوي؟
                  </Button>
                </div>
                <ul className="flex flex-wrap gap-x-5 gap-y-2 justify-center lg:justify-start text-sm text-muted-foreground">
                  {TRUST.map(({ icon: Icon, text }) => (
                    <li key={text} className="inline-flex items-center gap-1.5">
                      <Icon className="w-4 h-4 text-uqu-accent" aria-hidden />
                      {text}
                    </li>
                  ))}
                </ul>
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
          </div>

          {/* The real product: today's screen on desktop and phone */}
          <div className="container mx-auto max-w-6xl px-4 pb-16 md:pb-24">
            <motion.div {...reveal} className="relative">
              <BrowserShot
                name="dashboard"
                eager
                alt="شاشة «اليوم» في فطن: المحاضرة القادمة، محاضرات اليوم، نظرة على الأسبوع، والمعدل والساعات والغياب"
              />
              <PhoneShot
                name="phone-dashboard"
                alt="شاشة «اليوم» على الجوال"
                className="hidden sm:block absolute -bottom-10 left-6 w-[21%] max-w-[230px] lg:left-12"
              />
            </motion.div>
          </div>
        </section>

        {/* ── Numbers counted from the product itself ── */}
        <section aria-label="فطن بالأرقام" className="border-y border-border bg-card/40">
          <dl className="container mx-auto max-w-6xl px-4 py-10 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
            {LANDING_STATS.map((s) => (
              <div key={s.label} className="text-center lg:text-right">
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="block text-4xl md:text-5xl font-black tracking-tight bg-gradient-to-l from-uqu-accent to-uqu-cyan bg-clip-text text-transparent" dir="ltr">
                    {s.value}
                  </span>
                  <span className="block font-bold mt-1" aria-hidden>{s.label}</span>
                  <span className="block text-sm text-muted-foreground mt-0.5">{s.hint}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Short walkthrough clip ── */}
        <section className="container mx-auto max-w-6xl px-4 py-16 md:py-24">
          <motion.div {...reveal} className="grid gap-10 lg:grid-cols-[1fr_1.6fr] items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-black mb-3">جولة سريعة في فطن</h2>
              <p className="text-muted-foreground leading-relaxed">
                من شاشة اليوم، إلى سؤال عن الحرمان يجيبه فطن من اللائحة، ثم معدّلك وأسبوعك.
                تسجيل من الموقع نفسه بحساب تجريبي.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-2xl shadow-black/20">
              <video
                className="block w-full aspect-video"
                controls
                muted
                playsInline
                preload="none"
                poster="/landing/dashboard-dark.webp"
                aria-label="جولة مصوّرة قصيرة في فطن، بدون صوت"
              >
                <source src="/landing/demo.webm" type="video/webm" />
                متصفحك لا يشغّل هذا المقطع. الصور في الأسفل تعرض الشاشات نفسها.
              </video>
            </div>
          </motion.div>
        </section>

        {/* ── The four spaces, each with its real screen ── */}
        <section id="tour" className="border-t border-border scroll-mt-16">
          <div className="container mx-auto max-w-6xl px-4 py-16 md:py-24">
            <h2 className="text-3xl md:text-4xl font-black mb-3">كل ما تحتاجه في فصلك الدراسي</h2>
            <p className="text-muted-foreground mb-14 max-w-2xl">
              أدوات مترابطة: ما ترفعه مرة واحدة يستفيد منه المساعد والخطة والحاسبة.
            </p>
            <div className="space-y-20 md:space-y-28">
              {SHOWCASE.map(({ id, eyebrow, icon: Icon, title, text, points, shot, alt, href, cta }, i) => (
                <motion.article
                  key={id}
                  {...reveal}
                  className="grid items-center gap-8 lg:gap-14 lg:grid-cols-[1fr_1.35fr]"
                >
                  <div className={i % 2 ? "lg:order-2" : undefined}>
                    <p className="inline-flex items-center gap-2 text-sm font-bold text-uqu-accent mb-3">
                      <span className="w-9 h-9 rounded-xl bg-uqu-accent/10 flex items-center justify-center">
                        <Icon className="w-[18px] h-[18px]" aria-hidden />
                      </span>
                      {eyebrow}
                    </p>
                    <h3 className="text-2xl md:text-3xl font-black leading-snug mb-3">{title}</h3>
                    <p className="text-muted-foreground leading-relaxed mb-5">{text}</p>
                    <ul className="space-y-2.5 mb-6">
                      {points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm font-medium">
                          <Check className="w-4 h-4 mt-1 shrink-0 text-uqu-success" aria-hidden />
                          {p}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={href}
                      className="inline-flex items-center gap-1.5 font-bold text-uqu-accent hover:underline focus-visible:outline-2 focus-visible:outline-uqu-accent rounded"
                    >
                      {cta}
                      <ArrowLeft className="w-4 h-4" aria-hidden />
                    </Link>
                  </div>
                  <BrowserShot name={shot} alt={alt} />
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* ── And more ── */}
        <section id="features" className="border-t border-border bg-card/40 scroll-mt-16">
          <div className="container mx-auto max-w-6xl px-4 py-16 md:py-20">
            <h2 className="text-3xl font-black mb-10">وأكثر</h2>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {MORE.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-2xl border border-border bg-background p-5">
                  <span className="w-11 h-11 rounded-xl bg-uqu-accent/10 text-uqu-accent flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5" aria-hidden />
                  </span>
                  <h3 className="font-bold">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">{text}</p>
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

        {/* ── FAQ (mirrored as FAQPage structured data in app/page.tsx) ── */}
        <section id="faq" className="border-t border-border bg-card/40 scroll-mt-16">
          <div className="container mx-auto max-w-3xl px-4 py-16 md:py-20">
            <h2 className="text-3xl font-black mb-8">أسئلة متكررة</h2>
            <div className="space-y-3">
              {LANDING_FAQ.map(({ q, a }) => (
                <details key={q} className="group rounded-2xl border border-border bg-background open:shadow-lg open:shadow-black/5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-bold focus-visible:outline-2 focus-visible:outline-uqu-accent rounded-2xl [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown className="w-5 h-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="px-5 pb-5 text-[15px] leading-8 text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              التفاصيل كاملة في{" "}
              <Link href="/privacy" className="font-bold text-uqu-accent underline">الخصوصية وشروط الاستخدام</Link>.
            </p>
          </div>
        </section>

        {/* ── Closing CTA ── */}
        <section className="container mx-auto max-w-6xl px-4 py-16 md:py-20">
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
              {user ? "افتح فطن" : "أنشئ حسابك"}
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="container mx-auto max-w-6xl px-4 py-12 grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <LogoMark className="w-8 h-8" iconClassName="w-[18px] h-[18px]" />
              <span className="font-black text-lg">فطن</span>
            </div>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed max-w-sm">
              مشروع طلابي مستقل، وليس جهة رسمية تابعة لجامعة أم القرى. المرجع النهائي هو عمادة القبول والتسجيل.
            </p>
          </div>
          <nav aria-label="روابط المنتج">
            <h2 className="font-bold mb-3">المنتج</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="#tour" className="hover:text-foreground">المزايا</Link></li>
              <li><Link href="/locations" className="hover:text-foreground">خريطة القاعات</Link></li>
              <li><Link href="#faq" className="hover:text-foreground">أسئلة متكررة</Link></li>
              <li><Link href="/login" className="hover:text-foreground">تسجيل الدخول</Link></li>
            </ul>
          </nav>
          <nav aria-label="روابط قانونية">
            <h2 className="font-bold mb-3">الثقة</h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/privacy" className="underline hover:text-foreground">الخصوصية والشروط</Link></li>
              <li><Link href="/privacy#ai" className="hover:text-foreground">الذكاء الاصطناعي وبياناتك</Link></li>
              <li><Link href="/privacy#rights" className="hover:text-foreground">حقوقك وحذف الحساب</Link></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-border">
          <p className="container mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground">
            © {new Date().getFullYear()} فطن. اللوائح والأنظمة ملك لجهاتها الرسمية.
          </p>
        </div>
      </footer>
    </div>
  );
}
