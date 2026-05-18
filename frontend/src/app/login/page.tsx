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

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="min-h-screen flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans">
      {/* Background Decor */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-uqu-accent/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-uqu-cyan/10 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-md p-6 relative z-10 animate-in fade-in zoom-in duration-700">
        <div className="text-center mb-10 space-y-2">
          <div className="w-20 h-20 bg-uqu-accent rounded-[24px] mx-auto flex items-center justify-center shadow-2xl shadow-uqu-accent/40 mb-6">
            <Sparkles className="w-10 h-10 text-foreground" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-foreground">أم القرى الذكي</h1>
          <p className="text-muted-foreground text-sm">مساعدك الأكاديمي المتطور مدعوماً بالذكاء الاصطناعي</p>
        </div>

        <Card className="glass p-8 rounded-[40px] border-foreground/10 shadow-2xl">
          <div className="flex bg-foreground/5 p-1 rounded-2xl mb-8">
            <button 
              onClick={() => setIsLogin(true)}
              className={cn(
                "flex-1 py-2 text-xs font-bold rounded-xl transition-all",
                isLogin ? "bg-foreground/5 text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
              )}
            >
              تسجيل الدخول
            </button>
            <button 
              onClick={() => setIsLogin(false)}
              className={cn(
                "flex-1 py-2 text-xs font-bold rounded-xl transition-all",
                !isLogin ? "bg-foreground/5 text-foreground shadow-lg" : "text-muted-foreground hover:text-foreground"
              )}
            >
              حساب جديد
            </button>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Mail className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  type="email"
                  placeholder="البريد الإلكتروني"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pr-12 h-14 rounded-2xl glass border-foreground/10 focus:border-uqu-accent/50 transition-all text-sm"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="relative">
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  type="password"
                  placeholder="كلمة المرور"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-12 h-14 rounded-2xl glass border-foreground/10 focus:border-uqu-accent/50 transition-all text-sm"
                  required
                />
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full h-14 rounded-2xl bg-uqu-accent hover:bg-uqu-accent/90 text-foreground font-bold text-base shadow-xl shadow-uqu-accent/20 transition-all active:scale-95"
            >
              {loading ? "جاري المعالجة..." : (isLogin ? "دخول" : "إنشاء حساب")}
              <ArrowRight className="mr-2 w-5 h-5" />
            </Button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-foreground/10" /></div>
            <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-card px-4 text-muted-foreground font-bold tracking-widest">أو عبر</span></div>
          </div>

          <Button 
            onClick={handleGoogleAuth}
            variant="outline" 
            className="w-full h-14 rounded-2xl glass border-foreground/10 hover:bg-foreground/5 text-foreground gap-3 font-bold transition-all"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            المتابعة باستخدام Google
          </Button>
        </Card>

        <p className="text-center mt-8 text-[10px] text-muted-foreground leading-relaxed px-10">
          بالاستمرار، أنت توافق على شروط الخدمة وسياسة الخصوصية الخاصة بالمساعد الأكاديمي لجامعة أم القرى.
        </p>
      </div>
    </div>
  );
}
