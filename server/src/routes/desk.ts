import { Router } from "express";
import { cached } from "../cache.js";
import * as cot from "../providers/cot.js";
import * as curves from "../providers/curves.js";
import * as econcalendar from "../providers/econcalendar.js";
import * as etfboard from "../providers/etfboard.js";
import * as fiscal from "../providers/fiscal.js";
import * as geopolitics from "../providers/geopolitics.js";
import * as regime from "../providers/regime.js";
import * as tradingview from "../providers/tradingview.js";
import * as watcherguru from "../providers/watcherguru.js";

// The desk's tools grouped in the menu (Macro Command Center, Policy & Expectations, Flow &
// Participants, Intelligence & Risk): the macro regime, forward curves, fiscal data, futures
// positioning, ETFs and breadth, geopolitics, and the dashboard that sums them up.

export const deskRouter = Router();

const send =
  <T>(f: (req: import("express").Request) => Promise<T>) =>
  async (req: import("express").Request, res: import("express").Response) => {
    try {
      res.json(await f(req));
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };

deskRouter.get("/regime", send(() => regime.regime()));
deskRouter.get("/curves", send(() => curves.allCurves()));
deskRouter.get("/curves/:id", send((req) => curves.curve(String(req.params.id))));
deskRouter.get("/cot", send(() => cot.cotBoard()));
deskRouter.get("/fiscal", send(() => fiscal.fiscal()));
deskRouter.get("/etf", send(() => etfboard.etfBoard()));
deskRouter.get("/breadth", send(() => etfboard.breadth()));
deskRouter.get("/crypto-etf-flows", send(() => etfboard.cryptoEtfFlows()));
deskRouter.get("/geopolitics", send(() => geopolitics.geopolitics()));

/** A part of the dashboard, or null if it fails or takes longer than `ms` (the rest still shows). */
async function part<T>(f: () => Promise<T>, ms = 12_000): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([f(), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const KEY_MARKETS: Array<{ label: string; tv: string; symbol: string; digits: number }> = [
  { label: "S&P 500", tv: "SP:SPX", symbol: "^GSPC", digits: 2 },
  { label: "Nasdaq 100", tv: "NASDAQ:NDX", symbol: "^NDX", digits: 2 },
  { label: "Russell 2000", tv: "TVC:RUT", symbol: "^RUT", digits: 2 },
  { label: "VIX", tv: "TVC:VIX", symbol: "^VIX", digits: 2 },
  { label: "Yield AS 10Y", tv: "TVC:US10Y", symbol: "US10Y", digits: 3 },
  { label: "Yield AS 2Y", tv: "TVC:US02Y", symbol: "US02Y", digits: 3 },
  { label: "Dolar (DXY)", tv: "TVC:DXY", symbol: "DX-Y.NYB", digits: 2 },
  { label: "EUR/USD", tv: "FX:EURUSD", symbol: "EURUSD", digits: 4 },
  { label: "USD/JPY", tv: "FX:USDJPY", symbol: "USDJPY", digits: 3 },
  { label: "USD/IDR", tv: "FX_IDC:USDIDR", symbol: "USDIDR", digits: 0 },
  { label: "Emas", tv: "OANDA:XAUUSD", symbol: "XAUUSD", digits: 2 },
  { label: "Minyak WTI", tv: "NYMEX:CL1!", symbol: "CL=F", digits: 2 },
  { label: "Tembaga", tv: "COMEX:HG1!", symbol: "HG=F", digits: 3 },
  { label: "Bitcoin", tv: "BITSTAMP:BTCUSD", symbol: "BTC-USD", digits: 0 },
  { label: "Ethereum", tv: "BITSTAMP:ETHUSD", symbol: "ETH-USD", digits: 2 },
  { label: "IHSG", tv: "IDX:COMPOSITE", symbol: "^JKSE", digits: 2 },
];

deskRouter.get(
  "/dashboard",
  send(() =>
    cached("desk:dashboard", 20_000, async () => {
      const now = Date.now();
      const [quotes, reg, br, events, flashes, positioning, curveList, geo] = await Promise.all([
        part(() => tradingview.batchQuotes(KEY_MARKETS.map((m) => m.tv), (s) => [s])),
        part(() => regime.regime(), 25_000),
        part(() => etfboard.breadth()),
        part(() => econcalendar.rangeEvents(new Date(now - 6 * 3_600_000), new Date(now + 3 * 86_400_000))),
        part(() => watcherguru.flashes()),
        part(() => cot.cotBoard(), 25_000),
        part(() => curves.allCurves()),
        part(() => geopolitics.geopolitics()),
      ]);
      return {
        markets: KEY_MARKETS.map((m) => {
          const q = quotes?.get(m.tv);
          return { label: m.label, symbol: m.symbol, digits: m.digits, price: q?.price ?? null, day: q?.changePercent ?? null, week: q?.changeWeek ?? null, month: q?.changeMonth ?? null };
        }),
        regime: reg && {
          quadrant: reg.current.quadrant,
          label: regime.QUADRANTS[reg.current.quadrant].label,
          note: regime.QUADRANTS[reg.current.quadrant].note,
          growth: reg.current.growth,
          inflation: reg.current.inflation,
          streak: reg.streak,
          previous: reg.previous?.quadrant ?? null,
          risk: { label: reg.risk.label, notes: reg.risk.notes },
          long: reg.shortlist.long.slice(0, 6),
          avoid: reg.shortlist.avoid.slice(0, 6),
        },
        breadth: br && { above50: br.above50, above200: br.above200, advancing: br.advancing, declining: br.declining, nearHigh: br.nearHigh, nearLow: br.nearLow, read: br.read },
        events: (events ?? [])
          .filter((e) => e.impact === "High")
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 14)
          .map((e) => ({ title: e.title, country: e.country, date: e.date, forecast: e.forecast, previous: e.previous, actual: e.actual })),
        flashes: flashes?.posts.slice(0, 8).map((p) => ({ id: p.id, text: p.text, time: p.time, url: p.url })) ?? [],
        crowded: (positioning ?? [])
          .filter((s) => s.crowding)
          .map((s) => ({ id: s.id, label: s.label, crowding: s.crowding, cotIndex: s.cotIndex, specName: s.names.spec }))
          .slice(0, 8),
        curves: (curveList ?? [])
          .filter((c) => ["vx", "cl", "gc", "sr3", "zq"].includes(c.id))
          .map((c) => ({ id: c.id, label: c.label, kind: c.kind, shape: c.shape, spread: c.spread, moves25: c.moves25, front: c.points[0]?.value ?? null })),
        geo: geo?.themes.filter((t) => t.week > 0).slice(0, 4).map((t) => ({ id: t.id, label: t.label, week: t.week, heat: t.heat, tone: t.tone, top: t.latest[0]?.title ?? null })) ?? [],
        asOf: now,
      };
    }),
  ),
);

/** For the tests: the markets the dashboard quotes. */
export const DASHBOARD_MARKETS = KEY_MARKETS;
