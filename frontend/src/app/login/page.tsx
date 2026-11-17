"use client";

import Link from "next/link";
import { Button as DsButton } from "@/components/ds/button";
import { useState } from "react";
import { safeNextPath } from "@/lib/routes";
import { loadFirebase } from "@/lib/firebase/lazy";

// Firebase loads in the background while the form renders (AuthProvider
// starts it on /login); each handler awaits the same import.
async function fb() {
  const [{ auth, googleProvider }, sdk] = await Promise.all([loadFirebase(), import("firebase/auth")]);
  return { auth, googleProvider, ...sdk };
}
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Mail, Lock, ArrowRight, Check, Circle, GraduationCap } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  getArabicAuthError,
  getAuthErrorCode,
  getPasswordRequirements,
  SIGNUP_MESSAGES,
  validateSignupEmail,
  validateSignupPassword,
} from "@/lib/signup-validation";
import { EMAIL_VERIFICATION_MESSAGES } from "@/lib/email-verification";
import { ThemeToggle } from "@/components/theme-toggle";

const PASSWORD_RESET_SENT =
  "إذا كان هذا البريد مسجّلًا عندنا، فقد أرسلنا إليه رابط إعادة تعيين كلمة المرور. تفقّد البريد الوارد والرسائل غير المرغوبة.";

function nextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const router = useRouter();

  // Sends the reset link to the address already typed in the form. The reply
  // is the same whether or not the address has an account, so the form can't
  // be used to find out who is registered.
  const handlePasswordReset = async () => {
    const address = email.trim();
    const emailError = validateSignupEmail(address);
    if (emailError) {
      toast.error("اكتب بريدك الإلكتروني في الحقل أولًا، ثم اضغط «نسيت كلمة المرور؟».");
      return;
    }
    setResetting(true);
    try {
      const { auth, sendPasswordResetEmail } = await fb();
      await sendPasswordResetEmail(auth, address);
      toast.success(PASSWORD_RESET_SENT);
    } catch (error: unknown) {
      if (getAuthErrorCode(error) === "auth/user-not-found") toast.success(PASSWORD_RESET_SENT);
      else toast.error(getArabicAuthError(error, "login"));
    } finally {
      setResetting(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Sign-up-only pre-submit validation ──────────────────────────
    // Done BEFORE `setLoading(true)` so a validation failure doesn't
    // flash the loading state.
    if (!isLogin) {
      const emailError = validateSignupEmail(email);
      if (emailError) {
        toast.error(emailError);
        return;
      }
      if (password !== confirmPassword) {
        toast.error(SIGNUP_MESSAGES.passwordMismatch);
        return;
      }
      const passwordResult = validateSignupPassword(password);
      if (!passwordResult.ok) {
        toast.error(passwordResult.message);
        return;
      }
    }

    setLoading(true);
    try {
      const { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } = await fb();
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        try {
          await sendEmailVerification(credential.user);
          toast.success(EMAIL_VERIFICATION_MESSAGES.signupSuccess);
        } catch {
          toast.warning(
            "تم إنشاء الحساب، لكن تعذّر إرسال رابط التحقق. يمكنك إعادة الإرسال من لوحة المعلومات.",
          );
        }
      }
      router.replace(nextPath());
    } catch (error: unknown) {
      toast.error(getArabicAuthError(error, isLogin ? "login" : "signup"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      const { auth, googleProvider, signInWithPopup } = await fb();
      await signInWithPopup(auth, googleProvider);
      router.replace(nextPath());
    } catch (error: unknown) {
      const code = getAuthErrorCode(error);
      if (code === "auth/popup-closed-by-user") {
        toast.warning(getArabicAuthError(error));
        return;
      }
      toast.error(getArabicAuthError(error));
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-surface text-ink font-sans overflow-hidden">
      <div className="fixed top-4 start-4 z-50">
        <ThemeToggle />
      </div>
      {/* ─── Branding column (desktop only) ───────────────────────────
          Hidden on mobile; on lg+ this is the visual hero with an
          animated aurora-style glow and a bold tagline. */}
      <aside className="hidden lg:flex relative overflow-hidden bg-surface items-center justify-center p-12 border-l border-line">
        {/* Aurora glows — pure CSS, no JS. The two radial-style blobs
            pulse on slightly offset timings to create a slow, organic
            color drift behind the tagline. */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full blur-[140px] bg-info-soft animate-pulse [animation-duration:8s]" />
          <div className="absolute -bottom-40 -left-20 w-[520px] h-[520px] rounded-full blur-[140px] bg-info-soft animate-pulse [animation-duration:11s]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full blur-[120px] bg-info-soft animate-pulse [animation-duration:14s]" />
          {/* Vignette so the form column edge fades cleanly */}
          <div className="absolute inset-0 hidden bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(9,9,11,0.85)_100%)]" />
        </div>

        <div className="relative z-10 max-w-md space-y-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-card bg-brand shadow-card">
            <GraduationCap className="w-10 h-10 text-on-brand" strokeWidth={2.2} />
          </div>
          <div className="space-y-4">
            <h2 className="text-display font-bold tracking-tight leading-tight bg-info-soft bg-clip-text text-transparent">
              فطن
            </h2>
            <p className="text-body text-ink-muted leading-relaxed">
              مساعدك الأكاديمي في جامعة أم القرى: يجيب من اللوائح الرسمية، ويتابع معدلك، وينظّم مذاكرتك.
            </p>
          </div>
        </div>
      </aside>

      {/* ─── Form column ──────────────────────────────────────────────
          Visible on every viewport; on mobile it carries its own
          subtle aurora since the branding column is hidden. */}
      <main className="relative flex items-center justify-center p-6 sm:p-10 bg-surface">
        {/* Mobile-only aurora — desktop gets the full branding column. */}
        <div className="absolute inset-0 pointer-events-none lg:hidden">
          <div className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full blur-[120px] bg-info-soft animate-pulse [animation-duration:9s]" />
          <div className="absolute -bottom-24 -left-24 w-[360px] h-[360px] rounded-full blur-[120px] bg-info-soft animate-pulse [animation-duration:12s]" />
        </div>

        <div className="w-full max-w-md relative z-10 animate-rise">
          {/* Mobile-only brand header (desktop already has the branding column). */}
          <div className="text-center mb-8 space-y-3 lg:hidden">
            <div className="w-16 h-16 bg-brand rounded-card mx-auto flex items-center justify-center shadow-card">
              <GraduationCap className="w-8 h-8 text-on-brand" strokeWidth={2.2} />
            </div>
            <h1 className="text-title font-bold tracking-tight text-ink">فطن</h1>
            <p className="text-ink-muted text-small">مساعدك الأكاديمي في جامعة أم القرى</p>
          </div>

          {/* Frosted-glass auth card */}
          <Card className="bg-surface border border-line rounded-card shadow-card p-8">
            <div className="mb-6 space-y-1">
              <h2 className="text-heading font-bold text-ink tracking-tight">
                {isLogin ? "مرحباً بعودتك" : "ابدأ رحلتك"}
              </h2>
              <p className="text-small text-ink-muted">
                {isLogin ? "سجّل دخولك وكمّل من حيث وقفت" : "أنشئ حساباً جديداً في ثوانٍ"}
              </p>
            </div>

            {/* Login / Register tab toggle */}
            <div className="flex bg-surface-sunken p-1 rounded-control mb-6 border border-line">
              <DsButton variant="bare"
                onClick={() => setIsLogin(true)}
                className={cn(
                  "flex-1 py-2 text-caption font-bold rounded-control transition-all",
                  isLogin
                    ? "bg-brand text-on-brand"
                    : "text-ink-muted hover:text-ink"
                )}
              >
                تسجيل الدخول
              </DsButton>
              <DsButton variant="bare"
                onClick={() => setIsLogin(false)}
                className={cn(
                  "flex-1 py-2 text-caption font-bold rounded-control transition-all",
                  !isLogin
                    ? "bg-brand text-on-brand"
                    : "text-ink-muted hover:text-ink"
                )}
              >
                حساب جديد
              </DsButton>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div className="relative">
                <Mail className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <Input
                  type="email"
                  placeholder="البريد الإلكتروني"
                  aria-label="البريد الإلكتروني"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pr-12 h-12 rounded-control bg-surface border-line text-ink placeholder:text-ink-muted focus:ring-2 focus:ring-brand focus:border-transparent transition-all text-small"
                  required
                />
              </div>

              <div className="relative">
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <Input
                  type="password"
                  placeholder="كلمة المرور"
                  aria-label="كلمة المرور"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12 h-12 rounded-control bg-surface border-line text-ink placeholder:text-ink-muted focus:ring-2 focus:ring-brand focus:border-transparent transition-all text-small"
                  required
                />
              </div>

              {isLogin && (
                <div className="flex justify-start">
                  <DsButton variant="bare"
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={resetting}
                    className="rounded-md px-1 py-1 text-caption font-semibold text-info-ink hover:underline focus-visible:outline-2 focus-visible:ring-brand disabled:opacity-60"
                  >
                    {resetting ? "جاري الإرسال..." : "نسيت كلمة المرور؟"}
                  </DsButton>
                </div>
              )}

              {!isLogin && (
                <ul
                  className="space-y-1.5 rounded-control bg-surface-sunken border border-line px-4 py-3"
                  aria-label="متطلبات كلمة المرور"
                >
                  {getPasswordRequirements(password).map((req) => (
                    <li
                      key={req.id}
                      className={cn(
                        "flex items-center gap-2 text-caption transition-colors",
                        req.met
                          ? "text-success-ink "
                          : "text-ink-muted ",
                      )}
                    >
                      {req.met ? (
                        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      ) : (
                        <Circle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      )}
                      <span>{req.label}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Sign-up only: confirm-password field. Identical styling
                  to the password input above so it slots into the form
                  seamlessly when the user is in حساب جديد mode. */}
              {!isLogin && (
                <div className="relative">
                  <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                  <Input
                    type="password"
                    placeholder="تأكيد كلمة المرور"
                    aria-label="تأكيد كلمة المرور"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-12 h-12 rounded-control bg-surface border-line text-ink placeholder:text-ink-muted focus:ring-2 focus:ring-brand focus:border-transparent transition-all text-small"
                    required
                  />
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-control bg-brand hover:bg-brand-hover hover:scale-[1.02] text-on-brand font-bold text-small shadow-card transition-all disabled:opacity-50 disabled:hover:scale-100"
              >
                {loading ? (
                  "جاري المعالجة..."
                ) : (
                  <>
                    {isLogin ? "دخول" : "إنشاء حساب"}
                    <ArrowRight className="mr-2 w-4 h-4 rtl:rotate-180" />
                  </>
                )}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-line" />
              </div>
              <div className="relative flex justify-center text-caption uppercase">
                <span className="bg-surface px-3 text-ink-muted font-bold tracking-widest">أو عبر</span>
              </div>
            </div>

            <Button
              onClick={handleGoogleAuth}
              variant="outline"
              className="w-full h-12 rounded-control bg-transparent border-line hover:bg-surface-sunken text-ink gap-3 font-semibold text-small transition-all"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              <span>المتابعة باستخدام Google</span>
            </Button>
          </Card>

          <p className="text-center mt-6 text-caption text-ink-muted leading-relaxed px-8">
            بالاستمرار، أنت توافق على{" "}
            <Link href="/privacy#terms" className="underline hover:text-ink">شروط الاستخدام</Link> و{" "}
            <Link href="/privacy" className="underline hover:text-ink">سياسة الخصوصية</Link> الخاصة بفطن.
          </p>
        </div>
      </main>
    </div>
  );
}
