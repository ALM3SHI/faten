import localFont from "next/font/local";

// IBM Plex Sans Arabic (SIL OFL — see OFL-IBMPlexSansArabic.txt), self-hosted
// like Cairo. It is the reading font of design system v2 (body text, labels,
// fields); Cairo stays for headings and big numbers. The variable is set on
// <body>, but the files are not preloaded: a browser downloads a weight only
// when a page that has moved to `ds-page` actually renders text in it.
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
