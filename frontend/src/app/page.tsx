"use client";

import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { 
  MessageSquare, 
  Search,
  LayoutDashboard,
  User,
  Settings,
  Send,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mockQuery, setMockQuery] = useState("");
  const router = useRouter();
  
  // Scroll animations for Dashboard Showcase
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

  const handleMockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mockQuery.trim()) {
      router.push(`/chat?query=${encodeURIComponent(mockQuery)}`);
    }
  };

  // Reveal transforms
  const rotateX = useTransform(scrollYProgress, [0, 0.3], [15, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.3], [0.95, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.2], [0, 1]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-[#0066cc]/30" ref={containerRef}>
      <Navbar />

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden pt-20">
        {/* Subtle Framer Motion Abstract Background */}
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#0066cc]/10 rounded-full blur-[120px] pointer-events-none"
        />

        <div className="container mx-auto max-w-5xl text-center relative z-10 space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-foreground/5 border border-foreground/10 text-muted text-sm font-medium backdrop-blur-md"
          >
            <Sparkles className="w-4 h-4 text-[#0066cc]" />
            فطن
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-6xl md:text-8xl font-black leading-[1.1] tracking-tighter"
          >
            رفيقك في <br />
            رحلتك الجامعية
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl md:text-2xl text-[#a1a1a6] max-w-2xl mx-auto leading-relaxed tracking-tight"
          >
            منصة متكاملة تجمع المحادثة الذكية، حاسبة المعدل، وجداول المذاكرة في مكان واحد.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-wrap justify-center gap-4 pt-8"
          >
            <Button render={<Link href="/chat" />} nativeButton={false} size="lg" className="rounded-full py-6 px-8 text-lg font-semibold bg-[#0066cc] hover:bg-[#005bb5] text-foreground transition-all active:scale-95 shadow-none border-0">
              <MessageSquare className="ml-2 w-5 h-5" />
              ابدأ المحادثة
            </Button>
            <Button render={<Link href="/dashboard" />} nativeButton={false} variant="outline" size="lg" className="rounded-full py-6 px-8 text-lg font-semibold bg-transparent border-foreground/10 text-foreground hover:bg-foreground/5 transition-all active:scale-95 shadow-none">
              استكشف المميزات
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Product Showcase (Scroll Reveal) */}
      <section className="relative w-full px-4 pb-32 -mt-20" style={{ perspective: '1200px' }}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#0066cc]/20 rounded-full blur-[150px] pointer-events-none" />
        <motion.div 
          style={{ rotateX, scale, opacity }}
          className="max-w-5xl mx-auto rounded-2xl bg-black/50 backdrop-blur-xl border border-foreground/10 overflow-hidden shadow-2xl flex flex-col relative z-10"
        >
          {/* Mockup Top Bar */}
          <div className="h-12 bg-foreground/5 border-b border-foreground/10 flex items-center px-4 gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
          </div>
          {/* Mockup Content Area */}
          <div className="p-8 grid grid-cols-4 gap-6 h-[600px] bg-transparent">
            {/* Sidebar */}
            <div className="col-span-1 space-y-4">
              <div className="h-10 bg-foreground/5 rounded-lg w-full flex items-center px-4 gap-3 text-muted"><LayoutDashboard className="w-4 h-4"/> الرئيسية</div>
              <div className="h-10 bg-[#0066cc]/20 rounded-lg w-full flex items-center px-4 gap-3 text-[#0066cc]"><MessageSquare className="w-4 h-4"/> المحادثة</div>
              <div className="h-10 bg-foreground/5 rounded-lg w-full flex items-center px-4 gap-3 text-muted"><User className="w-4 h-4"/> الملف الشخصي</div>
              <div className="h-10 bg-foreground/5 rounded-lg w-full flex items-center px-4 gap-3 text-muted"><Settings className="w-4 h-4"/> الإعدادات</div>
            </div>
            {/* Main Area */}
            <div className="col-span-3 bg-foreground/5 rounded-xl border border-foreground/10 p-6 flex flex-col gap-6">
               <div className="h-8 w-1/3 bg-foreground/5 rounded-md shrink-0" />
               <div className="flex-1 rounded-xl bg-foreground/5 border border-foreground/10 p-4 flex flex-col justify-start overflow-hidden relative pt-4">
                  
                  {/* Chat History */}
                  <div className="flex flex-col space-y-4 w-full text-[14px]">
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                      className="flex gap-3 items-end self-start"
                      dir="rtl"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0066cc] to-cyan-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(0,102,204,0.5)]">
                        <Sparkles className="w-4 h-4 text-foreground" />
                      </div>
                      <div className="bg-card border border-foreground/10 text-foreground px-4 py-3 rounded-2xl rounded-tr-sm max-w-[80%] leading-relaxed">
                        أهلاً بك! أنا فطن، مساعدك الأكاديمي الذكي لجامعة أم القرى. كيف يمكنني ترتيب يومك؟
                      </div>
                    </motion.div>

                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 1.5 }}
                      className="flex gap-3 items-end self-end"
                      dir="rtl"
                    >
                      <div className="bg-[#0066cc] text-foreground px-4 py-3 rounded-2xl rounded-tl-sm max-w-[80%] leading-relaxed shadow-lg shadow-[#0066cc]/20">
                        أحتاج مساعدة في توزيع ساعات المذاكرة لمادة هياكل البيانات.
                      </div>
                    </motion.div>

                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 2.8 }}
                      className="flex gap-3 items-end self-start"
                      dir="rtl"
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0066cc] to-cyan-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(0,102,204,0.5)]">
                        <Sparkles className="w-4 h-4 text-foreground" />
                      </div>
                      <div className="bg-card border border-foreground/10 text-foreground px-4 py-3 rounded-2xl rounded-tr-sm max-w-[80%] leading-relaxed">
                        أبشر! هل تفضل إضافة جلسات بومودورو بتركيز 25 دقيقة للجدول؟
                      </div>
                    </motion.div>
                  </div>

                  <form onSubmit={handleMockSubmit} className="mt-auto w-full h-14 bg-foreground/5 rounded-xl border border-foreground/10 flex items-center px-2 transition-colors focus-within:border-[#0066cc]/50 focus-within:bg-foreground/5 z-10 shrink-0">
                    <Search className="w-5 h-5 ml-2 text-muted" />
                    <input 
                      type="text"
                      value={mockQuery}
                      onChange={(e) => setMockQuery(e.target.value)}
                      placeholder="اكتب استفسارك هنا..."
                      className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted text-[15px] px-2"
                      dir="rtl"
                    />
                    <button type="submit" disabled={!mockQuery.trim()} className="w-10 h-10 rounded-lg bg-[#0066cc] flex items-center justify-center text-foreground disabled:opacity-50 transition-all active:scale-95 ml-2">
                      <Send className="w-4 h-4 rotate-180" />
                    </button>
                  </form>
               </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features Bento Grid */}
      <section className="py-32 bg-background border-t border-foreground/10">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="text-center mb-20 space-y-4">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight">قوة مذهلة. <br/><span className="text-muted-foreground dark:text-[#a1a1a6]">في تصميم بسيط.</span></h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Card 1: GPA Tracker */}
            <div className="lg:col-span-2">
              <div className="bg-card rounded-[24px] border border-border shadow-sm dark:bg-[#161618] dark:border-foreground/10 p-12 h-full flex flex-col items-start text-right justify-between transition-all hover:scale-[1.02] hover:border-foreground/20 dark:hover:border-foreground/10 group cursor-default">
                <div className="flex flex-col md:flex-row items-start md:items-center gap-8 mb-8">
                  {/* CSS Circular Progress Ring representing GPA */}
                  <div className="relative w-24 h-24 flex items-center justify-center rounded-full bg-background dark:bg-card shrink-0">
                    <svg className="w-24 h-24 transform -rotate-90">
                      <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-foreground/10 dark:text-white/5" />
                      <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="6" fill="transparent" strokeDasharray="276" strokeDashoffset="14" className="text-[#0066cc] transition-all duration-1000 ease-out group-hover:strokeDashoffset-0" />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-foreground">3.8</span>
                      <span className="text-[11px] text-muted">/4.0</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold tracking-tight text-foreground mb-3">حساب المعدل</h3>
                    <p className="text-muted-foreground dark:text-[#a1a1a6] text-lg leading-relaxed">
                      تتبع مسارك الأكاديمي بدقة متناهية وتوقع معدلك القادم بناءً على السيناريوهات المختلفة قبل وقوعها.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Card 2: Pomodoro */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-[24px] border border-border shadow-sm dark:bg-[#161618] dark:border-foreground/10 p-12 h-full flex flex-col items-start text-right justify-center transition-all hover:scale-[1.02] hover:border-foreground/20 dark:hover:border-foreground/10 cursor-default">
                {/* CSS Digital Timer */}
                <div className="bg-card rounded-xl py-3 px-6 flex items-center gap-4 mb-8 border border-foreground/10 shadow-inner">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-3xl font-mono font-bold text-foreground tracking-widest">25:00</span>
                </div>
                <div>
                  <h3 className="text-2xl font-bold tracking-tight text-foreground mb-3">بومودورو</h3>
                  <p className="text-muted-foreground dark:text-[#a1a1a6] text-lg leading-relaxed">
                    نظم وقت المذاكرة بفترات تركيز عميقة.
                  </p>
                </div>
              </div>
            </div>
            
            {/* Card 3: Campus Blueprint */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-[24px] border border-border shadow-sm dark:bg-[#161618] dark:border-foreground/10 p-12 h-full flex flex-col items-start text-right justify-between transition-all hover:scale-[1.02] hover:border-foreground/20 dark:hover:border-foreground/10 relative overflow-hidden cursor-default group">
                {/* SVG Blueprint Floor Plan */}
                <div className="relative w-full h-32 mb-8 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
                  <svg viewBox="0 0 200 120" className="w-full h-full" stroke="currentColor" fill="none" strokeWidth="1">
                    <g className="text-muted">
                      {/* Main Corridor */}
                      <path d="M20,50 L180,50 M20,70 L180,70" />
                      {/* Top Rooms */}
                      <path d="M20,20 L70,20 L70,50 M20,20 L20,50" />
                      <path d="M80,20 L130,20 L130,50 M80,20 L80,50" />
                      <path d="M140,20 L180,20 L180,50 M140,20 L140,50" />
                      {/* Bottom Rooms */}
                      <path d="M30,70 L30,110 L90,110 L90,70" />
                      <path d="M110,70 L110,100 L170,100 L170,70" />
                    </g>
                    {/* Path Animation Styles */}
                    <style>
                      {`
                        @keyframes flowForward {
                          from { stroke-dashoffset: 12; }
                          to { stroke-dashoffset: 0; }
                        }
                        .animate-flow {
                          animation: flowForward 1s linear infinite;
                        }
                      `}
                    </style>
                    {/* Dotted Navigation Path */}
                    <path 
                      d="M180,60 L105,60 L105,40" 
                      stroke="currentColor" 
                      fill="none" 
                      strokeWidth="1.5" 
                      className="text-muted animate-flow" 
                      strokeDasharray="6 6" 
                    />
                    {/* Pulsing Location Pin */}
                    <circle cx="105" cy="35" r="3" fill="#0066cc" stroke="none" className="animate-pulse" />
                  </svg>
                </div>
                
                <div className="relative z-10 w-full text-right">
                  <h3 className="text-2xl font-bold tracking-tight text-foreground mb-3">خرائط ذكية</h3>
                  <p className="text-muted-foreground dark:text-[#a1a1a6] text-[15px] leading-relaxed">
                    مخططات تفاعلية داخلية لمباني الجامعة. وداعاً للضياع في الأروقة.
                  </p>
                </div>
              </div>
            </div>

            {/* Card 4: Dashboard */}
            <div className="lg:col-span-2">
              <div className="bg-card rounded-[24px] border border-border shadow-sm dark:bg-[#161618] dark:border-foreground/10 p-12 h-full flex flex-col md:flex-row items-center text-right justify-between transition-all hover:scale-[1.02] hover:border-foreground/20 dark:hover:border-foreground/10 relative overflow-hidden cursor-default group">
                {/* CSS Dashboard Micro-UI */}
                <div className="w-full md:w-[45%] flex flex-col gap-4 p-4 bg-card rounded-xl border border-foreground/10 shadow-2xl mb-8 md:mb-0 ml-0 md:ml-8 transform group-hover:translate-y-[-5px] transition-transform">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-foreground/5" />
                    <div className="w-16 h-2 rounded-full bg-foreground/5" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-secondary dark:bg-[#272729] rounded-lg p-3 border border-border dark:border-foreground/10 flex flex-col gap-1 items-end">
                      <div className="text-[10px] text-muted-foreground">المعدل</div>
                      <div className="text-sm font-bold text-foreground">3.84</div>
                    </div>
                    <div className="bg-secondary dark:bg-[#272729] rounded-lg p-3 border border-border dark:border-foreground/10 flex flex-col gap-1 items-end">
                      <div className="text-[10px] text-muted-foreground">الغياب</div>
                      <div className="text-sm font-bold text-foreground">0 h</div>
                    </div>
                    <div className="bg-secondary dark:bg-[#272729] rounded-lg p-3 border border-border dark:border-foreground/10 flex flex-col gap-1 items-end">
                      <div className="text-[10px] text-muted-foreground">المهام</div>
                      <div className="text-sm font-bold text-foreground">12</div>
                    </div>
                  </div>
                  <div className="h-16 bg-secondary dark:bg-[#272729] rounded-lg border border-border dark:border-foreground/10 flex items-end gap-1 p-2 pt-4">
                    <div className="flex-1 bg-[#0066cc]/40 h-[30%] rounded-t-sm" />
                    <div className="flex-1 bg-[#0066cc]/60 h-[50%] rounded-t-sm" />
                    <div className="flex-1 bg-[#0066cc]/80 h-[80%] rounded-t-sm" />
                    <div className="flex-1 bg-[#0066cc] h-[100%] rounded-t-sm" />
                    <div className="flex-1 bg-[#0066cc]/50 h-[60%] rounded-t-sm" />
                  </div>
                  <div className="w-full bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 rounded-lg p-2 text-[10px] text-center font-medium mt-1">
                    طلب مساعدة أكاديمية
                  </div>
                </div>
                
                <div className="relative z-10 w-full md:w-[50%] ml-auto text-right flex flex-col items-end">
                  <h3 className="text-3xl font-bold tracking-tight text-foreground mb-4">لوحة تحكم متكاملة</h3>
                  <p className="text-muted-foreground dark:text-[#a1a1a6] text-lg leading-relaxed text-right">
                    كل بياناتك الأكاديمية في مكان واحد. راقب مستواك، تتبع غياباتك، وقم بإدارة مهامك اليومية من خلال لوحة معلومات مصممة لتمنحك السيطرة الكاملة.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-foreground/10 bg-background">
        <div className="container mx-auto px-4 text-center text-[#a1a1a6] text-[13px]">
          <p>© 2026 فطن — المساعد الأكاديمي الذكي لجامعة أم القرى. جميع الحقوق محفوظة.</p>
        </div>
      </footer>
    </div>
  );
}
