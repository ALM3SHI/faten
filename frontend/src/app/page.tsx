import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { LANDING_FAQ } from "@/lib/landing-content";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Structured data for search engines and AI assistants. The FAQ entries are
// the same strings the page shows (lib/landing-content.ts).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE.url}/#website`,
      url: `${SITE.url}/`,
      name: SITE.name,
      alternateName: "Faten",
      inLanguage: "ar",
      description: "المساعد الأكاديمي لطلاب جامعة أم القرى: اللوائح بالمادة الرسمية، المعدل، الجدول والمذاكرة.",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE.url}/#app`,
      name: SITE.name,
      alternateName: "Faten",
      url: `${SITE.url}/`,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: "ar",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "SAR" },
      image: `${SITE.url}/og.png`,
      screenshot: `${SITE.url}/landing/dashboard-dark.webp`,
      audience: { "@type": "EducationalAudience", educationalRole: "student" },
      featureList: [
        "إجابات عن لوائح جامعة أم القرى مع رقم المادة والمصدر",
        "حاسبة المعدل على سلّم 4.00",
        "خطة مذاكرة أسبوعية ومتابعة الغياب",
        "المرشد الأكاديمي لخطط كلية الحاسبات",
        "خريطة القاعات والمسار داخل المبنى",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE.url}/#faq`,
      inLanguage: "ar",
      mainEntity: LANDING_FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <LandingPage />
    </>
  );
}
