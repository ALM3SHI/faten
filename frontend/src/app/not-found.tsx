import Link from "next/link";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4" dir="rtl">
      <div className="max-w-md text-center space-y-5">
        <LogoMark className="w-14 h-14 mx-auto" iconClassName="w-7 h-7" />
        <h1 className="text-3xl font-black">الصفحة غير موجودة</h1>
        <p className="text-muted-foreground leading-relaxed">
          الرابط غير صحيح أو أن الصفحة نُقلت. ارجع للوحتك أو اسأل فطن عن اللي تبحث عنه.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/dashboard" className="px-5 h-11 inline-flex items-center rounded-xl bg-uqu-accent text-white font-bold hover:bg-uqu-accent/90">
            افتح لوحتك
          </Link>
          <Link href="/chat" className="px-5 h-11 inline-flex items-center rounded-xl border border-border font-bold hover:bg-foreground/5">
            اسأل فطن
          </Link>
        </div>
      </div>
    </main>
  );
}
