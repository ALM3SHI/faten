/**
 * UQU Transcript Parser — TypeScript port of the battle-tested vanilla JS
 * parser shipped with the legacy PWA. Uses `pdfjs-dist` to extract every
 * text item with its (x, y) coordinates and reconstructs the transcript's
 * table structure geometrically — no AI involved.
 *
 * This file is the SOLE source of truth for transcript extraction. The
 * backend's job is reduced to academic advisory on top of this output.
 *
 * Worker setup:
 *   pdf.worker.min.mjs is copied to /public so it's served from `/pdf.worker.min.mjs`.
 *   That keeps it independent of bundler quirks (Turbopack vs Webpack).
 */

import type {
  PDFDocumentProxy,
  TextItem,
} from "pdfjs-dist/types/src/display/api";
import { GRADE_POINTS, normalizeGrade } from "@/lib/grade-scale";

// ──────────────────────────────────────────────────────────────────────
// Constants — ported verbatim from the legacy parser
// ──────────────────────────────────────────────────────────────────────

const COURSE_CODE_RE = /^[A-Z]{2,4}\d{3,4}T?$/;

const AR_SKIP_LABELS =
  /^(رمز|اسم|معتمدة|مكتسبة|الدرجة|التقدير|النقاط|المجموع|الفصل|الكلية|القسم|التخصص|الحالة|منتظم|ممتاز|جيد|مقبول|راسب|محروم|الساعات|Course|Code|Name|Crd|Pass|Degree|Grade|Points|Hours|Hourse|sum|Faculty|Dept|Status|Major)/i;

// ──────────────────────────────────────────────────────────────────────
// Types — exposed shape (compatible with the legacy renderer)
// ──────────────────────────────────────────────────────────────────────

export interface ParsedCourse {
  code: string;
  nameEn: string;
  nameAr: string;
  creditHours: number;
  passHours: number;
  degree: number;
  grade: string | null;
  points: number;
  gradePoints: number | null;
}

export interface EnrichedCourse extends ParsedCourse {
  name: string;
  semester: string;
  semesterEn: string;
  semesterStatus: SemesterStatus;
  difficulty: "easy" | "medium" | "hard";
  type: "theory";
}

export type SemesterStatus = "completed" | "current" | "registered";

export interface Semester {
  nameEn: string;
  nameAr: string;
  term: string;
  year: string;
  sgpa: number | null;
  cgpa: number | null;
  totalHours: number;
  totalPassedHours: number;
  courses: ParsedCourse[];
  status: SemesterStatus;
}

export interface StudentInfo {
  name?: string;
  nameEn?: string;
  studentId?: string;
  university?: string;
  major?: string;
  majorEn?: string;
  faculty?: string;
  degree?: string;
  studyType?: "full" | "part" | string;
  gpa?: number;
  earnedHours?: number;
  planHours?: number;
  totalPoints?: number;
}

export interface ParsedTranscript {
  name: string | null;
  nameEn: string | null;
  studentId: string | null;
  university: string | null;
  major: string | null;
  majorEn: string | null;
  faculty: string | null;
  degree: string | null;
  studyType: string | null;
  gpa: number | null;
  earnedHours: number | null;
  planHours: number | null;
  totalPoints: number | null;
  semesters: Semester[];
  completedCourses: EnrichedCourse[];
  registeredCourses: EnrichedCourse[];
  currentSemesterCourses: EnrichedCourse[];
  allCourses: EnrichedCourse[];
  pageCount: number;
  confidence: number;
}

// Internal: a single text fragment with its position on the page.
interface TextFragment {
  s: string; // text content (NFKC-normalized, trimmed)
  x: number; // left edge
  y: number; // baseline (from bottom in pdf.js coords)
  w: number; // width
}

interface PageData {
  items: TextFragment[];
  pw: number; // page width (CSS px at scale=1)
  ph: number; // page height
}

interface ColumnMap {
  code?: number;
  name?: number;
  crd?: number;
  pass?: number;
  deg?: number;
  grade?: number;
  pts?: number;
}

// ──────────────────────────────────────────────────────────────────────
// pdf.js loader — dynamic import so SSR doesn't choke on the worker
// ──────────────────────────────────────────────────────────────────────

