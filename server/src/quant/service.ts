// The quant forecasts the Astro Calendar and the Live TV both read: every forecast market's chance
// of a rise over 5, 10 and 20 trading days as of the latest close, with its walk-forward record
// (and what the US data and the sky added to it), and its out-of-sample forecast for each past day
// (so a calendar event can show what was forecast the day before it, and how that turned out).
//
// Worked out in the background a few times a day (a minute or so) and kept on disk, so the app has
// the last one at once after a restart.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";
import { engineInputs } from "../providers/macroengine.js";
import { astroFeatures } from "./astrofeatures.js";
import { dailyCloses, MARKETS, type MarketKey } from "./data.js";
import { macroFeatures } from "./macrofeatures.js";
import { chooseLambda, dataset, fitLogistic, HORIZONS, predict, walkForward, type Horizon, type Score } from "./model.js";

export type Verdict = "Bullish" | "Bearish" | "Netral";

export type HorizonForecast = {
  /** The chance of a rise over the horizon, from the latest close. */
  pUp: number;
  /** How often the market rose over such a span in the training years. */
  baseRate: number;
  /** Bullish or bearish only when the record shows a signal (score.proven) and the chance leans. */
  verdict: Verdict;
  score: Score;
  /** The same test without the sky, and without the US data: what each group adds. */
  without: { astro: Score; macro: Score };
  /** The features pulling hardest now (log-odds, + toward a rise). */
  drivers: Array<{ name: string; group: string; pull: number }>;
  /** The span's usual move, % (bp for a yield): its 10th, 50th and 90th percentile over 3 years. */
  band: { p10: number; p50: number; p90: number };
};

export type AssetForecast = {
  key: MarketKey;
  label: string;
  symbol: string;
  group: string;
  unit: "%" | "bp";
  price: number;
  asOfDay: number;
  horizons: Record<Horizon, HorizonForecast>;
};

export type QuantResult = { at: number; asOfDay: number; assets: AssetForecast[]; history: Partial<Record<MarketKey, Record<Horizon, Array<[day: number, pUp: number]>>>> };

const dir = join(dataDir, "quant");
const file = join(dir, "forecast.json");
const REFRESH_MS = 6 * 3600_000;
/** How far back the out-of-sample forecasts are kept for the calendar. */
const HISTORY_FROM = Date.UTC(2018, 0, 1) / 86_400_000;

let result: QuantResult | null = null;
let running: Promise<QuantResult> | null = null;

function readResult(): QuantResult | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as QuantResult) : null;
  } catch {
    return null;
  }
}

const quantile = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0;
};

/** Works the forecasts out from the latest data. */
export async function computeForecasts(now = Date.now()): Promise<QuantResult> {
  const closes = await dailyCloses(3 * 3600_000, now);
  const allDays = MARKETS.flatMap((m) => closes[m.key].days);
  const from = Math.min(...allDays);
  const to = Math.max(...allDays);
  const releases = await engineInputs(now)
    .then((i) => i.releases)
    .catch(() => []);
  const macro = macroFeatures(releases, from, to);
  const astro = astroFeatures(from, to);

  const assets: AssetForecast[] = [];
  const history: QuantResult["history"] = {};
  for (const m of MARKETS.filter((x) => x.forecast)) {
    const ds = dataset(m.key, closes, macro, astro);
    if (ds.rows.length < 1000) continue;
    const last = ds.rows[ds.rows.length - 1];
    const horizons = {} as Record<Horizon, HorizonForecast>;
    const hist = {} as Record<Horizon, Array<[number, number]>>;
    for (const h of HORIZONS) {
      const all = await walkForward(ds, h, "all");
      const noAstro = await walkForward(ds, h, "noAstro");
      const noMacro = await walkForward(ds, h, "noMacro");
      // Today's forecast: fit on every row whose outcome is known.
      const known = ds.rows.filter((r) => r.i + h < ds.close.length);
      const y = known.map((r) => (ds.close[r.i + h] > ds.close[r.i] ? 1 : 0));
      const cols = ds.groups.map((_, j) => j);
      const X = known.map((r) => r.x);
      const fit = fitLogistic(X, y, cols, chooseLambda(X, y, cols, h));
      const { p, pulls } = predict(fit, last.x);
      const baseRate = y.reduce((a: number, b) => a + b, 0) / y.length;
      const lean = p - baseRate;
      const verdict: Verdict = all.score.proven ? (p >= 0.5 && lean >= 0.03 ? "Bullish" : p < 0.5 && lean <= -0.03 ? "Bearish" : "Netral") : "Netral";
      const drivers = pulls
        .map((pull, j) => ({ name: ds.names[j], group: ds.groups[j], pull }))
        .sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull))
        .slice(0, 5);
      // The span's usual move over the last three years (a yield's in basis points).
      const recent: number[] = [];
      for (let i = Math.max(0, ds.close.length - 750); i + h < ds.close.length; i++) {
        const a = ds.close[i];
        const b = ds.close[i + h];
        recent.push(m.unit === "bp" ? (b - a) * 100 : (b / a - 1) * 100);
      }
      horizons[h] = {
        pUp: p,
        baseRate,
        verdict,
        score: all.score,
        without: { astro: noAstro.score, macro: noMacro.score },
        drivers,
        band: { p10: quantile(recent, 0.1), p50: quantile(recent, 0.5), p90: quantile(recent, 0.9) },
      };
      hist[h] = ds.rows.flatMap((r, k) => (Number.isFinite(all.p[k]) && ds.days[r.i] >= HISTORY_FROM ? [[ds.days[r.i], Math.round(all.p[k] * 1000) / 1000] as [number, number]] : []));
    }
    assets.push({ key: m.key, label: m.label, symbol: m.symbol, group: m.group, unit: m.unit, price: ds.close[last.i], asOfDay: ds.days[last.i], horizons });
    history[m.key] = hist;
  }
  if (!assets.length) throw new Error("no market data for the quant forecasts");
  const out: QuantResult = { at: now, asOfDay: Math.max(...assets.map((a) => a.asOfDay)), assets, history };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}

/** The latest forecasts: the kept ones at once (worked out again in the background when old). */
export async function forecasts(now = Date.now()): Promise<QuantResult> {
  result ??= readResult();
  const stale = !result || now - result.at > REFRESH_MS;
  if (stale && !running) {
    running = computeForecasts(now)
      .then((r) => (result = r))
      .finally(() => (running = null));
  }
  if (result) return result;
  return running!;
}

/** Starts the forecasts on boot and keeps them fresh. */
export function startQuantForecasts(): void {
  const tick = () => void forecasts().catch(() => undefined);
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 30 * 60_000).unref();
}
