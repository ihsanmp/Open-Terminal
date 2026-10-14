// Nowcasts of the next inflation and GDP prints against what the market expects:
//   - the Cleveland Fed's inflation nowcast (CPI, core CPI, PCE, core PCE, month-over-month and
//     year-over-year), updated each business day from oil and gasoline prices and the latest
//     prints; its files also keep every month back to 2013 with what was then released;
//   - the Atlanta Fed's GDPNow for the quarter (FRED: GDPNOW);
//   - the consensus forecast, the previous and the actual from TradingView's calendar.
// A nowcast above the consensus is a hotter print than expected (hawkish: rates up, the dollar
// up, gold, stocks and crypto down), below it a cooler one. The track record compares the
// nowcast's and the consensus's misses over the months both are known for.

import * as fred from "./fred.js";
import type { EconEvent } from "./econcalendar.js";

const CLEVELAND = "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting";

type ChartPoint = { value?: string | number | null };
type ChartSeries = { seriesname?: string; data?: ChartPoint[] };
type Chart = { chart?: { subcaption?: string; _comment?: string }; categories?: Array<{ category?: Array<{ label?: string }> }>; dataset?: Array<ChartSeries & { dataset?: ChartSeries[] }> };

/** Each target month's latest nowcast and, once out, the actual print, by series name. */
export type MonthNowcast = { month: string; asOf: string | null; nowcast: Record<string, number>; actual: Record<string, number> };

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

/** One of the Cleveland Fed's chart files as months ("2026-9" → "2026-09"). */
export function parseClevelandCharts(charts: Chart[]): MonthNowcast[] {
  const out: MonthNowcast[] = [];
  for (const c of charts) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(c.chart?.subcaption ?? "");
    if (!m) continue;
    const month = `${m[1]}-${m[2].padStart(2, "0")}`;
    const nowcast: Record<string, number> = {};
    const actual: Record<string, number> = {};
    const series = (c.dataset ?? []).flatMap((d) => d.dataset ?? [d]);
    for (const s of series) {
      const name = s.seriesname ?? "";
      const values = (s.data ?? []).map((p) => num(p.value)).filter((v): v is number => v !== null);
      if (!values.length) continue;
      if (name.startsWith("Actual ")) actual[name.slice(7)] = values.at(-1)!;
      else nowcast[name] = values.at(-1)!;
    }
    const comment = /(\d{4}-\d{2}-\d{2})/.exec(c.chart?._comment ?? "")?.[1] ?? null;
    out.push({ month, asOf: comment, nowcast, actual });
  }
  return out;
}

async function clevelandFile(kind: "month" | "year"): Promise<MonthNowcast[]> {
  const res = await fetch(`${CLEVELAND}/nowcast_${kind}.json`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`cleveland fed nowcast ${res.status}`);
  return parseClevelandCharts(JSON.parse((await res.text()).replace(/^﻿/, "")) as Chart[]);
}

/** The indicators compared: the Cleveland series, its kind, and TradingView's title for the print. */
const INDICATORS = [
  { key: "cpi_mom", label: "CPI MoM", series: "CPI Inflation", file: "month", title: "Inflation Rate MoM", hot: 0.05 },
  { key: "core_cpi_mom", label: "Core CPI MoM", series: "Core CPI Inflation", file: "month", title: "Core Inflation Rate MoM", hot: 0.05 },
  { key: "cpi_yoy", label: "CPI YoY", series: "CPI Inflation", file: "year", title: "Inflation Rate YoY", hot: 0.1 },
  { key: "core_cpi_yoy", label: "Core CPI YoY", series: "Core CPI Inflation", file: "year", title: "Core Inflation Rate YoY", hot: 0.1 },
  { key: "pce_mom", label: "PCE MoM", series: "PCE Inflation", file: "month", title: "PCE Price Index MoM", hot: 0.05 },
  { key: "core_pce_mom", label: "Core PCE MoM", series: "Core PCE Inflation", file: "month", title: "Core PCE Price Index MoM", hot: 0.05 },
  { key: "pce_yoy", label: "PCE YoY", series: "PCE Inflation", file: "year", title: "PCE Price Index YoY", hot: 0.1 },
  { key: "core_pce_yoy", label: "Core PCE YoY", series: "Core PCE Inflation", file: "year", title: "Core PCE Price Index YoY", hot: 0.1 },
] as const;

export type Bias = "hawkish" | "dovish" | "neutral";

export type NowcastRow = {
  key: string;
  label: string;
  /** The month measured ("2026-09"). */
  period: string;
  release: string | null;
  nowcast: number;
  consensus: number | null;
  previous: number | null;
  actual: number | null;
  diff: number | null;
  bias: Bias | null;
  /** Over the months both are known: the nowcast's and the consensus's average miss, and how often
   *  the nowcast told on which side of the consensus the print would land. */
  track: { months: number; nowcastMiss: number; consensusMiss: number; sideRight: number; sideCalls: number } | null;
};