type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (typeof window === "undefined") {
    throw new Error("transcript-parser must run in the browser, not on the server.");
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = await import("pdfjs-dist");
      // Worker is shipped from /public/pdf.worker.min.mjs so we don't
      // rely on bundler URL rewriting. See public/pdf.worker.min.mjs.
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    })();
  }
  return pdfjsPromise;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function arNum(s: string | undefined | null): string {
  if (!s) return "";
  return String(s)
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
    .replace(/٫/g, ".");
}

async function extractPages(file: File): Promise<PageData[]> {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const pdf: PDFDocumentProxy = await pdfjs.getDocument({ data: buf }).promise;
  const pages: PageData[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const vp = page.getViewport({ scale: 1.0 });
    const items: TextFragment[] = (content.items as TextItem[])
      .filter((it) => it.str && it.str.trim())
      .map((it) => {
        const raw = it.str.trim();
        const s = typeof raw.normalize === "function" ? raw.normalize("NFKC") : raw;
        return {
          s,
          x: Math.round(it.transform[4] * 10) / 10,
          y: Math.round(it.transform[5] * 10) / 10,
          w: Math.round(it.width * 10) / 10,
        };
      });
    pages.push({
      items,
      pw: Math.round(vp.width),
      ph: Math.round(vp.height),
    });
  }
  return pages;
}

function buildRows(items: TextFragment[], tol = 3): TextFragment[][] {
  if (!items.length) return [];
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextFragment[][] = [];
  let curr: TextFragment[] = [sorted[0]];
  let cy = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - cy) <= tol) {
      curr.push(sorted[i]);
    } else {
      curr.sort((a, b) => a.x - b.x);
      rows.push(curr);
      curr = [sorted[i]];
      cy = sorted[i].y;
    }
  }
  if (curr.length) {
    curr.sort((a, b) => a.x - b.x);
    rows.push(curr);
  }
  return rows;
}

function detectColumns(rows: TextFragment[][], pw: number): ColumnMap | null {
  const mid = pw / 2;
  for (const row of rows) {
    const left = row.filter((i) => i.x < mid);
    const txt = left.map((i) => i.s).join(" ");
    if (
      /Course/i.test(txt) &&
      (/Code/i.test(txt) || /Name/i.test(txt)) &&
      (/Grade/i.test(txt) || /Degree/i.test(txt) || /Points/i.test(txt) || /Hours/i.test(txt))
    ) {
      const cols: ColumnMap = {};
      for (const item of left) {
        const sl = item.s.toLowerCase().trim();
        if (/course\s*code/i.test(item.s)) {
          cols.code = item.x;
        } else if (sl === "course" && cols.code === undefined) {
          cols.code = item.x;
        } else if (/course\s*name/i.test(item.s)) {
          cols.name = item.x;
        } else if (sl === "crd." || sl === "crd" || sl === "hrs." || sl === "hrs") {
          cols.crd = item.x;
        } else if (sl === "hours" && cols.crd === undefined) {
          cols.crd = item.x;
        } else if (sl === "pass" || sl === "hourse" || sl === "passed") {
          cols.pass = item.x;
        } else if (sl === "hours" && cols.crd !== undefined) {
          cols.pass = item.x;
        } else if (sl === "degree") {
          cols.deg = item.x;
        } else if (sl === "grade") {
          cols.grade = item.x;
        } else if (sl === "points") {
          cols.pts = item.x;
        }
      }
      if (Object.keys(cols).length >= 3) return cols;
    }
  }
  return null;
}

function _cleanCourseName(name: string): string {
  if (!name) return name;
  const cutPatterns: RegExp[] = [
    /\s*(?:Crd|Passed)\s*Hrs?\s*:/i,
    /\s*Dean\s+of/i,
    /\s*Dr\.\s+[A-Z]/i,
    /\s*Accum\s*GPA/i,
    /\s*عميد/,
    /\s*م[\.٫]التراكمي/,
    /\s*م[\.٫]الفصلي/,
    /\s*الساعات\s*المعتمدة/,
    /\s*الساعات\s*المكتسبة/,
    /\s*د\.\s/,
    /\s*القبول\s*والتسجيل/,
  ];
  let out = name;
  for (const re of cutPatterns) {
    const idx = out.search(re);
    if (idx > 0) out = out.substring(0, idx);
  }
  return out.trim();
}

