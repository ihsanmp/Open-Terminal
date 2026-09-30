// A chart's own appearance, as TradingView's chart Settings dialog has it: the Symbol tab
// (candle body / borders / wick colors, coloring by previous close, price precision,
// timezone) and the Canvas tab (background and grid lines).

export type UpDown = { visible: boolean; up: string; down: string };

export type ChartStyle = {
  colorByPrevClose: boolean;
  body: UpDown;
  borders: UpDown;
  wick: UpDown;
  /** Decimals on the price scale and legend, or the symbol's own. */
  precision: "default" | number;
  /** "exchange" (the symbol's exchange), "UTC", or an IANA zone. */
  timezone: string;
  background: string;
  vertGrid: { visible: boolean; color: string };
  horzGrid: { visible: boolean; color: string };
};

export const UP_COLOR = "#00c853";
export const DOWN_COLOR = "#ff3d3d";

export const DEFAULT_CHART_STYLE: ChartStyle = {
  colorByPrevClose: false,
  body: { visible: true, up: UP_COLOR, down: DOWN_COLOR },
  borders: { visible: true, up: UP_COLOR, down: DOWN_COLOR },
  wick: { visible: true, up: UP_COLOR, down: DOWN_COLOR },
  precision: "default",
  timezone: "exchange",
  background: "#0a0a0a",
  vertGrid: { visible: true, color: "#1a1a1a" },
  horzGrid: { visible: true, color: "#1a1a1a" },
};

/** A saved (possibly partial or older) style, completed with the defaults. */
export function resolveChartStyle(saved: Partial<ChartStyle> | undefined): ChartStyle {
  const s = saved ?? {};
  return {
    ...DEFAULT_CHART_STYLE,
    ...s,
    body: { ...DEFAULT_CHART_STYLE.body, ...s.body },
    borders: { ...DEFAULT_CHART_STYLE.borders, ...s.borders },
    wick: { ...DEFAULT_CHART_STYLE.wick, ...s.wick },
    vertGrid: { ...DEFAULT_CHART_STYLE.vertGrid, ...s.vertGrid },
    horzGrid: { ...DEFAULT_CHART_STYLE.horzGrid, ...s.horzGrid },
  };
}

export const TRANSPARENT = "rgba(0,0,0,0)";

/** Candlestick series options for a style. */
export function candleOptions(s: ChartStyle) {
  return {
    upColor: s.body.visible ? s.body.up : TRANSPARENT,
    downColor: s.body.visible ? s.body.down : TRANSPARENT,
    borderVisible: s.borders.visible,
    borderUpColor: s.borders.up,
    borderDownColor: s.borders.down,
    wickVisible: s.wick.visible,
    wickUpColor: s.wick.up,
    wickDownColor: s.wick.down,
  };
}

/** Whether each bar counts as rising: against its own open, or with "Color bars based on
 *  previous close" against the close before it (the first bar against its open). */
export function risingBars(candles: ReadonlyArray<{ open: number; close: number }>, byPrevClose: boolean): boolean[] {
  return candles.map((c, i) => c.close >= (byPrevClose && i > 0 ? candles[i - 1].close : c.open));
}

/** Per-bar colors for "Color bars based on previous close" (undefined when it's off). */
export function prevCloseColors(candles: ReadonlyArray<{ open: number; close: number }>, s: ChartStyle) {
  if (!s.colorByPrevClose) return undefined;
  return risingBars(candles, true).map((up) => ({
    color: s.body.visible ? (up ? s.body.up : s.body.down) : TRANSPARENT,
    borderColor: up ? s.borders.up : s.borders.down,
    wickColor: up ? s.wick.up : s.wick.down,
  }));
}

/** The zone times are shown in. */
export const resolveTimezone = (s: ChartStyle, exchangeZone: string) => (s.timezone === "exchange" ? exchangeZone : s.timezone);

/** TradingView's timezone list (a selection), with the UTC offset shown as it is today. */
export const TIMEZONES: Array<[string, string]> = [
  ["UTC", "UTC"],
  ["Pacific/Honolulu", "Honolulu"],
  ["America/Anchorage", "Juneau"],
  ["America/Los_Angeles", "Los Angeles"],
  ["America/Denver", "Denver"],
  ["America/Chicago", "Chicago"],
  ["America/New_York", "New York"],
  ["America/Toronto", "Toronto"],
  ["America/Sao_Paulo", "Sao Paulo"],
  ["Europe/London", "London"],
  ["Europe/Berlin", "Berlin"],
  ["Europe/Paris", "Paris"],
  ["Europe/Zurich", "Zurich"],
  ["Europe/Istanbul", "Istanbul"],
  ["Europe/Moscow", "Moscow"],
  ["Asia/Dubai", "Dubai"],
  ["Asia/Kolkata", "Kolkata"],
  ["Asia/Bangkok", "Bangkok"],
  ["Asia/Jakarta", "Jakarta"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Hong_Kong", "Hong Kong"],
  ["Asia/Shanghai", "Shanghai"],
  ["Asia/Tokyo", "Tokyo"],
  ["Asia/Seoul", "Seoul"],
  ["Australia/Sydney", "Sydney"],
  ["Pacific/Auckland", "New Zealand"],
];

/** "(UTC+7)" for a zone at a moment. */
export function utcOffsetLabel(zone: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const offset = !part || part === "GMT" ? "" : part.replace("GMT", "");
  return `(UTC${offset})`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(zone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = zone + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...opts })));
  return f;
}

/** A bar's time for the crosshair label and legend. Daily and longer bars are dates, which a
 *  timezone doesn't move (as on TradingView); intraday bars read in the chosen zone. */
export function formatChartTime(timeSec: number, intraday: boolean, zone: string): string {
  const d = new Date(timeSec * 1000);
  if (!intraday) return fmt("UTC", { weekday: "short", day: "2-digit", month: "short", year: "2-digit" }).format(d);
  return fmt(zone, { weekday: "short", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** Time-axis tick labels: `kind` is lightweight-charts' TickMarkType (0 year, 1 month,
 *  2 day of month, 3 time, 4 time with seconds). */
export function formatTick(timeSec: number, kind: number, intraday: boolean, zone: string): string {
  const d = new Date(timeSec * 1000);
  const z = intraday ? zone : "UTC";
  switch (kind) {
    case 0:
      return fmt(z, { year: "numeric" }).format(d);
    case 1:
      return fmt(z, { month: "short" }).format(d);
    case 2:
      return fmt(z, { day: "numeric" }).format(d);
    case 4:
      return fmt(z, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
    default:
      return fmt(z, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  }
}
