/**
 * Where pdf.js finds its data files (copied to public/pdfjs/ by
 * scripts/copy-pdfjs-assets.mjs). Pass these with every getDocument call:
 * without the character maps, text in PDFs whose CID fonts are not embedded
 * (common in Arabic slides exported from Office) draws as boxes or the wrong
 * letters, and without the standard fonts non-embedded Helvetica/Times/Symbol
 * text (maths symbols included) falls back to whatever the browser has.
 */
export const PDF_ASSET_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
} as const;
