import type { Bars, Series } from "./core";

export type Category =
  | "Moving Averages"
  | "Bands & Channels"
  | "Trend"
  | "Oscillators"
  | "Momentum"
  | "Volatility"
  | "Volume"
  | "Support & Resistance"
  | "Community";

export type InputDef =
  | { key: string; label: string; type: "int" | "float"; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "source"; default: string }
  | { key: string; label: string; type: "select"; default: string; options: readonly string[] }
  | { key: string; label: string; type: "bool"; default: boolean };

export type Params = Record<string, number | string | boolean>;

export type PlotStyle = "line" | "step" | "histogram" | "area" | "circles";

export type PlotDef = {
  key: string;
  title: string;
  color: string;
  style?: PlotStyle;
  width?: 1 | 2 | 3 | 4;
  /** "legend": value shown but not drawn; "none": helper series used only by fills. */
  display?: "legend" | "none";
  /** Connect the non-na points directly instead of breaking at na (ZigZag). */
  connectGaps?: boolean;
  dashed?: boolean;
};

export type Color = string | undefined;

export type Marker = {
  index: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  text?: string;
};

export type IndicatorResult = {
  plots: Record<string, Series>;
  /** Per-bar color overrides for a plot (undefined = the plot's default). */
  colors?: Record<string, Color[]>;
  /** Bars to shift a plot by; positive values extend into the future. */
  offsets?: Record<string, number>;
  /** Filled area between two plots (plot key) or constant levels (number). */
  fills?: Array<{ a: string | number; b: string | number; color: string | Color[] }>;
  hlines?: Array<{ price: number; color: string; dashed?: boolean }>;
  markers?: Marker[];
  /** Recolors the main price candles, like Pine's barcolor(). */
  barColors?: Color[];
  /** Pane background per bar, like Pine's bgcolor(). */
  bgColors?: Color[];
};

export type IndicatorDef = {
  id: string;
  name: string;
  short: string;
  category: Category;
  overlay: boolean;
  /** Overlay drawn on its own bottom scale inside the price pane (Volume). */
  volumeOverlay?: boolean;
  /** false: plots don't stretch the price scale (TradingView pivots/drawings behave this way). */
  autoscale?: false;
  inputs: InputDef[];
  plots: PlotDef[];
  precision?: number;
  description?: string;
  compute(bars: Bars, p: Params): IndicatorResult;
};

export type IndicatorInstance = {
  uid: string;
  id: string;
  params: Params;
  hidden?: boolean;
};

// ---- input builders keep the catalog compact ------------------------------

export const int = (key: string, label: string, def: number, min = 1, max = 5000): InputDef => ({
  key, label, type: "int", default: def, min, max, step: 1,
});
export const float = (key: string, label: string, def: number, step = 0.1, min = -1e9): InputDef => ({
  key, label, type: "float", default: def, step, min,
});
export const src = (def = "close", key = "source", label = "Source"): InputDef => ({ key, label, type: "source", default: def });
export const select = (key: string, label: string, options: readonly string[], def: string): InputDef => ({
  key, label, type: "select", options, default: def,
});
export const bool = (key: string, label: string, def: boolean): InputDef => ({ key, label, type: "bool", default: def });

export const n = (p: Params, key: string) => Number(p[key]);
export const s = (p: Params, key: string) => String(p[key]);
export const b = (p: Params, key: string) => Boolean(p[key]);

// TradingView's default palette.
export const C = {
  blue: "#2962FF",
  orange: "#FF6D00",
  red: "#F23645",
  green: "#089981",
  teal: "#26A69A",
  purple: "#7E57C2",
  yellow: "#FFEB3B",
  gray: "#787B86",
  lightBlue: "#2196F3",
  maroon: "#880E4F",
  pink: "#E91E63",
  lime: "#00E676",
  aqua: "#00BCD4",
};

export const alpha = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
};