function _extractArabicName(rightItems: TextFragment[]): string {
  const parts: string[] = [];
  for (const item of rightItems) {
    const s = item.s;
    if (!/[؀-ۿﭐ-﷿ﹰ-﻿]/.test(s)) continue;
    if (COURSE_CODE_RE.test(s.replace(/\s/g, ""))) continue;
    if (/^[٠-٩۰-۹\d٫.,\s]+$/.test(s)) continue;
    if (/^[\+]?(أ|ب|ج|د|هـ|ح|م|ر)[\+]?$/.test(s)) continue;
    if (AR_SKIP_LABELS.test(s)) continue;
    if (s.length <= 1) continue;
    parts.push(s);
  }
  return parts.join(" ").trim();
}

function _parseWithColumns(
  left: TextFragment[],
  right: TextFragment[],
  code: string,
  codeItem: TextFragment,
  cols: ColumnMap,
  mid: number,
): ParsedCourse {
  const colKeys = Object.keys(cols) as (keyof ColumnMap)[];
  const sortedKeys = colKeys
    .filter((k) => cols[k] !== undefined)
    .sort((a, b) => (cols[a] ?? 0) - (cols[b] ?? 0));
  const bounds: Record<string, { lo: number; hi: number }> = {};
  for (let i = 0; i < sortedKeys.length; i++) {
    const k = sortedKeys[i];
    const prevK = sortedKeys[i - 1];
    const nextK = sortedKeys[i + 1];
    bounds[k] = {
      lo: prevK ? Math.floor(((cols[prevK] ?? 0) + (cols[k] ?? 0)) / 2) : 0,
      hi: nextK ? Math.floor(((cols[k] ?? 0) + (cols[nextK] ?? 0)) / 2) : mid + 50,
    };
  }
  const mapped: Record<string, string[]> = {};
  for (const item of left) {
    if (item === codeItem) continue;
    for (const key of sortedKeys) {
      const b = bounds[key];
      if (item.x >= b.lo && item.x < b.hi) {
        if (!mapped[key]) mapped[key] = [];
        mapped[key].push(item.s);
        break;
      }
    }
  }
  let nameEn = (mapped.name || []).join(" ").trim();
  if (!nameEn && mapped.code && mapped.code.length > 0) {
    nameEn = mapped.code
      .filter((s) => !COURSE_CODE_RE.test(s.replace(/\s/g, "")))
      .join(" ")
      .trim();
  }
  const crdH = parseInt((mapped.crd || [])[0] ?? "") || 0;
  const passH = parseInt((mapped.pass || [])[0] ?? "") || 0;
  const deg = parseInt((mapped.deg || [])[0] ?? "") || 0;
  const gradeStr = ((mapped.grade || [])[0] || "").trim();
  const pts = parseFloat((mapped.pts || [])[0] ?? "") || 0;
  const grade = normalizeGrade(gradeStr);
  const nameAr = _extractArabicName(right);
  return {
    code,
    nameEn: _cleanCourseName(nameEn),
    nameAr: _cleanCourseName(nameAr),
    creditHours: crdH,
    passHours: passH,
    degree: deg,
    grade,
    points: pts,
    gradePoints: grade ? GRADE_POINTS[grade] ?? null : null,
  };
}

function _parseByPattern(
  left: TextFragment[],
  right: TextFragment[],
  code: string,
  codeItem: TextFragment,
): ParsedCourse {
  const afterCode = left
    .filter((i) => i.x > codeItem.x)
    .sort((a, b) => a.x - b.x);
  const items = afterCode.map((i) => i.s.trim()).filter(Boolean);
  let grade: string | null = null;
  const numbers: number[] = [];
  let dataStart = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i];
    if (/^(A\+?|B\+?|C\+?|D\+?|F|W|DN|IP|IC|NP)$/i.test(s)) {
      grade = s.toUpperCase();
      dataStart = i;
    } else if (/^\d+\.?\d*$/.test(s)) {
      numbers.unshift(parseFloat(s));
      dataStart = i;
    } else {
      break;
    }
  }
  const nameTokens = items.slice(0, dataStart);
  const nameAr = _extractArabicName(right);
  grade = normalizeGrade(grade);
  return {
    code,
    nameEn: _cleanCourseName(nameTokens.join(" ")),
    nameAr: _cleanCourseName(nameAr),
    creditHours: numbers[0] || 0,
    passHours: numbers[1] || 0,
    degree: numbers[2] || 0,
    grade,
    points: numbers.length > 3 ? numbers[numbers.length - 1] : numbers[3] || 0,
    gradePoints: grade ? GRADE_POINTS[grade] ?? null : null,
  };
}

