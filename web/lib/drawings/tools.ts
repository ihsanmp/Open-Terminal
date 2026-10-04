// The chart's drawing tools, as TradingView's left toolbar groups them: lines, Fibonacci and Gann,
// shapes, text and measuring. A drawing is anchored at points in time and price, so it stays put
// through zooming, scrolling and a change of interval.

export type ToolId =
  | "trend" | "ray" | "extended" | "hline" | "hray" | "vline" | "channel"
  | "fibRetracement" | "fibExtension" | "fibChannel" | "fibTimeZone" | "fibSpeedFan" | "fibTrendTime"
  | "fibCircles" | "fibSpiral" | "fibSpeedArcs" | "fibWedge" | "pitchfan"
  | "gannBox" | "gannSquareFixed" | "gannSquare" | "gannFan"
  | "rect" | "text" | "measure";

export type ToolGroup = "lines" | "fib" | "shapes" | "text" | "measure";

export type ToolDef = {
  id: ToolId;
  label: string;
  group: ToolGroup;
  /** Heading inside its group's menu (TradingView's FIBONACCI / GANN). */
  section?: string;
  /** Points placed to draw it. */
  points: number;
  /** What it is, for its "?" hint. */
  hint: string;
};

export const TOOLS: ToolDef[] = [
  { id: "trend", label: "Trend line", group: "lines", section: "LINES", points: 2, hint: "A straight line between two points." },
  { id: "ray", label: "Ray", group: "lines", section: "LINES", points: 2, hint: "A line from a point through a second one, on to the edge." },
  { id: "extended", label: "Extended line", group: "lines", section: "LINES", points: 2, hint: "A line through two points, across the whole chart." },
  { id: "hline", label: "Horizontal line", group: "lines", section: "LINES", points: 1, hint: "A price level across the chart." },
  { id: "hray", label: "Horizontal ray", group: "lines", section: "LINES", points: 1, hint: "A price level from a point on to the right." },
  { id: "vline", label: "Vertical line", group: "lines", section: "LINES", points: 1, hint: "A moment in time, top to bottom." },
  { id: "channel", label: "Parallel channel", group: "lines", section: "CHANNELS", points: 3, hint: "A trend line and a parallel one: two points, then the width." },

  { id: "fibRetracement", label: "Fib retracement", group: "fib", section: "FIBONACCI", points: 2, hint: "Levels at the Fibonacci ratios of a move, from its start to its end." },
  { id: "fibExtension", label: "Trend-based fib extension", group: "fib", section: "FIBONACCI", points: 3, hint: "A move (two points) projected from a third: where the next leg may reach." },
  { id: "fibChannel", label: "Fib channel", group: "fib", section: "FIBONACCI", points: 3, hint: "A trend line and parallels at Fibonacci multiples of a width." },
  { id: "fibTimeZone", label: "Fib time zone", group: "fib", section: "FIBONACCI", points: 2, hint: "Vertical lines at Fibonacci multiples (1, 2, 3, 5, 8 …) of a span of time." },
  { id: "fibSpeedFan", label: "Fib speed resistance fan", group: "fib", section: "FIBONACCI", points: 2, hint: "Rays from a point through the Fibonacci divisions of a move's price and time." },
  { id: "fibTrendTime", label: "Trend-based fib time", group: "fib", section: "FIBONACCI", points: 3, hint: "A span of time (two points) projected at Fibonacci ratios from a third." },
  { id: "fibCircles", label: "Fib circles", group: "fib", section: "FIBONACCI", points: 2, hint: "Circles at Fibonacci ratios of a radius: the center, then the radius." },
  { id: "fibSpiral", label: "Fib spiral", group: "fib", section: "FIBONACCI", points: 2, hint: "A golden spiral: the center, then where it passes." },
  { id: "fibSpeedArcs", label: "Fib speed resistance arcs", group: "fib", section: "FIBONACCI", points: 2, hint: "Arcs at Fibonacci ratios of a move, around its start." },
  { id: "fibWedge", label: "Fib wedge", group: "fib", section: "FIBONACCI", points: 3, hint: "Arcs at Fibonacci ratios inside a wedge: the apex, then its two sides." },
  { id: "pitchfan", label: "Pitchfan", group: "fib", section: "FIBONACCI", points: 3, hint: "Rays from a pivot through the Fibonacci divisions between two other points." },
  { id: "gannBox", label: "Gann box", group: "fib", section: "GANN", points: 2, hint: "A box divided at Gann's price and time levels." },
  { id: "gannSquareFixed", label: "Gann square fixed", group: "fib", section: "GANN", points: 2, hint: "A Gann square that keeps its proportion of price to time as it is resized." },
  { id: "gannSquare", label: "Gann square", group: "fib", section: "GANN", points: 2, hint: "A box divided in quarters, with its diagonals, arcs and fan." },
  { id: "gannFan", label: "Gann fan", group: "fib", section: "GANN", points: 2, hint: "Gann's angles (1/8 … 8/1) from a point; the second point sets 1/1." },

  { id: "rect", label: "Rectangle", group: "shapes", section: "SHAPES", points: 2, hint: "A box between two corners." },
  { id: "text", label: "Text", group: "text", points: 1, hint: "A note on the chart." },
  { id: "measure", label: "Measure", group: "measure", points: 2, hint: "The change in price, percent and bars between two points." },
];

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export type DrawPoint = { time: number; price: number };

