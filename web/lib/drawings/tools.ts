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

export type Drawing = {
  id: string;
  tool: ToolId;
  points: DrawPoint[];
  color: string;
  width: 1 | 2 | 3 | 4;
  dash?: "solid" | "dashed" | "dotted";
  locked?: boolean;
  /** Text tool: what it says. */
  text?: string;
  /** Gann square fixed: price per bar it keeps. */
  ratio?: number;
};

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