function parseCourseRow(
  rowItems: TextFragment[],
  mid: number,
  cols: ColumnMap | null,
): ParsedCourse | null {
  let dataBound = mid;
  if (cols) {
    let maxCol = 0;
    for (const ck in cols) {
      if (Object.prototype.hasOwnProperty.call(cols, ck)) {
        const v = cols[ck as keyof ColumnMap];
        if (v !== undefined && v > maxCol) maxCol = v;
      }
    }
    dataBound = Math.max(mid, maxCol + 50);
  }
  const left = rowItems.filter((i) => i.x < dataBound).sort((a, b) => a.x - b.x);
  const right = rowItems.filter((i) => i.x >= dataBound);

  let code: string | null = null;
  let codeItem: TextFragment | null = null;
  for (const item of left) {
    const cleaned = item.s.replace(/\s/g, "");
    if (COURSE_CODE_RE.test(cleaned)) {
      code = cleaned;
      codeItem = item;
      break;
    }
  }
  if (!code || !codeItem) return null;

  const rowText = rowItems.map((i) => i.s).join(" ");
  if (/Course\s*Code|Course\s*Name|رمز المقرر|اسم المقرر/i.test(rowText)) return null;

  if (cols) return _parseWithColumns(left, right, code, codeItem, cols, mid);
  return _parseByPattern(left, right, code, codeItem);
}

function parseSemesters(pages: PageData[]): Semester[] {
  const semesters: Semester[] = [];
  for (const page of pages) {
    const rows = buildRows(page.items);
    const mid = page.pw / 2;
    const cols = detectColumns(rows, page.pw);
    let curSem: Semester | null = null;
    let lastCourse: ParsedCourse | null = null;

    for (const row of rows) {
      const leftItems = row.filter((i) => i.x < mid);
      const rightItems = row.filter((i) => i.x >= mid);
      const leftText = leftItems.map((i) => i.s).join(" ");
      const fullText = row.map((i) => i.s).join(" ");

      const semMatch = leftText.match(/(First|Second|Third)\s+Semester\s+(\d{4}\/\d{4})/i);
      if (semMatch) {
        if (curSem) semesters.push(curSem);
        const arSorted = rightItems.slice().sort((a, b) => b.x - a.x);
        const arText = arSorted.map((i) => i.s).join(" ");
        const arMatch = arText.match(
          /الفصل\s+(الأول|الثاني|الثالث)\s+([\d٠-٩]{4}(?:[\/-][\d٠-٩]{4})?)/,
        );
        const termMap: Record<string, string> = {
          First: "الأول",
          Second: "الثاني",
          Third: "الثالث",
        };
        const arLabel = arMatch
          ? `الفصل ${arMatch[1]} ${arNum(arMatch[2])}`
          : `الفصل ${termMap[semMatch[1]] || semMatch[1]} ${semMatch[2].replace(/\//g, "/")}`;
        curSem = {
          nameEn: semMatch[0],
          nameAr: arLabel,
          term: semMatch[1],
          year: semMatch[2],
          sgpa: null,
          cgpa: null,
          totalHours: 0,
          totalPassedHours: 0,
          courses: [],
          status: "completed",
        };
        lastCourse = null;
        continue;
      }
      if (!curSem) continue;
      if (/Course\s*Code|Course\s*Name|Crd\.|Hours\b.*Hourse|رمز المقرر|اسم المقرر/i.test(fullText))
        continue;
      if (/^(Faculty|Dept|Status|Major)\s*:/i.test(leftText.trim())) continue;
      if (
        /Dean\s+of|عميد|Crd\s*Hrs\s*:|Passed\s*Hrs\s*:|Accum\s*GPA|الساعات\s*المعتمدة|الساعات\s*المكتسبة|Registration|التسجيل|Dr\.\s+[A-Z]/i.test(
          fullText,
        )
      )
        continue;

      const sgpa = leftText.match(/S\.GPA\s*:?\s*(\d+\.\d+)/);
      const cgpa = leftText.match(/Ac\.\s*GPA\s*:?\s*(\d+\.\d+)/);
      if (sgpa) curSem.sgpa = parseFloat(sgpa[1]);
      if (cgpa) curSem.cgpa = parseFloat(cgpa[1]);
      if (sgpa || cgpa) continue;

      const arSgpa = fullText.match(/م\.الفصلي\s*:?\s*([\d٠-٩]+[٫.][\d٠-٩]+)/);
      const arCgpa = fullText.match(/م\.التراكمي\s*:?\s*([\d٠-٩]+[٫.][\d٠-٩]+)/);
      if (arSgpa && curSem.sgpa == null) curSem.sgpa = parseFloat(arNum(arSgpa[1]));
      if (arCgpa && curSem.cgpa == null) curSem.cgpa = parseFloat(arNum(arCgpa[1]));
      if (arSgpa || arCgpa) continue;

      if (/\bsum\b/i.test(leftText) || /المجموع/i.test(fullText)) {
        const sumMatch = leftText.match(/(\d+)\s+(\d+)\s+sum/i);
        if (sumMatch) {
          curSem.totalHours = parseInt(sumMatch[1]) || 0;
          curSem.totalPassedHours = parseInt(sumMatch[2]) || 0;
        }
        continue;
      }
      if (
        /^[\s\-]*(?:Excellent|Very Good|Good|Poor|ممتاز|جيد)/.test(leftText.trim()) &&
        !/\d{3}/.test(leftText)
      )
        continue;

      const course = parseCourseRow(row, mid, cols);
      if (course) {
        curSem.courses.push(course);
        lastCourse = course;
      } else if (lastCourse) {
        // Continuation row: append continuation text to the last course's name.
        const contItems = leftItems.filter(
          (i) =>
            !/^\d/.test(i.s) &&
            !COURSE_CODE_RE.test(i.s.replace(/\s/g, "")) &&
            !/^(A\+?|B\+?|C\+?|D\+?|F|W)$/i.test(i.s) &&
            !/sum|gpa|faculty|dept|status|major|excellent|good|dean|registr|crd\s*hrs|passed\s*hrs|accum|dr\./i.test(
              i.s,
            ) &&
            i.s.length > 1,
        );
        if (contItems.length > 0 && contItems.length <= 3) {
          const cont = contItems.map((i) => i.s).join(" ");
          if (cont.length > 1 && cont.length < 60) {
            lastCourse.nameEn = (lastCourse.nameEn + " " + cont).trim();
          }
        }
        const arCont = rightItems.filter(
          (i) =>
            /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(i.s) &&
            !COURSE_CODE_RE.test(i.s.replace(/\s/g, "")) &&
            !AR_SKIP_LABELS.test(i.s) &&
            !/^[\+]?(أ|ب|ج|د|هـ|ح|م|ر)[\+]?$/.test(i.s) &&
            !/^[٠-٩\d٫.,\s]+$/.test(i.s) &&
            i.s.length > 1,
        );
        if (arCont.length > 0 && arCont.length <= 3) {
          const arContText = arCont.map((i) => i.s).join(" ");
          if (arContText.length > 1) {
            lastCourse.nameAr = ((lastCourse.nameAr || "") + " " + arContText).trim();
          }
        }
      }
    }
    if (curSem) {
      for (const c of curSem.courses) {
        c.nameEn = _cleanCourseName(c.nameEn);
        c.nameAr = _cleanCourseName(c.nameAr);
      }
      semesters.push(curSem);
    }
  }
  return _dedup(semesters);
}

