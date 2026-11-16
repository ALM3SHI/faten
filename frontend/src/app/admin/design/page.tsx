"use client";

/**
 * /admin/design — the living reference for design system v2. Every component
 * is shown here in every state, in whichever theme is active; the
 * accessibility suite requires this page to have zero violations.
 *
 * Nothing private is shown, so being signed in is enough to open it.
 */

import { useState } from "react";
import { BookOpenCheck, CalendarX2, Check, MapPin, Plus, Search, Trash2 } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { plexArabic } from "@/app/fonts/plex";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FileDrop,
  IconButton,
  Input,
  List,
  ListRow,
  Loading,
  Notice,
  PageHeader,
  Pill,
  SectionHeader,
  Select,
  Sheet,
  Skeleton,
  Stat,
  StatGroup,
  Textarea,
} from "@/components/ds";
import { cn } from "@/lib/utils";

const SWATCHES = [
  ["canvas", "bg-canvas"], ["surface", "bg-surface"], ["surface-raised", "bg-surface-raised"], ["surface-sunken", "bg-surface-sunken"],
  ["ink", "bg-ink"], ["ink-muted", "bg-ink-muted"], ["line", "bg-line"], ["line-strong", "bg-line-strong"], ["brand", "bg-brand"],
] as const;

const TYPE = [
  ["text-display", "3.62", "36 · رقم بارز"],
  ["text-title", "عنوان الصفحة", "28 · عنوان الصفحة"],
  ["text-heading", "عنوان القسم", "20 · عنوان قسم"],
  ["text-subheading", "عنوان البطاقة", "16 · عنوان بطاقة"],
  ["text-body", "النص الأساسي الذي يقرؤه الطالب في أغلب الشاشات.", "15 · نص أساسي"],
  ["text-small", "نص ثانوي يشرح أو يكمل.", "13 · نص ثانوي"],
  ["text-caption", "تسمية صغيرة", "12 · تسمية، وهو الحد الأدنى"],
] as const;

const SAMPLE =
  "يلتزم الطالب بحضور المحاضرات والدروس العملية، ويُحرم من دخول الاختبار النهائي إذا زادت نسبة غيابه بدون عذر عن 15% من مجموع المحاضرات المحددة للمقرر. والطالب الذي يُحرم من دخول الاختبار بسبب الغياب يعدّ راسبًا في المقرر، ويرصد له تقدير محروم (DN).";

