"use client";

import { useEffect } from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The browser's own message for an invalid field, in Arabic (lib-free). */
export function arabicValidationMessage(el: Field): string {
  const v = el.validity;
  if (v.valid) return "";
  const input = el instanceof HTMLInputElement ? el : null;
  if (v.valueMissing) {
    if (el instanceof HTMLSelectElement) return "اختر من القائمة.";
    if (input?.type === "date") return "اختر التاريخ.";
    if (input?.type === "time") return "اختر الوقت.";
    if (input?.type === "file") return "اختر الملف.";
    if (input?.type === "checkbox") return "علّم هذا الخيار للمتابعة.";
    return "هذا الحقل مطلوب.";
  }
  if (v.typeMismatch) return input?.type === "email" ? "اكتب بريداً إلكترونياً صحيحاً، مثل name@uqu.edu.sa." : "القيمة المكتوبة غير صحيحة.";
  if (v.rangeUnderflow) return `أقل قيمة مسموحة ${input?.min}.`;
  if (v.rangeOverflow) return `أعلى قيمة مسموحة ${input?.max}.`;
  if (v.tooShort) return `اكتب ${(el as HTMLInputElement).minLength} أحرف على الأقل.`;
  if (v.tooLong) return `الحد الأقصى ${(el as HTMLInputElement).maxLength} حرف.`;
  if (v.stepMismatch) return "اختر قيمة من القيم المسموحة.";
  if (v.badInput) return "القيمة المكتوبة غير مفهومة.";
  if (v.patternMismatch) return el.title || "الصيغة غير صحيحة.";
  return "";
}

/**
 * Mounted once: required fields, dates and numbers complain in Arabic
 * instead of in the browser's language («Please fill out this field.» on
 * a phone set to English). A field's own setCustomValidity still wins.
 */
export function ArabicValidation() {
  useEffect(() => {
    const ours = new WeakSet<Element>();
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!el?.validity) return;
      if (el.validity.customError && !ours.has(el)) return; // the page set its own message
      el.setCustomValidity("");
      const msg = arabicValidationMessage(el);
      if (msg) {
        ours.add(el);
        el.setCustomValidity(msg);
      }
    };
    const onEdit = (e: Event) => {
      const el = e.target as Field;
      if (ours.has(el)) {
        el.setCustomValidity("");
        ours.delete(el);
      }
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);
  return null;
}
