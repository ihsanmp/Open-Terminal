// Every indicator with every input changed one at a time — ints and floats to their bounds,
// each bool flipped, each select option — must compute without throwing and with well-formed
// output: plots and per-bar colors as long as the chart, offsets whole, drawings at finite places,
// no NaN / undefined text in labels and tables.
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/tradingview-daily.json";
import { INDICATORS, candlesToBars, defaultParams, type IndicatorDef, type Params } from "../index";
import type { ChartContext, IndicatorResult, InputDef } from "../types";

type Row = { time: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
const aapl = (fixture.symbols as Record<string, Row>).AAPL;
const jpm = (fixture.symbols as Record<string, Row>).JPM;
const bars = candlesToBars(aapl.time.map((time, i) => ({ time, open: aapl.open[i], high: aapl.high[i], low: aapl.low[i], close: aapl.close[i], volume: aapl.volume[i] })));
const other = jpm.time.map((time, i) => ({ time, open: jpm.open[i], high: jpm.high[i], low: jpm.low[i], close: jpm.close[i], volume: jpm.volume[i] }));
const chart: ChartContext = { symbol: "AAPL", ticker: "AAPL", type: "stock", timezone: "America/New_York", intervalSeconds: 86_400, range: "5Y" };

/** Plausible responses for the indicators that fetch (other symbols, on-chain data, filings). */
function fetched(def: IndicatorDef, p: Params): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of def.fetches?.(p, chart) ?? []) {
    if (path.startsWith("/api/history/")) out[path] = other;
    else if (path.startsWith("/api/tv/bars")) {
      const syms = (new URL(path, "http://x").searchParams.get("symbols") ?? "").split(",");
      out[path] = Object.fromEntries(syms.map((s) => [s, other]));
    } else if (path.startsWith("/api/insider/"))
      out[path] = [{ transactionDate: new Date(bars.time[bars.length - 5] * 1000).toISOString().slice(0, 10), ownerName: "Owner", isTenPercentOwner: true, transactionCode: "P", shares: 1e4, value: 5e6 }];
    else out[path] = null;
  }
  return out;
}

function variants(input: InputDef): unknown[] {
  switch (input.type) {
    case "int":
    case "float": {
      const lo = input.min ?? (input.type === "int" ? 1 : 0);
      // Lookbacks up to the chart's length; beyond that is the same as the chart's length.
      const hi = Math.min(input.max ?? 1000, 1000);
      return [...new Set([lo, hi, input.default * 2])].filter((v) => v !== input.default && v >= lo && v <= hi);
    }
    case "bool":
      return [!input.default];
    case "select":
      return input.options.filter((o) => o !== input.default);
    case "source":
      return input.default === "open" ? ["hl2"] : ["open"];
    default:
      return [];
  }
}

function problems(def: IndicatorDef, r: IndicatorResult): string[] {
  const len = bars.length;
  const out: string[] = [];
  const fin = Number.isFinite;
  for (const [k, v] of Object.entries(r.plots)) if (v.length !== len) out.push(`plot ${k} has ${v.length} values`);
  for (const [k, o] of Object.entries(r.offsets ?? {})) if (!Number.isInteger(o)) out.push(`offset ${k} = ${o}`);
  for (const [k, c] of Object.entries(r.colors ?? {})) if (c.length !== len) out.push(`colors ${k} has ${c.length}`);
  if (r.barColors && r.barColors.length !== len) out.push("barColors length");
  if (r.bgColors && r.bgColors.length !== len) out.push("bgColors length");
  for (const m of r.markers ?? []) if (!Number.isInteger(m.index) || m.index < 0 || m.index >= len) out.push(`marker at ${m.index}`);
  for (const l of r.labels ?? []) if (!Number.isInteger(l.index) || !fin(l.price) || /NaN|undefined/.test(l.text)) out.push(`label ${l.index} ${l.price} "${l.text}"`);
  for (const l of r.lines ?? []) if (![l.x1, l.x2, l.y1, l.y2].every(fin)) out.push("line at a non-finite point");
  for (const b of r.boxes ?? []) if (![b.x1, b.x2, b.top, b.bottom].every(fin)) out.push("box at a non-finite point");
  for (const f of r.fills ?? []) for (const side of [f.a, f.b]) if (typeof side === "string" && !(side in r.plots)) out.push(`fill of missing plot ${side}`);
  for (const c of r.table?.cells ?? []) if (/NaN|undefined/.test(c.text)) out.push(`table text "${c.text}"`);
  return out;
}

describe("every input of every indicator", () => {
  it.each(INDICATORS.map((d) => [d.id, d] as const))("%s", (_id, def) => {
    const base = defaultParams(def);
    const found: string[] = [];
    const run = (p: Params, what: string) => {
      try {
        for (const issue of problems(def, def.compute(bars, p, { chart, fetched: fetched(def, p) }))) found.push(`${what}: ${issue}`);
      } catch (e) {
        found.push(`${what}: throws ${(e as Error).message}`);
      }
    };
    run(base, "defaults");
    for (const input of def.inputs) for (const v of variants(input)) run({ ...base, [input.key]: v } as Params, `${input.key}=${String(v)}`);
    expect(found.slice(0, 5)).toEqual([]);
  });
});
