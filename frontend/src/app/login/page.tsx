"use client";

import { useState } from "react";
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithEmailAndPassword, signInWithPopup, createUserWithEmailAndPassword } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { LogIn, Mail, Lock, ArrowRight, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// Denylist of commonly-leaked / trivially-sequential passwords that should
// be rejected outright on sign-up, even if they meet the 8-char minimum.
// Compared case-insensitively against the trimmed password.
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

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Sign-up-only pre-submit validation ──────────────────────────
    // Done BEFORE `setLoading(true)` so a validation failure doesn't
    // flash the loading state.
    if (!isLogin) {
      if (password !== confirmPassword) {
        alert("كلمات المرور غير متطابقة");
        return;
      }
      const normalized = password.trim();
      if (
        normalized.length < 8 ||
        WEAK_PASSWORDS.has(normalized.toLowerCase())
      ) {
        alert("كلمة المرور ضعيفة، يرجى استخدام حروف وأرقام أكثر تعقيداً");
        return;
      }
    }

    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      router.push("/dashboard");
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      router.push("/dashboard");
    } catch (error: any) {
      alert(error.message);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-zinc-950 text-white font-sans overflow-hidden">
      {/* ─── Branding column (desktop only) ───────────────────────────
          Hidden on mobile; on lg+ this is the visual hero with an
          animated aurora-style glow and a bold tagline. */}
      <aside className="hidden lg:flex relative overflow-hidden bg-zinc-950 items-center justify-center p-12 border-l border-white/5">
        {/* Aurora glows — pure CSS, no JS. The two radial-style blobs
            pulse on slightly offset timings to create a slow, organic
            color drift behind the tagline. */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full blur-[140px] bg-purple-600/30 animate-pulse [animation-duration:8s]" />
          <div className="absolute -bottom-40 -left-20 w-[520px] h-[520px] rounded-full blur-[140px] bg-indigo-600/30 animate-pulse [animation-duration:11s]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full blur-[120px] bg-fuchsia-500/15 animate-pulse [animation-duration:14s]" />
          {/* Vignette so the form column edge fades cleanly */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(9,9,11,0.85)_100%)]" />
        </div>

        <div className="relative z-10 max-w-md space-y-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-2xl shadow-purple-600/40">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-4">
            <h2 className="text-5xl font-black tracking-tight leading-tight bg-gradient-to-br from-white via-white to-purple-200 bg-clip-text text-transparent">
              فطن
            </h2>
            <p className="text-base text-white/60 leading-relaxed">
              فطن — مساعدك الأكاديمي المتطور مدعوماً بالذكاء الاصطناعي. يخطّط، يذاكر، ويتابع تقدّمك في جامعة أم القرى.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-4">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-xs uppercase tracking-[0.3em] text-white/40 font-semibold">UQU · Smart</span>
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse [animation-delay:400ms]" />
          </div>
        </div>
      </aside>

      {/* ─── Form column ──────────────────────────────────────────────
          Visible on every viewport; on mobile it carries its own
          subtle aurora since the branding column is hidden. */}
      <main className="relative flex items-center justify-center p-6 sm:p-10 bg-zinc-950">
        {/* Mobile-only aurora — desktop gets the full branding column. */}
        <div className="absolute inset-0 pointer-events-none lg:hidden">
          <div className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full blur-[120px] bg-purple-600/20 animate-pulse [animation-duration:9s]" />
          <div className="absolute -bottom-24 -left-24 w-[360px] h-[360px] rounded-full blur-[120px] bg-indigo-600/20 animate-pulse [animation-duration:12s]" />
        </div>

        <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-700">
          {/* Mobile-only brand header (desktop already has the branding column). */}
          <div className="text-center mb-8 space-y-3 lg:hidden">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-2xl shadow-purple-600/40">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">فطن</h1>
            <p className="text-white/50 text-sm">فطن — مساعدك الأكاديمي المتطور</p>
          </div>

          {/* Frosted-glass auth card */}
          <Card className="backdrop-blur-md bg-black/40 border border-white/10 rounded-3xl shadow-2xl shadow-black/40 p-8">
            <div className="mb-6 space-y-1">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {isLogin ? "مرحباً بعودتك" : "ابدأ رحلتك"}
              </h2>
              <p className="text-sm text-white/50">
                {isLogin ? "سجّل دخولك للمتابعة إلى لوحتك" : "أنشئ حساباً جديداً في ثوانٍ"}
              </p>
            </div>

            {/* Login / Register tab toggle */}
            <div className="flex bg-white/5 p-1 rounded-xl mb-6 border border-white/5">
              <button
                onClick={() => setIsLogin(true)}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                  isLogin
                    ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30"
                    : "text-white/50 hover:text-white"
                )}
              >
                تسجيل الدخول
              </button>
              <button
                onClick={() => setIsLogin(false)}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                  !isLogin
                    ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30"
                    : "text-white/50 hover:text-white"
                )}
              >
                حساب جديد
              </button>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div className="relative">
                <Mail className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                <Input
                  type="email"
                  placeholder="البريد الإلكتروني"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pr-12 h-12 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all text-sm"
                  required
                />
              </div>

              <div className="relative">
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                <Input
                  type="password"
                  placeholder="كلمة المرور"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12 h-12 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all text-sm"
                  required
                />
              </div>

              {/* Sign-up only: confirm-password field. Identical styling
                  to the password input above so it slots into the form
                  seamlessly when the user is in حساب جديد mode. */}
              {!isLogin && (
                <div className="relative">
                  <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                  <Input
                    type="password"
                    placeholder="تأكيد كلمة المرور"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-12 h-12 rounded-xl bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all text-sm"
                    required
                  />
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-90 hover:scale-[1.02] text-white font-bold text-sm shadow-xl shadow-purple-600/30 transition-all disabled:opacity-50 disabled:hover:scale-100"
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
                <span className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase">
                <span className="bg-zinc-950/60 px-3 text-white/40 font-bold tracking-widest">أو عبر</span>
              </div>
            </div>

            <Button
              onClick={handleGoogleAuth}
              variant="outline"
              className="w-full h-12 rounded-xl bg-transparent border-white/10 hover:bg-white/5 text-white gap-3 font-semibold text-sm transition-all"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              <span>المتابعة باستخدام Google</span>
            </Button>
          </Card>

          <p className="text-center mt-6 text-[11px] text-white/30 leading-relaxed px-8">
            بالاستمرار، أنت توافق على شروط الخدمة وسياسة الخصوصية الخاصة بفطن — المساعد الأكاديمي لجامعة أم القرى.
          </p>
        </div>
      </main>
    </div>
  );
}
