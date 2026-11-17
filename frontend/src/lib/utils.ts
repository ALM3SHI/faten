import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge only knows Tailwind's built-in names. Without this it reads
// the design system's sizes (`text-body`) as COLOURS and silently drops a real
// colour next to them (`text-on-brand text-body` → white text lost), and it
// does not see two custom radii or shadows as conflicting. Keep these lists
// in step with the `@theme` block in app/globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "title", "heading", "subheading", "body", "small", "caption"] }],
      rounded: [{ rounded: ["control", "card", "dialog"] }],
      shadow: [{ shadow: ["card", "menu", "dialog"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
