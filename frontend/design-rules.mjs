// What "off the design system" means, in one place. Used by eslint.config.mjs
// (to reject it in migrated code) and by scripts/design-debt.mjs (to count
// what is left in the pages that have not moved to design system v2 yet).

const PALETTE =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";

export const RULES = [
  {
    id: "font-size",
    pattern: String.raw`\btext-\[[0-9.]+(px|rem|em)\]`,
    message: "Arbitrary font size. Use the type scale: text-display, text-title, text-heading, text-subheading, text-body, text-small, text-caption.",
  },
  {
    id: "radius",
    pattern: String.raw`\brounded(-[trblse]{1,2})?-\[`,
    message: "Arbitrary corner radius. Use rounded-control, rounded-card, rounded-dialog or rounded-full.",
  },
  {
    id: "palette-color",
    pattern: String.raw`\b(bg|text|border|ring|outline|from|via|to|fill|stroke|divide|shadow|decoration)-(${PALETTE})-[0-9]{2,3}\b`,
    message: "Raw Tailwind palette colour. Use a design token: ink, ink-muted, line, surface, brand, or a status tone (success/warning/danger/info -soft, -line, -ink).",
  },
];

export const RAW_BUTTON_MESSAGE =
  "Raw <button>. Use Button or IconButton from @/components/ds so focus, size and disabled states stay consistent.";
