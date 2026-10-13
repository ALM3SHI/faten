"use client";

import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOUR_REPLAY_KEY, writeStorage } from "@/lib/tour";

/** Opens the welcome tour again on the dashboard. */
export function ReplayTourButton() {
  const router = useRouter();
  return (
    <div className="flex justify-center mt-8">
      <Button
        variant="ghost"
        className="rounded-xl gap-2 text-muted-foreground hover:text-foreground"
        onClick={() => {
          writeStorage("session", TOUR_REPLAY_KEY, "1");
          router.push("/dashboard");
        }}
      >
        <Compass className="w-4 h-4" aria-hidden />
        عرض الجولة التعريفية مرة ثانية
      </Button>
    </div>
  );
}