function _dedup(semesters: Semester[]): Semester[] {
  const map: Record<string, Semester> = {};
  const order: string[] = [];
  for (const sem of semesters) {
    const key = sem.nameEn;
    if (!key) continue;
    if (map[key]) {
      const existing = map[key];
      const existCodes: Record<string, boolean> = {};
      for (const c of existing.courses) existCodes[c.code] = true;
      for (const c of sem.courses) {
        if (!existCodes[c.code]) existing.courses.push(c);
      }
      if (existing.sgpa == null && sem.sgpa != null) existing.sgpa = sem.sgpa;
      if (existing.cgpa == null && sem.cgpa != null) existing.cgpa = sem.cgpa;
      if (!existing.totalHours && sem.totalHours) existing.totalHours = sem.totalHours;
    } else {
      const copy: Semester = { ...sem, courses: sem.courses.slice() };
      map[key] = copy;
      order.push(key);
    }
  }
  return order.map((k) => map[k]);
}

function extractStudentInfo(pages: PageData[]): StudentInfo {
  const info: StudentInfo = {};
  if (!pages.length) return info;
  const rows = buildRows(pages[0].items);
  const mid = pages[0].pw / 2;
  for (const row of rows) {
    const leftText = row
      .filter((i) => i.x < mid)
      .sort((a, b) => a.x - b.x)
      .map((i) => i.s)
      .join(" ");
    const fullText = row.map((i) => i.s).join(" ");

    if (!info.studentId) {
      const m = fullText.match(/(?:Student\s*ID|الرقم الجامعي)\s*[:\s]*(\d{9,10})/);
      if (m) info.studentId = m[1];
    }
    if (!info.nameEn) {
      let m = leftText.match(/Name\s*:\s*$/);
      if (m) {
        const nameItems = row.filter((i) => i.x < mid && /^[A-Z][A-Z\s,.']+$/.test(i.s));
        if (nameItems.length > 0) info.nameEn = nameItems.map((i) => i.s).join(" ").trim();
      }
      m = leftText.match(/Name\s*:?\s*([A-Z][A-Z\s,.']{3,})/);
      if (m && !info.nameEn) info.nameEn = m[1].trim();
    }
    if (!info.name) {
      if (/الاسم|الإسم/.test(fullText)) {
        const arNameItems = row.filter(
          (i) =>
            /[؀-ۿﭐ-﷿ﹰ-﻿]{2,}/.test(i.s) &&
            !/الاسم|الإسم|الحالة|منتظم|الرقم|الجامعي|التاريخ|الصفحة/.test(i.s) &&
            i.s.length > 3,
        );
        if (arNameItems.length > 0) {
          info.name = arNameItems.map((i) => i.s).join(" ").trim();
        }
      }
    }
    if (!info.gpa) {
      const m = fullText.match(/GPA\s*:?\s*(\d+\.\d+)/);
      if (m) info.gpa = parseFloat(m[1]);
    }
    if (!info.majorEn) {
      const m = leftText.match(/Major\s*:?\s*([A-Za-z][A-Za-z\s]{2,})/i);
      if (m) {
        const cand = m[1].trim();
        if (!/^(Bachelor|Master|First|Second|Third|Active|Full|Part)$/i.test(cand)) {
          info.majorEn = cand;
        }
      }
    }
    if (!info.major) {
      if (/التخصص/.test(fullText)) {
        const arMajorItems = row.filter(
          (i) =>
            /[؀-ۿﭐ-﷿ﹰ-﻿]{2,}/.test(i.s) &&
            !/التخصص|القسم|الكلية|الحالة|الفصل|بكالوريوس|إنتظام|منتظم|الدرجة|نوع/.test(i.s) &&
            i.s.length > 3,
        );
        if (arMajorItems.length > 0) {
          info.major = arMajorItems.map((i) => i.s).join(" ").trim();
        }
      }
    }
    if (!info.faculty) {
      const m = leftText.match(/Faculty\s*:?\s*([A-Za-z][A-Za-z\s]+?)(?:\s{2,}|$)/i);
      if (m) {
        const fac = m[1].trim();
        if (!/^(Major|Dept|Status)$/i.test(fac) && fac.length > 3) info.faculty = fac;
      }
    }
    if (!info.degree) {
      const m = fullText.match(/Degree\s*:?\s*(Bachelor|Master|Ph\.?D\.?)/i);
      if (m) info.degree = m[1];
    }
    if (!info.studyType) {
      const m = fullText.match(/Study\s*type\s*:?\s*(Full\s*Time|Part\s*Time)/i);
      if (m) info.studyType = /full/i.test(m[1]) ? "full" : "part";
    }
  }
  const allText = pages[0].items.map((i) => i.s).join(" ");
  if (/Umm Al.?Qura|أم القرى|ﺃﻡ ﺍﻟﻘﺮﻯ/i.test(allText)) info.university = "جامعة أم القرى";
  else if (/King Abdulaziz|الملك عبدالعزيز/i.test(allText)) info.university = "جامعة الملك عبدالعزيز";
  if (!info.university) {
    const allPagesText = pages.map((p) => p.items.map((i) => i.s).join(" ")).join(" ");
    if (/\bQR\d{4}/.test(allPagesText) && /\bELCE\d{4}/.test(allPagesText)) {
      info.university = "جامعة أم القرى";
    }
  }
  const lastPage = pages[pages.length - 1];
  const lastText = lastPage.items.map((i) => i.s).join(" ");
  let m;
  m = lastText.match(/Crd\s*Hrs?\s*:\s*(\d+)/i);
  if (m) info.planHours = parseInt(m[1]);
  m = lastText.match(/Passed\s*Hrs?\s*:\s*(\d+)/i);
  if (m) info.earnedHours = parseInt(m[1]);
  m = lastText.match(/Accum\s*GPA\s*:\s*(\d+\.\d+)/i);
  if (m) info.gpa = parseFloat(m[1]);
  m = lastText.match(/Points\s*:\s*(\d+\.?\d*)/i);
  if (m) info.totalPoints = parseFloat(m[1]);
  m = lastText.match(/الساعات المعتمدة\s*:\s*([\d٠-٩]+)/);
  if (m && !info.planHours) info.planHours = parseInt(arNum(m[1]));
  m = lastText.match(/الساعات المكتسبة\s*:\s*([\d٠-٩]+)/);
  if (m && !info.earnedHours) info.earnedHours = parseInt(arNum(m[1]));
  return info;
}

function classifySemesters(semesters: Semester[]): void {
  for (const sem of semesters) {
    const hasGrades = sem.courses.some((c) => c.grade != null);
    const allZero = sem.courses.every((c) => c.creditHours === 0);
    const anyZeroDeg = sem.courses.every((c) => c.degree === 0);
    if ((!hasGrades && allZero) || (!hasGrades && anyZeroDeg && sem.courses.length > 0)) {
      sem.status = "registered";
    } else if (hasGrades) {
      sem.status = "completed";
    } else {
      sem.status = "current";
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────

export async function parseTranscriptPDF(file: File): Promise<ParsedTranscript> {
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("الملف يجب أن يكون بصيغة PDF");
  }
  const pages = await extractPages(file);
  const info = extractStudentInfo(pages);
  const semesters = parseSemesters(pages);
  classifySemesters(semesters);

  const completedCourses: EnrichedCourse[] = [];
  const registeredCourses: EnrichedCourse[] = [];
  for (const sem of semesters) {
    for (const c of sem.courses) {
      const enriched: EnrichedCourse = {
        ...c,
        name: c.nameAr || c.nameEn,
        semester: sem.nameAr || sem.nameEn,
        semesterEn: sem.nameEn,
        semesterStatus: sem.status,
        difficulty: c.creditHours >= 4 ? "hard" : c.creditHours <= 2 ? "easy" : "medium",
        type: "theory",
      };
      if (sem.status === "registered") registeredCourses.push(enriched);
      else completedCourses.push(enriched);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Canonical cumulative GPA — always recomputed from the parsed
  // per-course gradePoints (now on the official UQU 4.00 scale) so
  // the displayed cumulative ALWAYS matches the per-course points
  // shown elsewhere in the app. The registrar PDF may print GPAs in
  // multiple forms (4.0 and 5.0); ignoring `info.gpa` here guarantees
  // there is exactly one number, on one scale, end-to-end.
  // ──────────────────────────────────────────────────────────────
  let cumulativePoints = 0;
  let cumulativeHours = 0;
  for (const c of completedCourses) {
    if (c.gradePoints == null || c.creditHours <= 0) continue;
    cumulativePoints += c.gradePoints * c.creditHours;
    cumulativeHours += c.creditHours;
  }
  const canonicalGpa =
    cumulativeHours > 0
      ? Math.round((cumulativePoints / cumulativeHours) * 100) / 100
      : null;

  const result: ParsedTranscript = {
    name: info.name || null,
    nameEn: info.nameEn || null,
    studentId: info.studentId || null,
    university: info.university || null,
    major: info.major || null,
    majorEn: info.majorEn || null,
    faculty: info.faculty || null,
    degree: info.degree || null,
    studyType: info.studyType || null,
    gpa: canonicalGpa,
    earnedHours: info.earnedHours ?? cumulativeHours,
    planHours: info.planHours ?? null,
    totalPoints: cumulativeHours > 0 ? cumulativePoints : info.totalPoints ?? null,
    semesters,
    completedCourses,
    registeredCourses,
    currentSemesterCourses: registeredCourses,
    allCourses: completedCourses.concat(registeredCourses),
    pageCount: pages.length,
    confidence: 0,
  };
  let conf = 0;
  if (result.name || result.nameEn) conf += 15;
  if (result.studentId) conf += 10;
  if (result.gpa) conf += 20;
  if (result.earnedHours) conf += 10;
  if (result.planHours) conf += 5;
  if (result.major || result.majorEn) conf += 10;
  if (semesters.length > 0) conf += 15;
  if (completedCourses.length > 0) conf += 15;
  result.confidence = Math.min(conf, 100);
  return result;
}
