import type { MetadataRoute } from "next";

// Required for `output: "export"` — the manifest is written at build time.
export const dynamic = "force-static";

/** Lets students install Faten on their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "فطن — المساعد الأكاديمي لجامعة أم القرى",
    short_name: "فطن",
    description: "اسأل عن لوائح جامعتك، تابع معدلك، ونظّم مذاكرتك.",
    lang: "ar",
    dir: "rtl",
    start_url: "/dashboard/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#5b4be6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
