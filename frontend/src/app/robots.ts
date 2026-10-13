import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Required for `output: "export"` — written at build time.
export const dynamic = "force-static";

/** Public pages are indexable; personal pages are behind sign-in anyway. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login/", "/privacy/", "/locations/"],
      disallow: ["/dashboard/", "/chat/", "/gpa/", "/plan/", "/profile/", "/schedule/", "/transcript/", "/community/", "/attendance/", "/study/", "/pomodoro/", "/exams/", "/admin/"],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
