/**
 * UQU ACADEMIC CORE - Consolidated Logic
 * Merged from: transcript-parser.js, student-model.js, plan-generator.js
 */

// Official UQU 4.00 grade-point scale. Kept in sync with the canonical
// map at lib/transcript-parser.ts. Do NOT reintroduce a 5.0 variant.
export const GRADE_MAP: Record<string, number> = {
  'A+': 4.00, 'A': 3.75, 'B+': 3.50, 'B': 3.00,
  'C+': 2.50, 'C': 2.00, 'D+': 1.50, 'D': 1.00,
  'F': 0.00, 'DN': 0, 'W': 0, 'IP': 0, 'IC': 0, 'NP': 0
};

export const GRADE_LABELS: Record<string, string> = {
  'A+': 'ممتاز مرتفع', 'A': 'ممتاز', 'B+': 'جيد جداً مرتفع', 
  'B': 'جيد جداً', 'C+': 'جيد مرتفع', 'C': 'جيد', 
  'D+': 'مقبول مرتفع', 'D': 'مقبول', 'F': 'راسب', 'DN': 'محروم'
};

export interface Course {
  code: string;
  name: string;
  nameEn?: string;
  nameAr?: string;
  creditHours: number;
  grade?: string;
  gradePoints?: number;
  semester?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  type?: string;
}

export interface Semester {
  nameAr: string;
  nameEn: string;
  term: string;
  year: string;
  sgpa: number | null;
  cgpa: number | null;
  totalHours: number;
  courses: Course[];
  status: 'completed' | 'current' | 'registered';
}

/**
 * Calculates GPA and other metrics from academic state
 */
export function calculateGPAMetrics(currentGpa: number | string, earnedHours: number | string, courses: Course[]) {
  const cGpa = Number(currentGpa) || 0;
  const eHrs = Number(earnedHours) || 0;
  
  let termPoints = 0;
  let termHours = 0;

  courses.forEach(course => {
    const pts = Number(course.gradePoints ?? (course.grade ? (GRADE_MAP[course.grade] || 0) : 0));
    const hrs = Number(course.creditHours) || 0;
    if (hrs > 0) {
      termPoints += pts * hrs;
      termHours += hrs;
    }
  });

  const termGpa = termHours > 0 ? termPoints / termHours : 0;
  const totalEarned = eHrs + termHours;
  const allPoints = (cGpa * eHrs) + termPoints;
  const newGpa = totalEarned > 0 ? allPoints / totalEarned : 0;

  return {
    newGpa: Number(Math.min(4, newGpa).toFixed(4)),
    termGpa: Number(Math.min(4, termGpa).toFixed(4)),
    termHours,
    totalEarned
  };
}

/**
 * Parses numeric strings from Arabic/English formats
 */
export function parseArNum(s: string): string {
  if (!s) return '';
  return String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString()).replace(/٫/g, '.');
}

/**
 * Common Course Code Regex
 */
export const COURSE_CODE_RE = /^[A-Z]{2,4}\d{3,4}T?$/;