function Section({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <SectionHeader title={title} text={text} />
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className={cn("min-h-screen bg-canvas pb-28 text-ink", plexArabic.variable)}>
      <Navbar />
      <main id="main" className="container mx-auto max-w-5xl space-y-12 px-4 pt-24">
        <PageHeader
          title="نظام التصميم"
          text="كل مكوّن في فطن بكل حالاته. الصفحات الجديدة تُبنى من هذه القطع فقط."
          action={<Button variant="primary" onClick={() => setSheet(true)}><Plus aria-hidden />افتح ورقة سفلية</Button>}
        />

        <Section title="الألوان" text="الأسطح والنص والحدود، ثم ألوان الحالة الأربعة. اللون يحمل معنى ولا يُستخدم للزينة.">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {SWATCHES.map(([label, bg]) => (
              <li key={label} className="space-y-1.5">
                <span className={cn("block h-14 rounded-control border border-line-strong", bg)} />
                <span className="block text-caption text-ink-muted" dir="ltr">{label}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Pill tone="success"><Check aria-hidden />آمن</Pill>
            <Pill tone="warning">انتبه: باقي لك غيابان</Pill>
            <Pill tone="danger">محروم</Pill>
            <Pill tone="info">مسجّلة هذا الفصل</Pill>
            <Pill>نظري</Pill>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Notice tone="success" title="تم حفظ تقييمك">يظهر لزملائك بدون اسمك.</Notice>
            <Notice tone="warning" title="اقتربت من حد الحرمان">غيابك 12% في قواعد البيانات، والحد 15%.</Notice>
            <Notice tone="danger" title="تعذّر قراءة الملف">الملف ممسوح ضوئيًا بلا نص. ارفع نسخة PDF من بوابة الجامعة.</Notice>
            <Notice tone="info" title="المصدر: المادة 14">لائحة الدراسة والاختبارات للمرحلة الجامعية.</Notice>
          </div>
        </Section>

        <Section title="الخطوط" text="سبعة أحجام فقط، ولا شيء أصغر من 12.">
          <Card className="divide-y divide-line p-0 sm:p-0">
            {TYPE.map(([cls, sample, note]) => (
              <div key={cls} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
                <span className={cn(cls, cls === "text-display" ? "nums font-extrabold" : cls === "text-body" || cls === "text-small" || cls === "text-caption" ? "" : "font-bold")}>{sample}</span>
                <span className="text-caption text-ink-muted">{note}</span>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="خط النص: مقارنة" text="نفس الفقرة بالخطين وبنفس الحجم. الهدف اختيار خط القراءة الطويلة للمحادثة والخصوصية.">
          <div className="grid gap-4 md:grid-cols-2">
            <Card as="article" className="space-y-2">
              <h3 className="text-subheading font-semibold">Cairo (الحالي)</h3>
              <p className="text-body" data-testid="sample-cairo">{SAMPLE}</p>
            </Card>
            <Card as="article" className="space-y-2">
              <h3 className="text-subheading font-semibold">IBM Plex Sans Arabic (المقترح)</h3>
              <p className="font-body text-body" data-testid="sample-plex">{SAMPLE}</p>
            </Card>
          </div>
        </Section>

        <Section title="الأزرار" text="فعل أساسي واحد في كل شاشة. الحجم الافتراضي 44 بكسلًا ليناسب اللمس.">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">ابنِ خطة الأسبوع</Button>
              <Button>تعديل</Button>
              <Button variant="quiet">إلغاء</Button>
              <Button variant="danger"><Trash2 aria-hidden />حذف الحساب</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg">ابدأ مجانًا</Button>
              <Button variant="primary">متوسط</Button>
              <Button variant="primary" size="sm">صغير</Button>
              <Button variant="primary" disabled>معطّل</Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  setTimeout(() => setBusy(false), 1500);
                }}
              >
                {busy ? "جاري الحفظ" : "اضغط لتجربة التحميل"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <IconButton label="بحث"><Search aria-hidden /></IconButton>
              <IconButton label="إضافة" variant="secondary"><Plus aria-hidden /></IconButton>
              <IconButton label="حذف" variant="danger"><Trash2 aria-hidden /></IconButton>
            </div>
          </Card>
        </Section>

        <Section title="الحقول" text="التسمية والمساعدة والخطأ مربوطة بالحقل تلقائيًا.">
          <Card className="grid gap-5 sm:grid-cols-2">
            <Field label="الاسم" hint="كما تحب أن يناديك فطن.">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="عمر" autoComplete="off" />
            </Field>
            <Field label="المعدل المستهدف" error="المعدل يجب أن يكون بين 0 و 4.00." required>
              <Input defaultValue="4.5" inputMode="decimal" />
            </Field>
            <Field label="التقدير المتوقع">
              <Select defaultValue="A">
                <option value="A+">A+</option>
                <option value="A">A</option>
                <option value="B+">B+</option>
              </Select>
            </Field>
            <Field label="الرقم الجامعي" hint="لا يمكن تغييره بعد رفع السجل.">
              <Input defaultValue="441000000" disabled />
            </Field>
            <Field label="نصيحة لمن سيدرس المادة" className="sm:col-span-2">
              <Textarea placeholder="كيف تذاكرها؟ وش أهم شي فيها؟" />
            </Field>
            <div className="sm:col-span-2">
              <FileDrop title="اختر ملف السجل الأكاديمي (PDF)" hint={file ? `تم اختيار: ${file}` : "أو اسحب الملف هنا"} accept=".pdf,application/pdf" onFile={(f) => setFile(f.name)} />
            </div>
          </Card>
        </Section>

        <Section title="الأرقام" text="الرقم أولًا ثم تسميته. أرقام جدولية ثابتة العرض.">
          <Card>
            <StatGroup>
              <Stat label="المعدل التراكمي" value="3.62" hint="من 4.00" />
              <Stat label="الساعات المنجزة" value="41" unit="/ 132" />
              <Stat label="الغياب" value="آمن" tone="success" />
              <Stat label="المعدل المطلوب للهدف" value="3.90" tone="warning" />
              <Stat label="مواد مهددة" value="1" tone="danger" />
            </StatGroup>
          </Card>
        </Section>

        <Section title="القوائم" text="صف واحد لكل عنصر، والصف كله رابط إن كان يفتح شيئًا.">
          <List>
            <ListRow leading={<BookOpenCheck aria-hidden />} title="الذكاء الاصطناعي" detail="الأحد 8:00 ص · قاعة A-101" trailing={<Pill tone="success">آمن</Pill>} href="/attendance" />
            <ListRow leading={<BookOpenCheck aria-hidden />} title="قواعد البيانات" detail="الثلاثاء 10:00 ص · قاعة B-204" trailing={<Pill tone="warning">غيابان</Pill>} href="/attendance" />
            <ListRow leading={<MapPin aria-hidden />} title="المكتبة" detail="الدور الأرضي" />
          </List>
        </Section>

        <Section title="الحالات" text="كل شاشة بيانات لها أربع حالات: تحميل، فارغة، خطأ، نجاح.">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <Loading className="space-y-3">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-11 w-32" />
              </Loading>
            </Card>
            <EmptyState
              art={<CalendarX2 />}
              title="ما عندك اختبارات مسجّلة"
              text="أضف اختبارك القادم ويبدأ العدّ التنازلي وخطة المراجعة."
              action={<Button variant="primary"><Plus aria-hidden />أضف اختبارًا</Button>}
            />
            <ErrorState kind="waking" onRetry={() => {}} />
            <ErrorState kind="offline" onRetry={() => {}} />
          </div>
        </Section>
      </main>

      <Sheet open={sheet} onOpenChange={setSheet} title="المكتبة">
        <div className="space-y-4">
          <p className="text-body text-ink-muted">الدور الأرضي · من المدخل الرئيسي 85 م، دقيقة ونصف مشيًا.</p>
          <Button variant="primary" className="w-full" onClick={() => setSheet(false)}>ابدأ المسار</Button>
        </div>
      </Sheet>
    </div>
  );
}
