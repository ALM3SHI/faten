import localFont from "next/font/local";

// IBM Plex Sans Arabic (SIL OFL — see OFL-IBMPlexSansArabic.txt), self-hosted
// like Cairo. Candidate for long-form body text: narrower letters and calmer
// rhythm than Cairo in paragraphs. Not preloaded, so only pages that actually
// use `font-body` download it.
export const plexArabic = localFont({
  src: [
    { path: "./plex-arabic-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./plex-arabic-500.woff2", weight: "500", style: "normal" },
    { path: "./plex-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./plex-arabic-600.woff2", weight: "600", style: "normal" },
    { path: "./plex-latin-600.woff2", weight: "600", style: "normal" },
    { path: "./plex-arabic-700.woff2", weight: "700", style: "normal" },
    { path: "./plex-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-arabic",
  display: "swap",
  preload: false,
});
