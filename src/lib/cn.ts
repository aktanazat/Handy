import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/* tailwind-merge only knows Tailwind's own scale names, so a project theme step
 * like `rounded-card` looks like an unrelated class: it keeps both it and the
 * kit's `rounded-xl`, and source order hands the win to the component. Every
 * `rounded-card` on a vg Card, Dialog or Popover was silently rendering the
 * kit's radius. Registering the project's radius and shadow steps in their
 * conflict groups is what makes last-writer-wins actually hold. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [{ rounded: ["card", "control", "panel", "dialog"] }],
      shadow: [{ shadow: ["card"] }],
    },
  },
});

/** Join conditional class names, last-writer-wins on conflicting utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
