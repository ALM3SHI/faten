/**
 * Everything the command palette (Ctrl+K) can jump to or do, and the search
 * over it. Kept free of React and of the heavy map data so it can be tested
 * on its own; rooms are passed in by the palette once it has loaded them.
 */

import { ACCOUNT_LINKS, SECTIONS } from "@/lib/nav";

export type CommandGroup = "pages" | "actions" | "rooms" | "ask";

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** Shown after the label, e.g. the space a page belongs to. */
  hint?: string;
  /** Extra words that should also find this command. */
  keywords?: string;
  href?: string;
  /** Handled by the palette itself (it cannot be expressed as a link). */
  action?: "toggle-theme";
  adminOnly?: boolean;
}

/** Pages that exist but are reached from elsewhere, plus search words. */
const PAGE_KEYWORDS: Record<string, string> = {
  "/dashboard": "الرئيسية اليوم المحاضرة القادمة home today",
  "/time": "الأسبوع خطة المذاكرة التقويم week plan",
  "/schedule": "جدول المحاضرات schedule timetable",
  "/exams": "اختبار امتحان نهائي ميد exams",
  "/attendance": "غياب حضور حرمان attendance",
  "/pomodoro": "بومودورو مؤقت تركيز pomodoro timer",
  "/chat": "محادثة اسأل لوائح أنظمة chat",
  "/advisor": "مرشد تسجيل مواد تخرج خطة advisor",
  "/study": "ملخص بطاقات اختبار pdf محاضرة study",
  "/tutor": "شرح دروس اتقان tutor",
  "/record": "معدل ساعات gpa",
  "/gpa": "حاسبة محاكي درجات معدل gpa calculator",
  "/transcript": "سجل كشف درجات transcript",
  "/profile": "حساب إعدادات أهداف إشعارات خصوصية profile settings",
  "/locations": "خريطة قاعة مكتب معمل مبنى map rooms",
  "/community": "تقييم مواد آراء نصائح reviews",
  "/admin": "إدارة admin",
};

const LABEL_OVERRIDE: Record<string, string> = { "/locations": "الخريطة والقاعات" };

function pageCommands(): Command[] {
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      // /plan only forwards to /time
      if (page.href === "/plan" || seen.has(page.href)) continue;
      seen.add(page.href);
      out.push({
        id: `page:${page.href}`,
        group: "pages",
        label: page.label,
        hint: page.label === section.label ? undefined : section.label,
        keywords: PAGE_KEYWORDS[page.href],
        href: page.href,
      });
    }
  }
  for (const link of ACCOUNT_LINKS) {
    out.push({
      id: `page:${link.href}`,
      group: "pages",
      label: LABEL_OVERRIDE[link.href] ?? link.label,
      keywords: PAGE_KEYWORDS[link.href],
      href: link.href,
      adminOnly: link.adminOnly,
    });
  }
  out.push({ id: "page:/privacy", group: "pages", label: "الخصوصية وشروط الاستخدام", keywords: "privacy terms بيانات", href: "/privacy" });
  return out;
}

const ACTIONS: Command[] = [
  { id: "action:absence", group: "actions", label: "سجّل غيابًا", hint: "وقتي", keywords: "غبت غياب", href: "/time" },
  { id: "action:exam", group: "actions", label: "أضف اختبارًا", hint: "الاختبارات", keywords: "اختبار جديد موعد", href: "/exams" },
  { id: "action:focus", group: "actions", label: "ابدأ جلسة تركيز", hint: "بومودورو", keywords: "مؤقت مذاكرة", href: "/pomodoro" },
  { id: "action:lecture", group: "actions", label: "ذاكر ملف محاضرة", hint: "فطن", keywords: "رفع pdf ملخص", href: "/study" },
  { id: "action:simulate", group: "actions", label: "جرّب درجات هذا الفصل", hint: "محاكي المعدل", keywords: "توقع معدل", href: "/gpa" },
  { id: "action:theme", group: "actions", label: "بدّل بين الوضع الداكن والفاتح", keywords: "سمة ليلي نهاري theme dark light", action: "toggle-theme" },
];

export const COMMANDS: Command[] = [...pageCommands(), ...ACTIONS];

/**
 * Makes Arabic search forgiving: drops diacritics and tatweel, and treats
 * the letter variants people type interchangeably (أ إ آ ا · ى ي · ة ه) as one.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function score(command: Command, words: string[]): number {
  const label = normalize(command.label);
  const rest = normalize(`${command.hint ?? ""} ${command.keywords ?? ""}`);
  let total = 0;
  for (const word of words) {
    if (label.startsWith(word)) total += 4;
    else if (label.includes(word)) total += 3;
    else if (rest.includes(word)) total += 1;
    else return 0; // every word must match somewhere
  }
  return total;
}

export interface RoomLike {
  id: string;
  label: string;
}

/** Rooms become commands that open the map on that room. */
export function roomCommands(rooms: RoomLike[]): Command[] {
  return rooms.map((room) => ({
    id: `room:${room.id}`,
    group: "rooms" as const,
    label: room.label,
    hint: "على الخريطة",
    href: `/locations?target=${encodeURIComponent(room.id)}`,
  }));
}

const LIMIT: Record<CommandGroup, number> = { pages: 8, actions: 6, rooms: 6, ask: 1 };

/**
 * The commands to show for a query, best first inside each group. With no
 * query: the pages and the actions. A non-empty query always ends with
 * "ask Faten" so anything can be turned into a question.
 */
export function searchCommands(query: string, options: { rooms?: Command[]; admin?: boolean } = {}): Command[] {
  const q = normalize(query);
  const allowed = (c: Command) => !c.adminOnly || options.admin;
  if (!q) return COMMANDS.filter(allowed);

  const words = q.split(" ");
  const pool = [...COMMANDS, ...(options.rooms ?? [])].filter(allowed);
  const ranked = pool
    .map((command, index) => ({ command, index, value: score(command, words) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index);

  const taken: Record<CommandGroup, number> = { pages: 0, actions: 0, rooms: 0, ask: 0 };
  const out: Command[] = [];
  for (const group of ["pages", "actions", "rooms"] as const) {
    for (const { command } of ranked) {
      if (command.group !== group || taken[group] >= LIMIT[group]) continue;
      taken[group]++;
      out.push(command);
    }
  }
  out.push({
    id: "ask",
    group: "ask",
    label: `اسأل فطن: «${query.trim()}»`,
    href: `/chat?query=${encodeURIComponent(query.trim())}`,
  });
  return out;
}

export const GROUP_LABEL: Record<CommandGroup, string> = {
  pages: "الصفحات",
  actions: "أفعال سريعة",
  rooms: "القاعات",
  ask: "فطن",
};
