// The chart's drawing tools, as TradingView's left toolbar groups them: lines, Fibonacci and Gann,
// shapes, text and measuring. A drawing is anchored at points in time and price, so it stays put
// through zooming, scrolling and a change of interval.

export type ToolId =
  | "trend" | "ray" | "infoLine" | "extended" | "trendAngle" | "hline" | "hray" | "vline" | "crossLine"
  | "channel" | "regression" | "flatTopBottom" | "disjointChannel"
  | "pitchfork" | "schiffPitchfork" | "modifiedSchiff" | "insidePitchfork"
  | "fibRetracement" | "fibExtension" | "fibChannel" | "fibTimeZone" | "fibSpeedFan" | "fibTrendTime"
  | "fibCircles" | "fibSpiral" | "fibSpeedArcs" | "fibWedge" | "pitchfan"
  | "gannBox" | "gannSquareFixed" | "gannSquare" | "gannFan"
  | "xabcd" | "cypher" | "headShoulders" | "abcd" | "trianglePattern" | "threeDrives"
  | "elliottImpulse" | "elliottCorrection" | "elliottTriangle" | "elliottDouble" | "elliottTriple"
  | "cyclicLines" | "timeCycles" | "sineLine"
  | "longPosition" | "shortPosition" | "forecast" | "anchoredVwap" | "volumeProfile" | "priceRange" | "dateRange" | "measure"
  | "brush" | "highlighter" | "arrowMarker" | "arrow" | "arrowUp" | "arrowDown"
  | "rect" | "rotatedRect" | "path" | "circle" | "ellipse" | "polyline" | "triangle" | "arc" | "curve" | "doubleCurve"
  | "text" | "note" | "priceNote" | "pin" | "callout" | "priceLabel" | "signpost" | "flagMark";

/** TradingView's toolbar groups: lines, Fibonacci and Gann, patterns, forecasting and measuring,
 *  shapes, and annotations. */
export type ToolGroup = "lines" | "fib" | "patterns" | "forecast" | "shapes" | "text";

export type ToolDef = {
  id: ToolId;
  label: string;
  group: ToolGroup;
  /** Heading inside its group's menu (TradingView's FIBONACCI / GANN). */
  section?: string;
  /** Points placed to draw it (the least, for one drawn freehand or click by click). */
  points: number;
  /** What it is, for its "?" hint. */
  hint: string;
  /** Drawn by dragging (a brush), or click by click until the last point is clicked again (a path). */
  variable?: "freehand" | "clicks";
  /** Points worked out from those placed: a position's stop, from its entry and target. */
  derive?: (pts: DrawPoint[]) => DrawPoint[];
  /** The text it starts with; its Settings open as it's placed, to write it. */
  startText?: string;
};

/** A position's stop, as far from its entry as its target, the other way (1:1). */
const stopFor = (pts: DrawPoint[]): DrawPoint[] => {
  const [entry, target] = pts;
  return [entry, target, { time: entry.time, price: 2 * entry.price - target.price }];
};