/** One level of a Fibonacci or Gann tool (a ratio, a time multiple, a Gann angle). */
export type DrawLevel = { value: number; color: string; visible: boolean };

export type LineDashStyle = "solid" | "dashed" | "dotted";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

/** What a drawing's Settings change beyond its line (each tool uses those of TOOL_FEATURES). */
export type DrawingOptions = {
  levels?: DrawLevel[];
  /** Every level in one color instead of its own (kept while off, as TradingView does). */
  useOneColor?: boolean;
  oneColor?: string;
  /** Background between levels or inside the shape, and its opacity (0 … 1); or its own color. */
  fill?: boolean;
  fillOpacity?: number;
  fillColor?: string;
  extendLeft?: boolean;
  extendRight?: boolean;
  /** Levels counted from the other end of the move. */
  reverse?: boolean;
  /** Level labels: the ratio (as a value or a percent) and, for price levels, the price; where
   *  they sit and their size. */
  showLevels?: boolean;
  showPrices?: boolean;
  levelsAs?: "values" | "percents";
  labelHAlign?: HAlign;
  labelVAlign?: VAlign;
  labelSize?: number;
  /** The dashed line between the points a Fibonacci tool is drawn on. */
  trendLine?: boolean;
  trendColor?: string;
  trendWidth?: 1 | 2 | 3 | 4;
  trendDash?: LineDashStyle;
  /** A channel's or rectangle's middle line. */
  middleLine?: boolean;
  middleColor?: string;
  middleWidth?: 1 | 2 | 3 | 4;
  middleDash?: LineDashStyle;
  /** Horizontal line / ray: its price at the right edge. Vertical line: its time at the bottom. */
  priceLabel?: boolean;
  timeLabel?: boolean;
  /** Trend line: arrows at its ends, a dot at its middle, the prices at its points. */
  leftEnd?: "normal" | "arrow";
  rightEnd?: "normal" | "arrow";
  middlePoint?: boolean;
  priceLabels?: boolean;
  /** Trend line stats: what they show, where, and whether only while it's selected. */
  statsPriceRange?: boolean;
  statsPercent?: boolean;
  statsBars?: boolean;
  statsDateRange?: boolean;
  statsAngle?: boolean;
  statsPosition?: HAlign;
  alwaysShowStats?: boolean;
  /** Text (the Text tool's, or one on a line or in a box): its look and place. */
  fontSize?: number;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  textVAlign?: VAlign;
  textHAlign?: HAlign;
  textBackground?: boolean;
  textBgColor?: string;
  textBorder?: boolean;
  textBorderColor?: string;
  /** Fib speed fan: its grid. Gann tools: the diagonals, fan and arcs. */
  grid?: boolean;
  angles?: boolean;
  fans?: boolean;
  arcs?: boolean;
  /** Fib spiral: the way it turns. */
  counterclockwise?: boolean;
  /** Measure: its label's background. */
  labelBackground?: boolean;
};

export type TimeframeKind = "minutes" | "hours" | "days" | "weeks" | "months";

export type Drawing = {
  id: string;
  tool: ToolId;
  points: DrawPoint[];
  color: string;
  width: 1 | 2 | 3 | 4;
  dash?: LineDashStyle;
  locked?: boolean;
  /** Its own name, given in its Settings (the tool's otherwise). */
  name?: string;
  /** The Text tool's text, or the text on a line or in a box. */
  text?: string;
  /** Gann square fixed: price per bar it keeps. */
  ratio?: number;
  options?: DrawingOptions;
  /** The kinds of interval it shows on; all when unset. */
  visibility?: Partial<Record<TimeframeKind, boolean>>;
};

/** A drawing's look, as a template for new ones of its tool ("Save as default"). */
export type DrawingTemplate = Pick<Drawing, "color" | "width" | "dash" | "options">;

/**
 * Which settings a tool has, as TradingView's dialog for it: its layout (what its Style tab
 * starts with, and whether it has a Text tab) and the options under it.
 */
