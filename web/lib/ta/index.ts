import type { Bars } from "./core";
import { averages } from "./indicators/averages";
import { bands } from "./indicators/bands";
import { oscillators } from "./indicators/oscillators";
import { community, volatility, volume } from "./indicators/volume";
import type { Category, ExternalData, IndicatorDef, IndicatorInstance, IndicatorResult, Params } from "./types";

export * from "./types";
export type { Bars } from "./core";

export const INDICATORS: IndicatorDef[] = [...averages, ...bands, ...oscillators, ...volume, ...volatility, ...community].sort(
  (a, b) => a.name.localeCompare(b.name)
);

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export const CATEGORIES: Category[] = [
  "Moving Averages",
  "Bands & Channels",
  "Trend",
  "Oscillators",
  "Momentum",
  "Volatility",
  "Volume",
  "Support & Resistance",
  "Community",
];

export function defaultParams(def: IndicatorDef): Params {
  return Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
}

let uidCounter = 0;

export function createInstance(id: string, params: Params = {}): IndicatorInstance {
  const def = INDICATOR_BY_ID.get(id);
  if (!def) throw new Error(`unknown indicator ${id}`);
  uidCounter += 1;
  return { uid: `${id}-${Date.now().toString(36)}-${uidCounter}`, id, params: { ...defaultParams(def), ...params } };
}

/** Params with defaults filled in, so instances saved before an input existed still work. */
export function resolveParams(def: IndicatorDef, inst: IndicatorInstance): Params {
  return { ...defaultParams(def), ...inst.params };
}

/** TradingView-style legend title, e.g. "RSI 14 close SMA 14". */
export function instanceLabel(def: IndicatorDef, params: Params): string {
  const shown: Array<string | number | boolean> = [];
  def.inputs.forEach((input, i) => {
    const v = params[input.key];
    if (input.type === "bool" || v === undefined || v === "None") return;
    // An MA type set to "None" also hides the length input that follows it.
    const prev = def.inputs[i - 1];
    if (prev?.type === "select" && params[prev.key] === "None") return;
    shown.push(v);
  });
  return [def.short, ...shown].join(" ");
}

export function candlesToBars(candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>): Bars {
  return {
    time: candles.map((c) => c.time),
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    volume: candles.map((c) => c.volume ?? 0),
    length: candles.length,
  };
}

export function runIndicator(def: IndicatorDef, bars: Bars, params: Params, ext?: ExternalData): IndicatorResult {
  return def.compute(bars, params, ext);
}
