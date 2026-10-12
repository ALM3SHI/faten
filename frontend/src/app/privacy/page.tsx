import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "الخصوصية وشروط الاستخدام — فطن",
  description: "كيف يتعامل فطن مع بياناتك، وشروط استخدام المنصة.",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 space-y-3">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="space-y-3 text-[15px] leading-8 text-foreground/90">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background pb-28" dir="rtl">
      <Navbar />
      <main className="container mx-auto pt-28 md:pt-32 px-4 max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowRight className="w-4 h-4" /> الرئيسية
        </Link>
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl font-black flex items-center gap-3 mb-3">
            <ShieldCheck className="w-8 h-8 text-uqu-accent" />
            الخصوصية وشروط الاستخدام
          </h1>
          <p className="text-muted-foreground">آخر تحديث: {SITE.legalUpdated}</p>
          <nav className="mt-5 flex flex-wrap gap-2 text-sm">
            {[
              ["#summary", "الخلاصة"],
              ["#data", "البيانات التي نجمعها"],
              ["#ai", "الذكاء الاصطناعي"],
              ["#storage", "التخزين والنقل"],
              ["#rights", "حقوقك"],
              ["#terms", "شروط الاستخدام"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="px-3 py-1.5 rounded-xl border border-foreground/10 bg-foreground/[0.03] hover:border-uqu-accent/40">
                {label}
              </a>
            ))}
          </nav>
        </header>

        <div className="space-y-12">
          <Section id="summary" title="الخلاصة">
            <ul className="list-disc pr-5 space-y-2">
              <li>فطن منصة طلابية <b>مستقلة</b>، وليست جهة رسمية تابعة لجامعة أم القرى.</li>
              <li>نجمع فقط ما تُدخله أنت لنقدّم لك الخدمة: سجلك الأكاديمي، جدولك، خطتك، غيابك، ومحادثاتك مع المساعد.</li>
              <li>لا نبيع بياناتك ولا نشاركها لأغراض إعلانية.</li>
              <li>تقدر تشوف ما يتذكره المساعد عنك وتحذفه، وتحذف حسابك وكل بياناتك نهائياً من صفحة <Link className="text-uqu-accent underline" href="/profile">الملف الشخصي</Link>.</li>
            </ul>
          </Section>

          <Section id="data" title="البيانات التي نجمعها ولماذا">
            <ul className="list-disc pr-5 space-y-2">
              <li><b>بيانات الحساب:</b> بريدك الإلكتروني واسمك (أو بيانات حساب Google إذا سجلت به) — لتسجيل الدخول.</li>
              <li><b>بياناتك الأكاديمية:</b> السجل الأكاديمي (المقررات والتقديرات والمعدل) والجدول الدراسي الذي ترفعه — لحساب معدلك وتحليل أدائك وتخصيص النصائح.</li>
              <li><b>بيانات التخطيط:</b> الخطة الدراسية، جلسات المذاكرة، الاختبارات القادمة، وسجل الغياب الذي تُدخله — لتنظيم وقتك وتنبيهك قبل الحرمان.</li>
              <li><b>المحادثات:</b> رسائلك مع المساعد وردوده — لعرض سجل محادثاتك ومتابعة السياق.</li>
              <li><b>ذاكرة المساعد:</b> معلومات قصيرة تذكرها عن نفسك (مثل هدفك في المعدل) — ليتذكرها في المحادثات القادمة. لا يحفظ معلومات صحية أو دينية أو مالية.</li>
              <li><b>تقييمات المقررات:</b> ما تكتبه في قسم المجتمع يظهر للطلاب <b>بدون اسمك</b>.</li>
              <li><b>تقييمك للردود (👍/👎):</b> مع السؤال والرد — لتحسين جودة المساعد فقط.</li>
              <li><b>عدّاد الاستخدام اليومي:</b> عدد طلبات الذكاء الاصطناعي اليومية — لتوزيع الخدمة المجانية بعدل.</li>
            </ul>
            <p>لا نطلب ولا نخزّن كلمة مرور بوابة الجامعة (أودس بلس أو غيرها).</p>
          </Section>

          <Section id="ai" title="المعالجة بالذكاء الاصطناعي">
            <p>
              عند استخدامك للمساعد أو لتحليل جدول/ملف، يُرسَل نص سؤالك وما يلزم من بياناتك الأكاديمية إلى خدمة <b>Google Gemini</b> لتوليد الرد.
              وإذا استخدمت الإدخال الصوتي وكانت الخدمة مفعّلة، يُرسَل المقطع الصوتي إلى خدمة تحويل الصوت إلى نص.
            </p>
            <p>
              ردود المساعد قد تخطئ. الأحكام النظامية تُستخرج من لوائح الجامعة المنشورة ويُذكر مصدرها، لكن <b>المرجع النهائي هو عمادة القبول والتسجيل</b> والجهات المختصة في الجامعة.
            </p>
          </Section>

          <Section id="storage" title="أين تُخزَّن بياناتك">
            <ul className="list-disc pr-5 space-y-2">
              <li>قاعدة البيانات وتسجيل الدخول واستضافة الموقع على <b>Google Firebase</b>.</li>
              <li>خادم المساعد مستضاف لدى <b>Render</b> في مركز بيانات بمدينة فرانكفورت (ألمانيا).</li>
              <li>يعني ذلك أن بياناتك قد تُعالَج خارج المملكة العربية السعودية لدى مزوّدين يطبّقون معايير حماية معتمدة. باستخدامك للمنصة توافق على هذا النقل لغرض تقديم الخدمة فقط.</li>
              <li>تبقى بياناتك ما دام حسابك قائماً، وتُحذف نهائياً عند حذف الحساب.</li>
              <li>نستخدم التخزين المحلي في متصفحك لحفظ إعداداتك ونسخة من بياناتك لتسريع الموقع، وتُمسح عند تسجيل الخروج.</li>
            </ul>
          </Section>

          <Section id="rights" title="حقوقك">
            <p>وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية، لك الحق في:</p>
            <ul className="list-disc pr-5 space-y-2">
              <li><b>العلم والاطلاع:</b> بياناتك كلها ظاهرة لك داخل المنصة.</li>
              <li><b>التصحيح:</b> عدّل بياناتك من الملف الشخصي، أو أعد رفع سجلك وجدولك.</li>
              <li><b>الإتلاف:</b> احذف ذاكرة المساعد أو حسابك كاملاً من <Link className="text-uqu-accent underline" href="/profile">الملف الشخصي</Link> — يُحذف كل شيء فوراً ونهائياً.</li>
              <li><b>التواصل:</b>{" "}
                {SITE.contactEmail ? (
                  <>راسلنا على <a className="text-uqu-accent underline" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.</>
                ) : (
                  <>عبر زر 👎 تحت أي رد في المحادثة مع كتابة ملاحظتك.</>
                )}
              </li>
            </ul>
          </Section>

          <Section id="terms" title="شروط الاستخدام">
            <ul className="list-disc pr-5 space-y-2">
              <li>المنصة أداة مساعدة للتخطيط والمذاكرة، ولا تغني عن مراجعة المرشد الأكاديمي والجهات الرسمية في الجامعة.</li>
              <li>أنت مسؤول عن صحة البيانات التي ترفعها وعن قراراتك الأكاديمية.</li>
              <li>تقييمات المقررات يجب أن تكون عن تجربة فعلية، بلا إساءة لأشخاص أو تشهير. نخفي التقييم المُبلَّغ عنه ويُراجع.</li>
              <li>لا يُسمح بإساءة استخدام المساعد أو محاولة تجاوز حدود الاستخدام اليومية.</li>
              <li>الخدمة مقدّمة «كما هي» وقد تتوقف مؤقتاً للصيانة أو بسبب حدود الخدمات المجانية.</li>
              <li>قد نحدّث هذه الصفحة، ونوضح تاريخ آخر تحديث أعلاها.</li>
            </ul>
          </Section>
        </div>
      </main>
    </div>
  );
}
