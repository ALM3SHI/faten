/**
 * Welcome tour shown once per account on the dashboard (see
 * components/onboarding/welcome-tour.tsx). Finishing or skipping it is
 * saved to users/{uid}/settings/tour so it does not come back on another
 * device; bump TOUR_VERSION to show a new tour to everyone again.
 */

export const TOUR_VERSION = 1;

/** This device remembers the account that finished the tour (cleared on logout). */
export const TOUR_LOCAL_KEY = "uqu_tour_done_v1";
/** Set by «عرض الجولة مرة ثانية» in the profile page, read once by the dashboard. */
export const TOUR_REPLAY_KEY = "uqu_tour_replay";

export type TourIcon = "welcome" | "profile" | "chat" | "exams" | "study" | "notifications";

export interface TourStep {
  id: string;
  icon: TourIcon;
  title: string;
  body: string;
  /** Optional shortcut to the page the step talks about. */
  link?: { href: string; label: string };
}

/** The steps, with the first-setup step adapted to whether the record is uploaded. */
export function tourSteps({ hasRecord }: { hasRecord: boolean }): TourStep[] {
  return [
    {
      id: "welcome",
      icon: "welcome",
      title: "أهلاً بك في فطن",
      body: "مساعدك الأكاديمي في جامعة أم القرى، في أربع مساحات تحت يدك: «اليوم» لما عليك الحين، «وقتي» لأسبوعك، «فطن» تسأله أو تذاكر معه، و«معدّلي» لوضعك الأكاديمي. خذ دقيقة نعرّفك عليها.",
    },
    hasRecord
      ? {
          id: "profile",
          icon: "profile",
          title: "ملفك الأكاديمي جاهز",
          body: "سجلك الأكاديمي مرفوع، و«معدّلي» يحسب منه معدلك وساعاتك وطريقك للتخرج. إذا تغيّر جدولك أو نزلت درجات جديدة حدّثها من الملف الشخصي (من صورة حسابك فوق).",
          link: { href: "/profile", label: "الملف الشخصي" },
        }
      : {
          id: "profile",
          icon: "profile",
          title: "ابدأ بسجلك الأكاديمي",
          body: "ارفع سجلك الأكاديمي وجدولك من الملف الشخصي (من صورة حسابك فوق). منها نحسب معدلك وساعاتك المنجزة وطريقك للتخرج، ونعرف مواد الترم ومحاضراتك.",
          link: { href: "/profile", label: "رفع السجل والجدول" },
        },
    {
      id: "chat",
      icon: "chat",
      title: "اسأل فطن",
      body: "اسأل فطن عن لوائح الجامعة، أو معدلك وكم تحتاج ترفعه، أو جدولك، أو «متى اختباري الجاي؟». فطن يرد من بياناتك ومن اللوائح الرسمية.",
      link: { href: "/chat", label: "افتح الدردشة" },
    },
    {
      id: "time",
      icon: "exams",
      title: "أسبوعك في «وقتي»",
      body: "محاضراتك وجلسات مذاكرتك واختباراتك في أجندة وحدة لكل يوم. سجّل غيابك من المحاضرة نفسها، وابدأ جلسة تركيز من أي جلسة، وأضف اختباراتك من زر «إضافة».",
      link: { href: "/time", label: "افتح وقتي" },
    },
    {
      id: "study",
      icon: "study",
      title: "ذاكر من ملف المحاضرة",
      body: "ارفع ملف المحاضرة مرة وحدة واختر: درس خطوة بخطوة يتأكد من فهمك موضوعاً موضوعاً، أو مراجعة سريعة بملخص ومصطلحات وبطاقات واختبار قصير.",
      link: { href: "/study", label: "ذاكر محاضرة" },
    },
    {
      id: "notifications",
      icon: "notifications",
      title: "خلّك على اطلاع",
      body: "فعّل الإشعارات على جوالك من الملف الشخصي: تذكير قبل المحاضرة، وتنبيه لما يقرب غيابك من الحد، وتذكير قبل اختباراتك.",
      link: { href: "/profile#notifications", label: "تفعيل الإشعارات" },
    },
  ];
}

/** Read a localStorage/sessionStorage value without throwing (private mode, SSR). */
export function readStorage(storage: "local" | "session", key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(storage: "local" | "session", key: string, value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    const s = storage === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // storage unavailable — the Firestore flag still covers it
  }
}
