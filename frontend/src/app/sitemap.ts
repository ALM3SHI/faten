import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/login/`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE.url}/locations/`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE.url}/privacy/`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
