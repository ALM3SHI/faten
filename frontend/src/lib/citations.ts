/**
 * Sources for chat answers.
 *
 * The agent's search_regulations and get_calendar_info results travel back
 * in the response's action log. We show a source card only for what the
 * answer actually uses, so the student never sees an unrelated "source".
 * The card opens the article's text (or the calendar dates) in the chat.
 */

export interface Citation {
  document: string;
  article: string;
  url: string | null;
  /** Section title inside the document, when it says more than the article number. */
  heading?: string;
  /** The article text (or the calendar dates) as the agent received it. */
  text?: string;
  issued?: string;
  /** e.g. the OCR warning for scanned documents. */
  note?: string;
}

interface RegulationHit {
  document?: string;
  article?: string;
  heading?: string;
  text?: string;
  issued?: string;
  note?: string;
  source_url?: string;
}

interface CalendarEvent {
  title?: string;
  date?: string;
  hijri?: string;
}

interface CalendarResult {
  success?: boolean;
  data?: CalendarEvent[];
  source?: { document?: string; url?: string };
}

interface ToolLogEntry {
  tool?: string;
  result?: unknown;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalize(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** Article numbers cited in the text: "المادة 14", "المادة (14)", "م. 14". */
export function citedArticleNumbers(text: string): Set<number> {
  const out = new Set<number>();
  const re = /(?:الماده|م\.)\s*[\(\[]?\s*(\d{1,3})/g;
  for (const m of normalize(text).matchAll(re)) out.add(Number(m[1]));
  return out;
}

function articleNumber(article: string | undefined): number | null {
  const m = normalize(article ?? "").match(/^الماده\s*(\d{1,3})$/);
  return m ? Number(m[1]) : null;
}

/** First few words of a regulation title — enough to tell two documents apart. */
function docKey(title: string): string {
  return normalize(title).split(" ").slice(0, 3).join(" ");
}

export function extractCitations(content: string, actions: ToolLogEntry[] | undefined, max = 4): Citation[] {
  if (!content || !Array.isArray(actions)) return [];
  const out = regulationCitations(content, actions, max);
  const calendar = calendarCitation(content, actions);
  if (calendar && out.length < max) out.push(calendar);
  return out;
}

function regulationCitations(content: string, actions: ToolLogEntry[], max: number): Citation[] {
  const hits: RegulationHit[] = [];
  for (const a of actions) {
    if (a?.tool !== "search_regulations") continue;
    const results = (a.result as { results?: RegulationHit[] } | null)?.results;
    if (Array.isArray(results)) hits.push(...results);
  }
  if (hits.length === 0) return [];

  const text = normalize(content);
  const cited = citedArticleNumbers(content);
  const out: Citation[] = [];
  const seen = new Set<string>();

  for (const h of hits) {
    const doc = h.document ?? "";
    const num = articleNumber(h.article);
    let match = false;
    if (num !== null && cited.has(num)) {
      const sameNumberDocs = new Set(
        hits.filter((x) => articleNumber(x.article) === num).map((x) => x.document),
      );
      match = sameNumberDocs.size === 1 || text.includes(docKey(doc));
    } else if (num === null && h.heading && normalize(h.heading).length > 6) {
      match = text.includes(normalize(h.heading));
    }
    const key = `${doc}|${h.article}`;
    if (match && !seen.has(key)) {
      seen.add(key);
      out.push({
        document: doc,
        article: h.article ?? "",
        url: h.source_url ?? null,
        ...(h.heading && h.heading !== h.article ? { heading: h.heading } : {}),
        ...(h.text ? { text: h.text } : {}),
        ...(h.issued ? { issued: h.issued } : {}),
        ...(h.note ? { note: h.note } : {}),
      });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** One card for the academic calendar when the answer uses its events (by name or Hijri date). */
function calendarCitation(content: string, actions: ToolLogEntry[]): Citation | null {
  const text = normalize(content);
  const used: CalendarEvent[] = [];
  let source: CalendarResult["source"];
  for (const a of actions) {
    if (a?.tool !== "get_calendar_info") continue;
    const r = a.result as CalendarResult | null;
    if (!r?.success || !Array.isArray(r.data) || !r.source?.document) continue;
    source = r.source;
    for (const ev of r.data) {
      const title = normalize(ev.title ?? "");
      const hijriStart = (ev.hijri ?? "").split(" ")[0];
      const mentioned = (title.length > 4 && text.includes(title)) || (hijriStart.length >= 5 && text.includes(hijriStart));
      if (mentioned && !used.some((u) => u.title === ev.title)) used.push(ev);
    }
  }
  if (!source?.document || used.length === 0) return null;
  return {
    document: source.document,
    article: used[0].title ?? "",
    url: source.url ?? null,
    text: used.map((ev) => `${ev.title}: ${ev.date}${ev.hijri ? ` (${ev.hijri}هـ)` : ""}`).join("\n"),
  };
}
