/** Client-side sign-up validation and Arabic auth error mapping. */

const WEAK_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "123456",
  "123123",
  "111111",
  "000000",
  "qwerty",
  "qwerty123",
  "qwertyui",
  "password",
  "password1",
  "password123",
  "abc12345",
  "iloveyou",
  "admin123",
]);

export const SIGNUP_MESSAGES = {
  invalidEmail: "يرجى إدخال بريد إلكتروني صالح.",
  passwordMismatch: "كلمات المرور غير متطابقة",
  passwordTooShort: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
  passwordNoUppercase:
    "يجب أن تحتوي كلمة المرور على حرف إنجليزي كبير واحد على الأقل (A–Z).",
  passwordNoLowercase:
    "يجب أن تحتوي كلمة المرور على حرف إنجليزي صغير واحد على الأقل (a–z).",
  passwordNoNumber: "يجب أن تحتوي كلمة المرور على رقم واحد على الأقل.",
  passwordCommon: "كلمة المرور شائعة جداً. اختر كلمة مرور أقوى.",
} as const;

export type PasswordRequirementId =
  | "length"
  | "uppercase"
  | "lowercase"
  | "number";

export interface PasswordRequirement {
  id: PasswordRequirementId;
  label: string;
  met: boolean;
}

const PASSWORD_REQUIREMENT_LABELS: Record<PasswordRequirementId, string> = {
  length: "8 أحرف على الأقل",
  uppercase: "حرف إنجليزي كبير (A–Z)",
  lowercase: "حرف إنجليزي صغير (a–z)",
  number: "رقم واحد على الأقل",
};

const PASSWORD_REQUIREMENT_ORDER: PasswordRequirementId[] = [
  "length",
  "uppercase",
  "lowercase",
  "number",
];

export function getPasswordRequirements(password: string): PasswordRequirement[] {
  const checks: Record<PasswordRequirementId, boolean> = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  };

  return PASSWORD_REQUIREMENT_ORDER.map((id) => ({
    id,
    label: PASSWORD_REQUIREMENT_LABELS[id],
    met: checks[id],
  }));
}

export function validateSignupEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return SIGNUP_MESSAGES.invalidEmail;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return SIGNUP_MESSAGES.invalidEmail;
  }
  return null;
}

export function validateSignupPassword(
  password: string,
): { ok: true } | { ok: false; message: string } {
  if (password.length < 8) {
    return { ok: false, message: SIGNUP_MESSAGES.passwordTooShort };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, message: SIGNUP_MESSAGES.passwordNoUppercase };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, message: SIGNUP_MESSAGES.passwordNoLowercase };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, message: SIGNUP_MESSAGES.passwordNoNumber };
  }
  if (WEAK_PASSWORDS.has(password.trim().toLowerCase())) {
    return { ok: false, message: SIGNUP_MESSAGES.passwordCommon };
  }
  return { ok: true };
}

const AUTH_ERROR_FALLBACK_LOGIN =
  "حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى.";
const AUTH_ERROR_FALLBACK_SIGNUP =
  "حدث خطأ أثناء إنشاء الحساب. حاول مرة أخرى.";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/wrong-password": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "auth/user-not-found": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "auth/invalid-email": "عنوان البريد الإلكتروني غير صالح.",
  "auth/email-already-in-use": "هذا البريد الإلكتروني مستخدم بالفعل.",
  "auth/weak-password": "كلمة المرور ضعيفة جداً. استخدم كلمة مرور أقوى.",
  "auth/too-many-requests": "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
  "auth/popup-closed-by-user": "تم إلغاء تسجيل الدخول.",
  "auth/network-request-failed":
    "تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.",
};

export function getAuthErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

export function getArabicAuthError(
  error: unknown,
  mode: "login" | "signup" = "login",
): string {
  const code = getAuthErrorCode(error);
  if (code && AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }
  return mode === "signup"
    ? AUTH_ERROR_FALLBACK_SIGNUP
    : AUTH_ERROR_FALLBACK_LOGIN;
}
