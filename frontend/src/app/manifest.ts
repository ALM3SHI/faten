import type { MetadataRoute } from "next";

// Required for `output: "export"` — the manifest is written at build time.
export const dynamic = "force-static";

/** Lets students install Faten on their phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "فطن — المساعد الأكاديمي لجامعة أم القرى",
    short_name: "فطن",
    description: "اسأل عن لوائح جامعتك، تابع معدلك، ونظّم مذاكرتك.",
    id: "/",
    lang: "ar",
    dir: "rtl",
    start_url: "/dashboard/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    categories: ["education", "productivity"],
    background_color: "#0a0a0f",
    theme_color: "#5b4be6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Shown in the browser's richer install dialog.
    screenshots: [
      { src: "/landing/phone-dashboard-dark.webp", sizes: "780x1688", type: "image/webp", form_factor: "narrow", label: "اليوم: محاضرتك القادمة وأسبوعك" },
      { src: "/landing/phone-chat-dark.webp", sizes: "780x1688", type: "image/webp", form_factor: "narrow", label: "اسأل فطن: جواب من اللائحة مع المصدر" },
      { src: "/landing/dashboard-dark.webp", sizes: "1920x1200", type: "image/webp", form_factor: "wide", label: "اليوم" },
      { src: "/landing/record-dark.webp", sizes: "1920x1200", type: "image/webp", form_factor: "wide", label: "معدّلي" },
    ],
    // Long-press the home-screen icon to jump straight to a space.
    shortcuts: [
      { name: "اسأل فطن", url: "/chat/", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "وقتي", url: "/time/", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "معدّلي", url: "/record/", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
