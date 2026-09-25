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
  /** `external`: may also read another indicator's plot on the same chart (value "plot:<uid>:<key>"). */
  | { key: string; label: string; type: "source"; default: string; external?: boolean }
  | { key: string; label: string; type: "select"; default: string; options: readonly string[] }
  | { key: string; label: string; type: "bool"; default: boolean }
  | { key: string; label: string; type: "color"; default: string }
  /** Free text, e.g. a symbol for request.security (Correlation Coefficient). */
  | { key: string; label: string; type: "text"; default: string };

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
  /** "xcross" is Pine's shape.xcross, drawn by the chart's own primitive. */
  shape: "arrowUp" | "arrowDown" | "circle" | "square" | "xcross";
  color: string;
  text?: string;
};

/** Pine line.new(): bar indices and prices. */
export type Line = { x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean; width?: number };

export type DrawSize = "tiny" | "small" | "normal" | "large" | "huge";

/** Pine label.new(). "left": text starts at the point (style_label_left); "right": text ends
 *  at it (style_label_right); "center": boxed text centered on it; "circle": a filled dot
 *  (style_circle with no text). */
export type Label = {
  index: number;
  price: number;
  text: string;
  style: "left" | "right" | "center" | "circle";
  textColor?: string;
  bg?: string;
  size: DrawSize;
};

/** Pine box.new(): bar indices and prices, drawn behind the candles. */
export type Box = {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
  bg: string;
  border?: string;
  dashed?: boolean;
  text?: string;
  textColor?: string;
};

export type TableCell = {
  col: number;
  row: number;
  /** Merged cells, like table.merge_cells(). */
  colSpan?: number;
  text: string;
  color?: string;
  bg?: string;
  size?: DrawSize;
  align?: "left" | "center" | "right";
  bold?: boolean;
  tooltip?: string;
  /** Thin divider rows (Pine's height=0.5). */
  thin?: boolean;
};

/** Pine table.new(): drawn over the price pane at a corner. */
export type IndicatorTable = {
  position: "top_right" | "bottom_right" | "bottom_left" | "top_left";
  bg: string;
  frame: string;
  border: string;
  cells: TableCell[];
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
  lines?: Line[];
  labels?: Label[];
  boxes?: Box[];
  table?: IndicatorTable;
};

/** Daily Bitcoin price and blocks mined per UTC day (/api/onchain/btc-daily). */
export type BtcDaily = { time: number[]; price: number[]; blocks: number[] };

/** What Pine's syminfo / timeframe would say about the chart. */
export type ChartContext = {
  symbol: string;
  /** syminfo.ticker as TradingView would spell it (BTCUSDT, EURUSD, AAPL). */
  ticker: string;
  type: "crypto" | "forex" | "stock" | "index";
  /** Exchange time zone for hour()/dayofweek() etc. */
  timezone: string;
  intervalSeconds: number;
  /** The chart's range button (1D, 5D, 1M, 6M, YTD, 1Y, 5Y, MAX), for fetching other symbols alike. */
  range?: string;
  /** The chosen candle interval (1m … 1M), or undefined for the range's own. */
  interval?: string;
};

/** Data an indicator reads from outside the chart's own candles, like Pine's request.security. */
export type ExternalData = {
  btcDaily?: BtcDaily;
  chart?: ChartContext;
  /** Other indicators' plots on the same chart, keyed "plot:<uid>:<key>" (see InputDef source). */
  plots?: Record<string, Series>;
  /** Responses for the API paths an indicator asked for through `fetches`. */
  fetched?: Record<string, unknown>;
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
  /** External series the chart must fetch before computing; plots stay empty until they arrive. */
  needs?: ReadonlyArray<"btcDaily">;
  /** API paths to load before computing (request.security of other symbols); results arrive in ext.fetched. */
  fetches?(p: Params, chart: ChartContext): string[];
  /** Other names people search for (e.g. "Exponential Moving Average" for EMA). */
  aliases?: string[];
  /** Inputs shown in the legend title; all non-bool inputs when omitted. */
  legendInputs?: string[];
  compute(bars: Bars, p: Params, ext?: ExternalData): IndicatorResult;
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
export const colorInput = (key: string, label: string, def: string): InputDef => ({ key, label, type: "color", default: def });
export const text = (key: string, label: string, def: string): InputDef => ({ key, label, type: "text", default: def });

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
