"use client";

import { useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { Mail, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { auth } from "@/lib/firebase";
import {
  EMAIL_VERIFICATION_MESSAGES,
  getEmailVerificationErrorMessage,
  isEmailPasswordUser,
} from "@/lib/email-verification";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

export function EmailVerificationReminder() {
  const { user } = useAuth();
  const [localVerified, setLocalVerified] = useState<boolean | null>(null);
  const [resending, setResending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!user || !isEmailPasswordUser(user)) return null;

  const isVerified = localVerified ?? user.emailVerified;
  if (isVerified) return null;

  const handleResend = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    setResending(true);
    try {
      await sendEmailVerification(currentUser);
      toast.success(EMAIL_VERIFICATION_MESSAGES.resendSuccess);
    } catch (error) {
      toast.error(getEmailVerificationErrorMessage(error));
    } finally {
      setResending(false);
    }
  };

  const handleRefresh = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    setRefreshing(true);
    try {
      await currentUser.reload();
      if (currentUser.emailVerified) {
        setLocalVerified(true);
        toast.success(EMAIL_VERIFICATION_MESSAGES.verifiedSuccess);
      } else {
        toast.info(EMAIL_VERIFICATION_MESSAGES.stillNotVerified);
      }
    } catch {
      toast.error(EMAIL_VERIFICATION_MESSAGES.refreshFailed);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div
      className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 md:p-5 animate-in fade-in slide-in-from-top-2 duration-500"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
            <Mail className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100/90 leading-relaxed pt-2 sm:pt-0 sm:py-2">
            {EMAIL_VERIFICATION_MESSAGES.dashboardReminder}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resending || refreshing}
            onClick={handleResend}
            className="rounded-xl border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 text-amber-900 dark:text-amber-100"
          >
            {resending ? "جاري الإرسال..." : "إعادة إرسال رابط التحقق"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resending || refreshing}
            onClick={handleRefresh}
            className="rounded-xl border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 text-amber-900 dark:text-amber-100 gap-2"
          >
            <RefreshCw className={refreshing ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
            {refreshing ? "جاري التحديث..." : "تحققت من البريد، تحديث الحالة"}
          </Button>
        </div>
      </div>
    </div>
  );
}