export const TOOLS: ToolDef[] = [
  { id: "trend", label: "Trend line", group: "lines", section: "LINES", points: 2, hint: "A straight line between two points." },
  { id: "ray", label: "Ray", group: "lines", section: "LINES", points: 2, hint: "A line from a point through a second one, on to the edge." },
  { id: "infoLine", label: "Info line", group: "lines", section: "LINES", points: 2, hint: "A trend line with its price change, bars, time and angle." },
  { id: "extended", label: "Extended line", group: "lines", section: "LINES", points: 2, hint: "A line through two points, across the whole chart." },
  { id: "trendAngle", label: "Trend angle", group: "lines", section: "LINES", points: 2, hint: "A trend line and its angle from the horizontal." },
  { id: "hline", label: "Horizontal line", group: "lines", section: "LINES", points: 1, hint: "A price level across the chart." },
  { id: "hray", label: "Horizontal ray", group: "lines", section: "LINES", points: 1, hint: "A price level from a point on to the right." },
  { id: "vline", label: "Vertical line", group: "lines", section: "LINES", points: 1, hint: "A moment in time, top to bottom." },
  { id: "crossLine", label: "Cross line", group: "lines", section: "LINES", points: 1, hint: "A horizontal and a vertical line through a point." },
  { id: "channel", label: "Parallel channel", group: "lines", section: "CHANNELS", points: 3, hint: "A trend line and a parallel one: two points, then the width." },
  { id: "regression", label: "Regression trend", group: "lines", section: "CHANNELS", points: 2, hint: "The closes' linear regression between two times, with deviation bands." },
  { id: "flatTopBottom", label: "Flat top/bottom", group: "lines", section: "CHANNELS", points: 3, hint: "A trend line and a flat one: two points, then the flat price." },
  { id: "disjointChannel", label: "Disjoint channel", group: "lines", section: "CHANNELS", points: 3, hint: "A trend line and its mirror: two points, then where the other starts." },
  { id: "pitchfork", label: "Pitchfork", group: "lines", section: "PITCHFORKS", points: 3, hint: "Andrews' pitchfork: a pivot, then a high and a low." },
  { id: "schiffPitchfork", label: "Schiff pitchfork", group: "lines", section: "PITCHFORKS", points: 3, hint: "A pitchfork whose handle starts halfway up from the pivot to the next point." },
  { id: "modifiedSchiff", label: "Modified Schiff pitchfork", group: "lines", section: "PITCHFORKS", points: 3, hint: "A pitchfork whose handle starts halfway between the first two points." },
  { id: "insidePitchfork", label: "Inside pitchfork", group: "lines", section: "PITCHFORKS", points: 3, hint: "A pitchfork whose handle starts halfway between the first and last points." },

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

  { id: "xabcd", label: "XABCD pattern", group: "patterns", section: "PATTERNS", points: 5, hint: "A harmonic pattern: X, A, B, C, D, with each leg's ratio." },
  { id: "cypher", label: "Cypher pattern", group: "patterns", section: "PATTERNS", points: 5, hint: "The Cypher harmonic pattern: X, A, B, C, D, with its ratios." },
  { id: "headShoulders", label: "Head and shoulders", group: "patterns", section: "PATTERNS", points: 7, hint: "Left shoulder, head and right shoulder, with the neckline." },
  { id: "abcd", label: "ABCD pattern", group: "patterns", section: "PATTERNS", points: 4, hint: "Two equal legs: A, B, C, D, with their ratios." },
  { id: "trianglePattern", label: "Triangle pattern", group: "patterns", section: "PATTERNS", points: 4, hint: "Four swings narrowing to a point." },
  { id: "threeDrives", label: "Three drives pattern", group: "patterns", section: "PATTERNS", points: 6, hint: "Three drives up (or down) with their retracements." },
  { id: "elliottImpulse", label: "Elliott impulse wave (12345)", group: "patterns", section: "ELLIOTT WAVES", points: 6, hint: "Five waves: the start, then waves 1 to 5." },
  { id: "elliottCorrection", label: "Elliott correction wave (ABC)", group: "patterns", section: "ELLIOTT WAVES", points: 4, hint: "Three waves: the start, then A, B, C." },
  { id: "elliottTriangle", label: "Elliott triangle wave (ABCDE)", group: "patterns", section: "ELLIOTT WAVES", points: 6, hint: "A triangle: the start, then A to E." },
  { id: "elliottDouble", label: "Elliott double combo wave (WXY)", group: "patterns", section: "ELLIOTT WAVES", points: 4, hint: "A double combination: the start, then W, X, Y." },
  { id: "elliottTriple", label: "Elliott triple combo wave (WXYXZ)", group: "patterns", section: "ELLIOTT WAVES", points: 6, hint: "A triple combination: the start, then W, X, Y, X, Z." },
  { id: "cyclicLines", label: "Cyclic lines", group: "patterns", section: "CYCLES", points: 2, hint: "Vertical lines repeating a span of time." },
  { id: "timeCycles", label: "Time cycles", group: "patterns", section: "CYCLES", points: 2, hint: "Arcs repeating a span of time." },
  { id: "sineLine", label: "Sine line", group: "patterns", section: "CYCLES", points: 2, hint: "A sine wave: a peak, then the next trough." },

  { id: "longPosition", label: "Long position", group: "forecast", section: "FORECASTING", points: 2, hint: "A trade: the entry, then the target (the stop starts as far the other way).", derive: stopFor },
  { id: "shortPosition", label: "Short position", group: "forecast", section: "FORECASTING", points: 2, hint: "A short trade: the entry, then the target (the stop starts as far the other way).", derive: stopFor },
  { id: "forecast", label: "Forecast", group: "forecast", section: "FORECASTING", points: 2, hint: "Where price is expected to go: from a point to a target, with the change." },
  { id: "anchoredVwap", label: "Anchored VWAP", group: "forecast", section: "VOLUME-BASED", points: 1, hint: "The volume-weighted average price from a bar on." },
  { id: "volumeProfile", label: "Fixed range volume profile", group: "forecast", section: "VOLUME-BASED", points: 2, hint: "The volume traded at each price between two times." },
  { id: "priceRange", label: "Price range", group: "forecast", section: "MEASURER", points: 2, hint: "The change in price between two points." },
  { id: "dateRange", label: "Date range", group: "forecast", section: "MEASURER", points: 2, hint: "The bars and time between two points." },
  { id: "measure", label: "Date and price range", group: "forecast", section: "MEASURER", points: 2, hint: "The change in price, percent, bars and time between two points." },

  { id: "brush", label: "Brush", group: "shapes", section: "BRUSHES", points: 2, hint: "Draw freely: press and drag.", variable: "freehand" },
  { id: "highlighter", label: "Highlighter", group: "shapes", section: "BRUSHES", points: 2, hint: "Highlight freely: press and drag.", variable: "freehand" },
  { id: "arrowMarker", label: "Arrow marker", group: "shapes", section: "ARROWS", points: 2, hint: "A broad arrow from one point to another." },
  { id: "arrow", label: "Arrow", group: "shapes", section: "ARROWS", points: 2, hint: "A line with an arrowhead." },
  { id: "arrowUp", label: "Arrow mark up", group: "shapes", section: "ARROWS", points: 1, hint: "An arrow pointing up at a bar." },
  { id: "arrowDown", label: "Arrow mark down", group: "shapes", section: "ARROWS", points: 1, hint: "An arrow pointing down at a bar." },
  { id: "rect", label: "Rectangle", group: "shapes", section: "SHAPES", points: 2, hint: "A box between two corners." },
  { id: "rotatedRect", label: "Rotated rectangle", group: "shapes", section: "SHAPES", points: 3, hint: "A box at an angle: one side, then its width." },
  { id: "path", label: "Path", group: "shapes", section: "SHAPES", points: 2, hint: "Lines from point to point, ending in an arrow; click the last point again to finish.", variable: "clicks" },
  { id: "circle", label: "Circle", group: "shapes", section: "SHAPES", points: 2, hint: "A circle: the center, then the radius." },
  { id: "ellipse", label: "Ellipse", group: "shapes", section: "SHAPES", points: 2, hint: "An ellipse inside a box between two corners." },
  { id: "polyline", label: "Polyline", group: "shapes", section: "SHAPES", points: 3, hint: "A closed shape, point by point; click the first or last point again to finish.", variable: "clicks" },
  { id: "triangle", label: "Triangle", group: "shapes", section: "SHAPES", points: 3, hint: "A triangle through three points." },
  { id: "arc", label: "Arc", group: "shapes", section: "SHAPES", points: 3, hint: "An arc: its two ends, then a point it passes." },
  { id: "curve", label: "Curve", group: "shapes", section: "SHAPES", points: 3, hint: "A curve: its two ends, then where it bends towards." },
  { id: "doubleCurve", label: "Double curve", group: "shapes", section: "SHAPES", points: 4, hint: "An S-curve: its two ends, then two bends." },

  { id: "text", label: "Text", group: "text", section: "TEXT AND NOTES", points: 1, hint: "A note on the chart.", startText: "Text" },
  { id: "note", label: "Note", group: "text", section: "TEXT AND NOTES", points: 1, hint: "A note pinned to a bar.", startText: "Note" },
  { id: "priceNote", label: "Price note", group: "text", section: "TEXT AND NOTES", points: 2, hint: "A price, labeled away from where it is." },
  { id: "pin", label: "Pin", group: "text", section: "TEXT AND NOTES", points: 1, hint: "A pin on a bar, with a text." },
  { id: "callout", label: "Callout", group: "text", section: "TEXT AND NOTES", points: 2, hint: "A text box pointing at a place: the place, then the box.", startText: "Text" },
  { id: "priceLabel", label: "Price label", group: "text", section: "TEXT AND NOTES", points: 1, hint: "A label with the price at a point." },
  { id: "signpost", label: "Signpost", group: "text", section: "TEXT AND NOTES", points: 1, hint: "A sign on a post above a bar.", startText: "Text" },
  { id: "flagMark", label: "Flag mark", group: "text", section: "TEXT AND NOTES", points: 1, hint: "A flag on a bar." },
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
  /** Patterns, positions and notes: their labels. */
  showLabels?: boolean;
  /** Long / short position: the target's and the stop's zones. */
  profitColor?: string;
  stopColor?: string;
  /** Regression trend: its bands at this many standard deviations. */
  deviation?: number;
  /** Fixed range volume profile: its rows, their colors (up and down volume), its point of control. */
  rows?: number;
  upColor?: string;
  downColor?: string;
  pocLine?: boolean;
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
   * hline / vline / cross: Line and its price or time labels; a Text tab.
   * channel: Extend, its lines, Middle line, Background.
   * box: Extend, Border, Middle line, Background; a Text tab.
   * levels: Trend line, Levels line, the levels and their options.
   * spiral: Line and the way it turns.
   * shape: Line (or border) and, with fill, Background in a color of its own.
   * pattern: Line, Background, Labels and their size.
   * position: the target's and stop's colors, Line, Labels.
   * regression: Line, deviation, Background. vwap: Line.
   * volume: rows, up and down colors, point of control.
   * text: the Text tool (a Text tab only).
   * measure: Background, Label background, Font size.
   */
  layout: "line" | "hline" | "vline" | "cross" | "channel" | "box" | "levels" | "spiral" | "shape" | "pattern" | "position" | "regression" | "vwap" | "volume" | "text" | "measure";
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
  /** A channel's middle line. */
  middle?: boolean;
  /** A text of its own, on a Text tab. */
  textTab?: boolean;
  /** A dash style for its line. */
  dash?: boolean;
};

