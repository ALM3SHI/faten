/**
 * Regulation citations for chat answers.
 *
 * The agent's search_regulations results travel back in the response's
 * action log. We show a source card only for the articles the answer
 * actually cites, so the student never sees an unrelated "source".
 */

export interface Citation {
  document: string;
  article: string;
  url: string | null;
}

interface RegulationHit {
  document?: string;
  article?: string;
  heading?: string;
  source_url?: string;
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
      out.push({ document: doc, article: h.article ?? "", url: h.source_url ?? null });
      if (out.length >= max) break;
    }
  }
  return out;
}
