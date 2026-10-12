"use client";

import { useSyncExternalStore } from "react";

// Whether the window is taller than it's wide (a monitor turned on its side, a phone held
// upright): the layout then stacks what sits side by side on a wide screen. Most of it follows
// from CSS (Tailwind's portrait: and max-sm: variants); these are for what's laid out in code.

export const PORTRAIT = "(orientation: portrait)";
/** A phone's width (Tailwind's sm breakpoint). */
export const NARROW = "(max-width: 639.98px)";

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

export const usePortrait = () => useMedia(PORTRAIT);
