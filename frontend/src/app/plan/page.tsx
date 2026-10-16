"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The study plan now lives in «وقتي» (/time). This address stays for saved
 * links and the agent's NAVIGATE {path: "/plan"}, and forwards there.
 */
export default function PlanPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/time");
  }, [router]);
  return <div className="min-h-screen bg-background" aria-busy="true" />;
}
