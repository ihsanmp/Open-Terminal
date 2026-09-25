// Colors as the style editor handles them: any CSS hex/rgb(a) in, "#RRGGBB" + opacity out.

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(c: string): Rgba {
  const s = c.trim();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join("");
    const v = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: v(0), g: v(2), b: v(4), a: hex.length >= 8 ? v(6) / 255 : 1 };
  }
  const m = /rgba?\(([^)]+)\)/i.exec(s);
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((x) => Number(x.trim()));
    return { r, g, b, a: Number.isFinite(a) ? a : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** "#RRGGBB" of a color, ignoring its alpha. */
export const toHex = (c: string) => {
  const { r, g, b } = parseColor(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
};

/** Opacity 0–100 of a color. */
export const opacityOf = (c: string) => Math.round(parseColor(c).a * 100);

/** A color at an opacity (0–100): "#RRGGBB" when opaque, "#RRGGBBAA" otherwise. */
export function withOpacity(c: string, opacity: number): string {
  const hex = toHex(c);
  return opacity >= 100 ? hex : `${hex}${hex2((Math.max(0, opacity) / 100) * 255)}`.toUpperCase();
}

/** TradingView's color palette: a gray row, the main hues, then tints from light to dark. */
export const PALETTE: string[][] = [
  ["#FFFFFF", "#D1D4DC", "#B2B5BE", "#9598A1", "#787B86", "#5D606B", "#434651", "#2A2E39", "#131722", "#000000"],
  ["#F23645", "#FF9800", "#FFEB3B", "#4CAF50", "#089981", "#00BCD4", "#2962FF", "#673AB7", "#9C27B0", "#E91E63"],
  ["#FCCBCD", "#FFE0B2", "#FFF9C4", "#C8E6C9", "#ACE5DC", "#B2EBF2", "#BBD9FB", "#D1C4E9", "#E1BEE7", "#F8BBD0"],
  ["#FAA1A4", "#FFCC80", "#FFF59D", "#A5D6A7", "#70CCBD", "#80DEEA", "#90BFF9", "#B39DDB", "#CE93D8", "#F48FB1"],
  ["#F77C80", "#FFB74D", "#FFF176", "#81C784", "#42BDA8", "#4DD0E1", "#5B9CF6", "#9575CD", "#BA68C8", "#F06292"],
  ["#F7525F", "#FFA726", "#FFEE58", "#66BB6A", "#22AB94", "#26C6DA", "#3179F5", "#7E57C2", "#AB47BC", "#EC407A"],
  ["#B22833", "#F57C00", "#FBC02D", "#388E3C", "#056656", "#0097A7", "#1848CC", "#512DA8", "#7B1FA2", "#C2185B"],
  ["#801922", "#E65100", "#F57F17", "#1B5E20", "#00332A", "#006064", "#0C3299", "#311B92", "#4A148C", "#880E4F"],
];