export type GdpRow = { quarter: string; gdpNow: number; consensus: number | null; release: string | null; actual: number | null; diff: number | null };
export type Nowcast = { asOf: string | null; inflation: NowcastRow[]; gdp: GdpRow | null; source: string };

const reading = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && /\d/.test(v) ? n : null;
};

/** Hotter or cooler than expected, past a threshold. */
export function biasOf(diff: number | null, threshold: number): Bias | null {
  if (diff === null) return null;
  if (diff >= threshold) return "hawkish";
  if (diff <= -threshold) return "dovish";
  return "neutral";
}

/** The release that measures a month ("2026-09"), from TradingView's events (referenceDate 2026-09-30). */
const releaseFor = (events: EconEvent[], title: string, month: string) =>
  events.filter((e) => e.title === title && (e.referenceDate ?? "").startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))[0];

export function compare(months: { month: MonthNowcast[]; year: MonthNowcast[] }, events: EconEvent[]): NowcastRow[] {
  const rows: NowcastRow[] = [];
  for (const ind of INDICATORS) {
    const file = months[ind.file];
    // The month to call: the oldest of the last few whose print hasn't come out (September's CPI
    // while October's is being nowcast too).
    const pending = file
      .slice(-4)
      .find((m) => m.nowcast[ind.series] !== undefined && m.actual[ind.series] === undefined && !releaseFor(events, ind.title, m.month)?.actual);
    const target = pending ?? file.at(-1);
    if (!target || target.nowcast[ind.series] === undefined) continue;
    const ev = releaseFor(events, ind.title, target.month);
    const nowcast = target.nowcast[ind.series];
    const consensus = reading(ev?.forecast ?? null);
    const diff = consensus === null ? null : Math.round((nowcast - consensus) * 1000) / 1000;

    // The track record: months with a released print, a consensus and a nowcast.
    let n = 0;
    let nowMiss = 0;
    let conMiss = 0;
    let right = 0;
    let calls = 0;
    for (const m of file) {
      const past = releaseFor(events, ind.title, m.month);
      const act = reading(past?.actual ?? null) ?? m.actual[ind.series] ?? null;
      const con = reading(past?.forecast ?? null);
      const nc = m.nowcast[ind.series];
      if (act === null || con === null || nc === undefined || m.month === target.month) continue;
      n++;
      nowMiss += Math.abs(nc - act);
      conMiss += Math.abs(con - act);
      // A call: the nowcast clearly off the consensus; right when the print lands the same side.
      if (Math.abs(nc - con) >= ind.hot && act !== con) {
        calls++;
        if (Math.sign(nc - con) === Math.sign(act - con)) right++;
      }
    }
    rows.push({
      key: ind.key,
      label: ind.label,
      period: target.month,
      release: ev?.date ?? null,
      nowcast: Math.round(nowcast * 1000) / 1000,
      consensus,
      previous: reading(ev?.previous ?? null),
      actual: reading(ev?.actual ?? null),
      diff,
      bias: biasOf(diff, ind.hot),
      track: n ? { months: n, nowcastMiss: nowMiss / n, consensusMiss: conMiss / n, sideRight: right, sideCalls: calls } : null,
    });
  }
  return rows;
}

/** GDPNow for the latest quarter, against the advance estimate's consensus. */
export function gdpRow(points: fred.SeriesPoint[], events: EconEvent[]): GdpRow | null {
  const last = points.at(-1);
  if (!last) return null;
  // FRED dates the quarter by its first day; the release's referenceDate is its last.
  const y = Number(last.date.slice(0, 4));
  const q = Math.floor((Number(last.date.slice(5, 7)) - 1) / 3);
  const endMonth = `${y}-${String(q * 3 + 3).padStart(2, "0")}`;
  const ev = events.filter((e) => e.title === "GDP Growth Rate QoQ Adv" && (e.referenceDate ?? "").startsWith(endMonth))[0];
  const consensus = reading(ev?.forecast ?? null);
  return {
    quarter: `${y} Q${q + 1}`,
    gdpNow: last.value,
    consensus,
    release: ev?.date ?? null,
    actual: reading(ev?.actual ?? null),
    diff: consensus === null ? null : Math.round((last.value - consensus) * 100) / 100,
  };
}

export async function nowcast(events: EconEvent[]): Promise<Nowcast> {
  const [month, year, gdp] = await Promise.all([clevelandFile("month"), clevelandFile("year"), fred.series("GDPNOW", 12).catch(() => [])]);
  return {
    asOf: month.at(-1)?.asOf ?? null,
    inflation: compare({ month, year }, events),
    gdp: gdpRow(gdp, events),
    source: "Cleveland Fed Inflation Nowcasting; Atlanta Fed GDPNow (FRED); consensus from TradingView's economic calendar",
  };
}
