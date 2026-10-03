// How much larger than designed every text in the app is drawn. The CSS side is --font-scale in
// app/globals.css (keep the two the same): it scales the page's text, this the text drawn on
// canvases and in chart libraries, which CSS doesn't reach.
export const FONT_SCALE = 1.25;

/** A designed font size in pixels, at the app's text scale. */
export const fontPx = (px: number): number => px * FONT_SCALE;
