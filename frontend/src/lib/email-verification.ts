import type { User } from "firebase/auth";

export const EMAIL_VERIFICATION_MESSAGES = {
  signupSuccess:
    "تم إنشاء الحساب وإرسال رابط التحقق إلى بريدك الإلكتروني.",
  dashboardReminder: "يرجى تفعيل بريدك الإلكتروني لضمان أمان حسابك.",
  resendSuccess: "تم إرسال رابط التحقق إلى بريدك الإلكتروني.",
  verifiedSuccess: "تم تفعيل بريدك الإلكتروني بنجاح.",
  stillNotVerified:
    "لم يتم تفعيل البريد بعد. تحقق من صندوق الوارد أو البريد المزعج.",
  resendFailed: "تعذّر إرسال رابط التحقق. حاول مرة أخرى.",
  refreshFailed: "تعذّر تحديث حالة التحقق. حاول مرة أخرى.",
  tooManyRequests: "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
} as const;

export function isEmailPasswordUser(user: User): boolean {
  return user.providerData.some((p) => p.providerId === "password");
}

export function getEmailVerificationErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "auth/too-many-requests"
  ) {
    return EMAIL_VERIFICATION_MESSAGES.tooManyRequests;
  }
  return EMAIL_VERIFICATION_MESSAGES.resendFailed;
}