export type ToolFeatures = {
  /**
   * line: Line, its ends, extending, middle point, price labels, stats; a Text tab.
   * hline / vline: Line and its price or time label; a Text tab.
   * channel: Extend, Channel lines, Middle line, Background.
   * box: Extend, Border, Middle line, Background; a Text tab.
   * levels: Trend line, Levels line, the levels and their options.
   * spiral: Line and the way it turns.
   * text: the Text tool (a Text tab only).
   * measure: Background, Label background, Font size.
   */
  layout: "line" | "hline" | "vline" | "channel" | "box" | "levels" | "spiral" | "text" | "measure";
  levels?: "price" | "time" | "ratio" | "angle";
  trendLine?: boolean;
  fill?: boolean;
  extend?: boolean;
  reverse?: boolean;
  /** Level labels; with their place and size too (Fibonacci retracement and extension). */
  labels?: boolean;
  labelPlace?: boolean;
  grid?: boolean;
  angles?: boolean;
  fans?: boolean;
  arcs?: boolean;
  /** A dash style for its line. */
  dash?: boolean;
};

export const TOOL_FEATURES: Record<ToolId, ToolFeatures> = {
  trend: { layout: "line", extend: true, dash: true },
  ray: { layout: "line", dash: true },
  extended: { layout: "line", dash: true },
  hline: { layout: "hline", dash: true },
  hray: { layout: "hline", dash: true },
  vline: { layout: "vline", dash: true },
  channel: { layout: "channel", fill: true, extend: true, dash: true },
  fibRetracement: { layout: "levels", levels: "price", trendLine: true, fill: true, extend: true, reverse: true, labels: true, labelPlace: true, dash: true },
  fibExtension: { layout: "levels", levels: "price", trendLine: true, fill: true, extend: true, reverse: true, labels: true, labelPlace: true, dash: true },
  fibChannel: { layout: "levels", levels: "ratio", fill: true, extend: true, labels: true, dash: true },
  fibTimeZone: { layout: "levels", levels: "time", trendLine: true, fill: true, labels: true, dash: true },
  fibSpeedFan: { layout: "levels", levels: "ratio", fill: true, reverse: true, labels: true, grid: true, dash: true },
  fibTrendTime: { layout: "levels", levels: "time", trendLine: true, fill: true, labels: true, dash: true },
  fibCircles: { layout: "levels", levels: "ratio", trendLine: true, labels: true, dash: true },
  fibSpiral: { layout: "spiral", dash: true },
  fibSpeedArcs: { layout: "levels", levels: "ratio", trendLine: true, labels: true, dash: true },
  fibWedge: { layout: "levels", levels: "ratio", labels: true, dash: true },
  pitchfan: { layout: "levels", levels: "ratio", fill: true, dash: true },
  gannBox: { layout: "levels", levels: "ratio", fill: true, reverse: true, labels: true, angles: true, dash: true },
  gannSquareFixed: { layout: "levels", levels: "ratio", fill: true, angles: true, fans: true, arcs: true, dash: true },
  gannSquare: { layout: "levels", levels: "ratio", fill: true, angles: true, fans: true, arcs: true, dash: true },
  gannFan: { layout: "levels", levels: "angle", fill: true, labels: true, dash: true },
  rect: { layout: "box", fill: true, extend: true, dash: true },
  text: { layout: "text" },
  measure: { layout: "measure", fill: true },
};

/** Which Visibility checkbox an interval falls under. */
export function timeframeKindOf(intervalSeconds: number): TimeframeKind {
  if (intervalSeconds < 3600) return "minutes";
  if (intervalSeconds < 86_400) return "hours";
  if (intervalSeconds < 7 * 86_400) return "days";
  if (intervalSeconds < 28 * 86_400) return "weeks";
  return "months";
}

/** The color a new drawing of a tool starts with (TradingView's defaults, roughly). */
export function defaultColor(tool: ToolId): string {
  if (tool === "measure") return "#2962FF";
  if (tool === "rect") return "#9C27B0";
  if (tool === "text") return "#D9D9D9";
  if (tool.startsWith("gann")) return "#FF9800";
  if (tool.startsWith("fib") || tool === "pitchfan") return "#787B86";
  return "#2962FF";
}

/**
 * Bars' open times ⇄ the chart's logical index, extended at the interval past either end, so
 * a point can sit in the future (to the right of the last bar) or before the first.
 */
export function logicalOfTime(times: number[], interval: number, t: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (t <= times[0]) return (t - times[0]) / interval;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / interval;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

export function timeOfLogical(times: number[], interval: number, l: number): number {
  const n = times.length;
  if (n === 0) return 0;
  if (l <= 0) return times[0] + l * interval;
  if (l >= n - 1) return times[n - 1] + (l - (n - 1)) * interval;
  const i = Math.floor(l);
  return times[i] + (l - i) * (times[i + 1] - times[i]);
}
