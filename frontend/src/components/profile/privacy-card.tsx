"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brain, Loader2, ShieldCheck, Trash2, UserX, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { logoutAndPurge } from "@/lib/auth-utils";
import { toast } from "@/lib/toast";

interface MemoryItem {
  id: string;
  text: string;
  createdAt?: string;
}

const CONFIRM_WORD = "حذف";

export function PrivacyCard() {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/memory");
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const forget = async (id: string | null) => {
    setBusy(id ?? "all");
    try {
      await api.delete(id ? `/api/memory/${id}` : "/api/memory");
      setItems((prev) => (id ? (prev ?? []).filter((i) => i.id !== id) : []));
    } catch {
      toast.error("تعذّر الحذف، حاول مرة أخرى.");
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await api.delete("/api/account", { body: JSON.stringify({ confirm: CONFIRM_WORD }) });
      toast.success("تم حذف حسابك وكل بياناتك.");
      await logoutAndPurge("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر حذف الحساب.");
      setDeleting(false);
    }
  };

  return (
    <Card className="glass p-6 md:p-7 rounded-[32px] border-foreground/10 md:col-span-2 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-black flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-uqu-accent" />
          الخصوصية وبياناتك
        </h2>
        <Link href="/privacy" className="text-sm font-bold text-uqu-accent hover:underline">
          سياسة الخصوصية والشروط
        </Link>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold flex items-center gap-2">
            <Brain className="w-4 h-4 text-uqu-cyan" />
            ما يتذكره المساعد عنك
          </h3>
          {items && items.length > 0 && (
            <Button variant="ghost" size="sm" className="rounded-xl text-rose-500" disabled={busy !== null} onClick={() => forget(null)}>
              {busy === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : "مسح الكل"}
            </Button>
          )}
        </div>
        {items === null ? (
          <div className="h-12 rounded-2xl bg-foreground/5 animate-pulse" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-7">
            لا شيء محفوظ. إذا ذكرت للمساعد هدفاً أو ظرفاً دائماً (مثل «أبي أرفع معدلي لـ 3.5» أو «أشتغل دوام جزئي») يحفظه هنا ليتذكره لاحقاً.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-foreground/5 border border-foreground/10 text-sm">
                <span>{i.text}</span>
                <button
                  type="button"
                  onClick={() => forget(i.id)}
                  disabled={busy !== null}
                  className="p-1 rounded-lg text-muted-foreground hover:text-rose-500 shrink-0"
                  aria-label="احذف هذه المعلومة"
                >
                  {busy === i.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-4 border-t border-foreground/10 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <div className="font-bold">حذف الحساب</div>
          <div className="text-muted-foreground text-[13px]">يحذف حسابك وسجلك وجدولك ومحادثاتك وتقييماتك نهائياً.</div>
        </div>
        <Button variant="outline" className="rounded-xl border-rose-500/30 text-rose-500 gap-2" onClick={() => setDeleteOpen(true)}>
          <UserX className="w-4 h-4" />
          حذف حسابي
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setConfirmText(""); }}>
        <DialogContent dir="rtl" className="rounded-[24px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-500">
              <Trash2 className="w-5 h-5" /> حذف الحساب نهائياً
            </DialogTitle>
            <DialogDescription className="leading-7">
              سيُحذف حسابك وكل بياناتك فوراً ولا يمكن استرجاعها. للتأكيد اكتب كلمة «{CONFIRM_WORD}».
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM_WORD} className="rounded-xl" aria-label="اكتب كلمة التأكيد" />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>إلغاء</Button>
            <Button
              className="bg-rose-500 hover:bg-rose-500/90 text-white gap-2"
              disabled={confirmText.trim() !== CONFIRM_WORD || deleting}
              onClick={deleteAccount}
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              حذف نهائياً
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