const LINE: ToolFeatures = { layout: "line", extend: true, dash: true };
const PITCHFORK: ToolFeatures = { layout: "levels", levels: "ratio", fill: true, extend: true, dash: true };
const PATTERN: ToolFeatures = { layout: "pattern", fill: true, dash: true };
const WAVE: ToolFeatures = { layout: "pattern", dash: true };
const SHAPE: ToolFeatures = { layout: "shape", fill: true, dash: true, textTab: true };
const OUTLINE: ToolFeatures = { layout: "shape", dash: true };
const NOTE: ToolFeatures = { layout: "shape", fill: true, textTab: true };

export const TOOL_FEATURES: Record<ToolId, ToolFeatures> = {
  trend: LINE,
  ray: { layout: "line", dash: true },
  infoLine: LINE,
  extended: { layout: "line", dash: true },
  trendAngle: LINE,
  hline: { layout: "hline", dash: true },
  hray: { layout: "hline", dash: true },
  vline: { layout: "vline", dash: true },
  crossLine: { layout: "cross", dash: true },
  channel: { layout: "channel", fill: true, extend: true, middle: true, dash: true },
  regression: { layout: "regression", fill: true, extend: true, dash: true },
  flatTopBottom: { layout: "channel", fill: true, extend: true, dash: true },
  disjointChannel: { layout: "channel", fill: true, extend: true, dash: true },
  pitchfork: PITCHFORK,
  schiffPitchfork: PITCHFORK,
  modifiedSchiff: PITCHFORK,
  insidePitchfork: PITCHFORK,
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
  xabcd: PATTERN,
  cypher: PATTERN,
  headShoulders: PATTERN,
  abcd: WAVE,
  trianglePattern: PATTERN,
  threeDrives: WAVE,
  elliottImpulse: WAVE,
  elliottCorrection: WAVE,
  elliottTriangle: WAVE,
  elliottDouble: WAVE,
  elliottTriple: WAVE,
  cyclicLines: OUTLINE,
  timeCycles: { layout: "shape", fill: true, dash: true },
  sineLine: OUTLINE,
  longPosition: { layout: "position" },
  shortPosition: { layout: "position" },
  forecast: { layout: "shape", dash: true },
  anchoredVwap: { layout: "vwap", dash: true },
  volumeProfile: { layout: "volume" },
  priceRange: { layout: "measure", fill: true },
  dateRange: { layout: "measure", fill: true },
  measure: { layout: "measure", fill: true },
  brush: { layout: "shape" },
  highlighter: { layout: "shape" },
  arrowMarker: { layout: "shape", textTab: true },
  arrow: { layout: "shape", dash: true },
  arrowUp: { layout: "shape", textTab: true },
  arrowDown: { layout: "shape", textTab: true },
  rect: { layout: "box", fill: true, extend: true, dash: true },
  rotatedRect: SHAPE,
  path: OUTLINE,
  circle: SHAPE,
  ellipse: SHAPE,
  polyline: SHAPE,
  triangle: SHAPE,
  arc: SHAPE,
  curve: OUTLINE,
  doubleCurve: OUTLINE,
  text: { layout: "text" },
  note: NOTE,
  priceNote: { layout: "shape", dash: true, textTab: true },
  pin: NOTE,
  callout: NOTE,
  priceLabel: NOTE,
  signpost: NOTE,
  flagMark: NOTE,
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
  switch (tool) {
    case "rect":
    case "rotatedRect":
    case "ellipse":
    case "circle":
    case "polyline":
    case "triangle":
    case "arc":
      return "#9C27B0";
    case "text":
      return "#D9D9D9";
    case "arrowUp":
    case "longPosition":
      return "#089981";
    case "arrowDown":
    case "shortPosition":
    case "flagMark":
      return "#F23645";
    case "highlighter":
      return "#FFD600";
    case "anchoredVwap":
    case "volumeProfile":
      return "#2962FF";
  }
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
