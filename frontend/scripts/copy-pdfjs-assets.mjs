// Copies the data files pdf.js needs from node_modules into public/pdfjs/, so
// they always match the installed pdfjs-dist version:
//   cmaps/          character maps — without them, Arabic and CJK text in PDFs
//                   with non-embedded CID fonts draws as boxes or wrong glyphs
//   standard_fonts/ the 14 standard PDF fonts when a file does not embed them
//   wasm/           JPEG2000 / JBIG2 image decoders (scanned slides)
//   iccs/           colour profiles
// Runs before `dev` and `build` (package.json) and before the e2e build.
// public/pdfjs/ is git-ignored: it is rebuilt from the lockfile every time.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");
const DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];

if (!existsSync(src)) {
  console.error("[pdfjs-assets] node_modules/pdfjs-dist is missing — run npm install first.");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const d of DIRS) {
  const from = join(src, d);
  if (!existsSync(from)) {
    console.error(`[pdfjs-assets] pdfjs-dist has no ${d}/ folder.`);
    process.exit(1);
  }
  cpSync(from, join(dest, d), { recursive: true });
}
console.log(`[pdfjs-assets] copied ${DIRS.join(", ")} to public/pdfjs/`);
