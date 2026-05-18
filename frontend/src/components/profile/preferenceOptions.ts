/**
 * Shared option catalogs for the Smart Preferences UI.
 * Both the modal grids and the compact summary chips look options up here
 * so labels/emojis stay in sync.
 */

import type {
  EnergyPeak,
  TaskStrategy,
  LearningStyle,
  DayOff,
  ProfilePreferences,
} from "@/store/profileStore";

export interface OptionMeta<V extends string> {
  value: V;
  emoji: string;
  titleAr: string;
  subtitleAr: string;
}

export const PEAK_OPTIONS: OptionMeta<EnergyPeak>[] = [
  { value: "morning",   emoji: "🌅", titleAr: "صباحي",      subtitleAr: "6 ص – 12 ظ" },
  { value: "afternoon", emoji: "🌇", titleAr: "مسائي",      subtitleAr: "12 ظ – 6 م" },
  { value: "night",     emoji: "🦉", titleAr: "كائن ليلي",  subtitleAr: "9 م – 2 ص" },
];

export const STRATEGY_OPTIONS: OptionMeta<TaskStrategy>[] = [
  { value: "eat_frog", emoji: "🐸", titleAr: "أكل الضفدع", subtitleAr: "ابدأ بالأصعب أولاً" },
  { value: "snowball", emoji: "⛄", titleAr: "كرة الثلج",  subtitleAr: "ابدأ بالأسهل لبناء الزخم" },
];

export const LEARNING_OPTIONS: OptionMeta<LearningStyle>[] = [
  { value: "visual",      emoji: "👀", titleAr: "بصري",        subtitleAr: "رسوم ومخططات" },
  { value: "auditory",    emoji: "🎧", titleAr: "سمعي",        subtitleAr: "محاضرات وبودكاست" },
  { value: "kinesthetic", emoji: "🏃", titleAr: "حركي",        subtitleAr: "تطبيق عملي" },
  { value: "reading",     emoji: "📖", titleAr: "قرائي/كتابي", subtitleAr: "ملخصات ومراجعة" },
];

export const FOCUS_OPTIONS = [25, 30, 45, 50];
export const SHORT_BREAK_OPTIONS = [5, 10, 15];
export const LONG_BREAK_OPTIONS = [15, 20, 30];

export const DAY_OFF_OPTIONS: { value: DayOff; label: string; emoji: string }[] = [
  { value: "sunday",    label: "الأحد",     emoji: "📅" },
  { value: "monday",    label: "الإثنين",   emoji: "📅" },
  { value: "tuesday",   label: "الثلاثاء",  emoji: "📅" },
  { value: "wednesday", label: "الأربعاء",  emoji: "📅" },
  { value: "thursday",  label: "الخميس",    emoji: "📅" },
  { value: "friday",    label: "الجمعة",    emoji: "🕌" },
  { value: "saturday",  label: "السبت",     emoji: "🌴" },
  { value: "none",      label: "بدون",      emoji: "♾️" },
];

function findOption<V extends string>(
  list: OptionMeta<V>[],
  value: V,
): OptionMeta<V> | undefined {
  return list.find((o) => o.value === value);
}

/**
 * Build the chips shown on the compact summary card.
 * Each chip is an emoji + short label, ordered to match the modal sections.
 */
export function summarizePreferences(p: ProfilePreferences): { emoji: string; label: string }[] {
  const peak = findOption(PEAK_OPTIONS, p.energyPeak);
  const strategy = findOption(STRATEGY_OPTIONS, p.taskStrategy);
  const learning = findOption(LEARNING_OPTIONS, p.learningStyle);
  const day = DAY_OFF_OPTIONS.find((d) => d.value === p.dayOff);

  return [
    peak     && { emoji: peak.emoji,     label: peak.titleAr },
    strategy && { emoji: strategy.emoji, label: strategy.titleAr },
    learning && { emoji: learning.emoji, label: learning.titleAr },
    { emoji: "⏱️", label: `${p.pomodoroFocus} د` },
    day      && { emoji: day.emoji,      label: `راحة: ${day.label}` },
  ].filter(Boolean) as { emoji: string; label: string }[];
}
