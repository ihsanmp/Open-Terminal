"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { apiGet, fmt, fmtBig, fmtPrice, pctClass } from "../../lib/api";
import { discountedCashFlow } from "../../lib/dcf";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

type N = number | null;
type Check = { name: string; passed: boolean | null; detail: string };
type StatementRow = { key: string; label: string; perShare: boolean; values: N[] };
type YearRatios = {
  date: string; grossMargin: N; operatingMargin: N; netMargin: N; fcfMargin: N; roe: N; roa: N; assetTurnover: N;
  equityMultiplier: N; currentRatio: N; quickRatio: N; debtToEquity: N; interestCoverage: N; revenueGrowth: N;
  netIncomeGrowth: N; epsGrowth: N;
};

type Research = {
  symbol: string; name: string; price: N; currency: string | null; statementCurrency: string | null; stmtToTrading: N;
  profile: { tvTicker: string; exchange: string; sector: string; industry: string; country: string; employees: N } | null;
  ttm: Record<string, N> | null;
  analysts: {
    strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; total: number; score: N;
    consensus: string | null; targetLow: N; targetAverage: N; targetHigh: N;
  } | null;
  statements: { years: string[]; income: StatementRow[]; balance: StatementRow[]; cashflow: StatementRow[] };
  ratios: YearRatios[];
  scores: {
    piotroski: { score: number; evaluated: number; checks: Check[] } | null;
    altman: { z: number; zone: "safe" | "grey" | "distress"; parts: Record<string, number> } | { z: null; missing: string[] } | null;
    beneish: { m: number; likelyManipulator: boolean; parts: Record<string, number> } | { m: null; missing: string[] } | null;
    graham: { value: number; eps: N; bookValuePerShare: N } | null;
  };
  dcf: {
    freeCashFlow: N; netDebt: number; shares: N; growth: number; discountRate: number; terminalGrowth: number; years: number;
    riskFree: number; beta: number; equityRiskPremium: number; revenueCagr: N;
  } | null;
  warnings: string[];
};

type Peer = {
  ticker: string; symbol: string; name: string; currency: string | null; price: N; marketCapUsd: N; pe: N; pb: N;
  evEbitda: N; netMargin: N; roe: N; revenueGrowth: N; dividendYield: N;
};

const TABS = ["Overview", "Financials", "Ratios", "Valuation", "Analysts", "Peers"] as const;
type Tab = (typeof TABS)[number];

const pct = (x: N | undefined, digits = 1) => {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  const v = Number((x * 100).toFixed(digits));
  return `${fmt(v === 0 ? 0 : v, digits)}%`; // avoid "-0.0%"
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const pctPts = (x: N | undefined, digits = 1) => (x === null || x === undefined || !isFinite(x) ? "—" : `${fmt(x, digits)}%`);
const times = (x: N | undefined) => (x === null || x === undefined || !isFinite(x) ? "—" : `${fmt(x, 2)}×`);
const upside = (target: N | undefined, price: N) =>
  target === null || target === undefined || price === null || price === 0 ? null : target / price - 1;

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between border-b border-[#161616] py-0.5 gap-2">
      <span className="dim whitespace-nowrap">{label}</span>
      <span className={`whitespace-nowrap ${className}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="amber text-[10px] uppercase tracking-wider mb-1">{title}</div>
      {children}
    </div>
  );
}

function ScoreBadge({ label, value, tone, hint }: { label: string; value: string; tone: "up" | "down" | "amber" | "dim"; hint: string }) {
  return (
    <div className="border border-[var(--border)] px-2 py-1 min-w-[110px]" title={hint}>
      <div className="dim text-[10px] uppercase">{label}</div>
      <div className={`${tone} font-bold text-[13px]`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- tabs ---

function Overview({ r }: { r: Research }) {
  const t = r.ttm ?? {};
  const p = r.scores.piotroski;
  const a = r.scores.altman;
  const b = r.scores.beneish;
  const g = r.scores.graham;
  const targetUp = upside(r.analysts?.targetAverage, r.price);
  const grahamUp = upside(g?.value, r.price);
  const cur = r.currency ?? "";
  return (
    <div className="p-2">
      <div className="flex flex-wrap gap-2 mb-3">
        {r.analysts && (
          <ScoreBadge
            label="Analysts"
            value={`${r.analysts.consensus ?? "—"}${targetUp !== null ? ` · ${targetUp >= 0 ? "+" : ""}${pct(targetUp, 0)}` : ""}`}
            tone={r.analysts.score !== null && r.analysts.score <= 2.5 ? "up" : r.analysts.score !== null && r.analysts.score > 3.5 ? "down" : "amber"}
            hint={`${r.analysts.total} analysts; upside to the average price target`}
          />
        )}
        {p && (
          <ScoreBadge
            label="Piotroski F"
            value={`${p.score} / ${p.evaluated}`}
            tone={p.score >= 7 ? "up" : p.score <= 3 ? "down" : "amber"}
            hint="Financial strength, 9 binary tests (8–9 strong, 0–2 weak)"
          />
        )}
        {a && (
          <ScoreBadge
            label="Altman Z"
            value={a.z !== null ? `${fmt(a.z, 2)} ${a.zone}` : "n/a"}
            tone={a.z === null ? "dim" : a.zone === "safe" ? "up" : a.zone === "distress" ? "down" : "amber"}
            hint="Bankruptcy risk: above 2.99 safe, below 1.81 distress"
          />
        )}
        {b && (
          <ScoreBadge
            label="Beneish M"
            value={b.m !== null ? `${fmt(b.m, 2)} ${b.likelyManipulator ? "flag" : "ok"}` : "n/a"}
            tone={b.m === null ? "dim" : b.likelyManipulator ? "down" : "up"}
            hint="Earnings-manipulation screen: above −1.78 flags a likely manipulator"
          />
        )}
        {g && (
          <ScoreBadge
            label="Graham No."
            value={`${fmtPrice(g.value)}${grahamUp !== null ? ` · ${grahamUp >= 0 ? "+" : ""}${pct(grahamUp, 0)}` : ""}`}
            tone={grahamUp === null ? "dim" : grahamUp >= 0 ? "up" : "down"}
            hint="√(22.5 × EPS × book value per share), vs the current price"
          />
        )}
      </div>

      {r.profile && (
        <div className="dim mb-2">
          {[r.profile.sector, r.profile.industry, r.profile.country, r.profile.exchange].filter(Boolean).join(" · ")}
          {r.profile.employees ? ` · ${r.profile.employees.toLocaleString("en-US")} employees` : ""}
        </div>
      )}

      {r.ttm && (
        <div className="grid grid-cols-2 gap-x-4">
          <Section title="Valuation (TTM)">
            <Stat label="Market cap" value={`${fmtBig(t.marketCap)} ${cur}`} />
            <Stat label="Enterprise value" value={`${fmtBig(t.enterpriseValue)} ${cur}`} />
            <Stat label="P/E" value={times(t.pe)} />
            <Stat label="P/B" value={times(t.pb)} />
            <Stat label="P/S" value={times(t.ps)} />
            <Stat label="EV/EBITDA" value={times(t.evEbitda)} />
            <Stat label="Dividend yield" value={pctPts(t.dividendYield, 2)} />
            <Stat label="Payout ratio" value={pctPts(t.payoutRatio)} />
          </Section>
          <Section title="Profitability & growth (TTM)">
            <Stat label="Gross margin" value={pctPts(t.grossMargin)} />
            <Stat label="Operating margin" value={pctPts(t.operatingMargin)} />
            <Stat label="Net margin" value={pctPts(t.netMargin)} />
            <Stat label="ROE / ROA" value={`${pctPts(t.roe)} / ${pctPts(t.roa)}`} />
            <Stat label="ROIC" value={pctPts(t.roic)} />
            <Stat label="Revenue growth" value={pctPts(t.revenueGrowth)} className={pctClass(t.revenueGrowth)} />
            <Stat label="EPS growth" value={pctPts(t.epsGrowth)} className={pctClass(t.epsGrowth)} />
            <Stat label="Beta (1Y)" value={fmt(t.beta)} />
          </Section>
        </div>
      )}
      {r.warnings.map((w) => (
        <div key={w} className="amber text-[11px] mt-1">⚠ {w}</div>
      ))}
    </div>
  );
}

function Financials({ r }: { r: Research }) {
  const [which, setWhich] = useState<"income" | "balance" | "cashflow">("income");
  const rows = r.statements[which];
  const years = r.statements.years;
  if (years.length === 0) return <div className="p-2 dim">No annual statements available for {r.symbol}.</div>;
  return (
    <div className="p-1">
      <div className="flex gap-1 mb-1 items-center">
        {(["income", "balance", "cashflow"] as const).map((k) => (
          <button key={k} className={`term-btn ${which === k ? "active" : ""}`} onClick={() => setWhich(k)}>
            {k === "income" ? "INCOME" : k === "balance" ? "BALANCE SHEET" : "CASH FLOW"}
          </button>
        ))}
        <span className="dim ml-auto text-[10px]">{r.statementCurrency} · fiscal years</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            {years.map((y) => <th key={y}>FY{y.slice(0, 4)}</th>)}
            <th>YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const last = row.values[row.values.length - 1];
            const prev = row.values[row.values.length - 2];
            const yoy = last !== null && prev !== null && prev !== 0 ? (last - prev) / Math.abs(prev) : null;
            return (
              <tr key={row.key} className="pointer-events-none">
                <td>{row.label}</td>
                {row.values.map((v, i) => (
                  <td key={i} className={v !== null && v < 0 ? "down" : ""}>{row.perShare ? fmt(v) : fmtBig(v)}</td>
                ))}
                <td className={pctClass(yoy)}>{pct(yoy)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const RATIO_ROWS: Array<{ group: string; key: keyof YearRatios; label: string; kind: "pct" | "x" }> = [
  { group: "Margins", key: "grossMargin", label: "Gross margin", kind: "pct" },
  { group: "Margins", key: "operatingMargin", label: "Operating margin", kind: "pct" },
  { group: "Margins", key: "netMargin", label: "Net margin", kind: "pct" },
  { group: "Margins", key: "fcfMargin", label: "FCF margin", kind: "pct" },
  { group: "Returns & DuPont", key: "roe", label: "Return on equity", kind: "pct" },
  { group: "Returns & DuPont", key: "roa", label: "Return on assets", kind: "pct" },
  { group: "Returns & DuPont", key: "assetTurnover", label: "Asset turnover", kind: "x" },
  { group: "Returns & DuPont", key: "equityMultiplier", label: "Equity multiplier", kind: "x" },
  { group: "Liquidity & leverage", key: "currentRatio", label: "Current ratio", kind: "x" },
  { group: "Liquidity & leverage", key: "quickRatio", label: "Quick ratio", kind: "x" },
  { group: "Liquidity & leverage", key: "debtToEquity", label: "Debt / equity", kind: "x" },
  { group: "Liquidity & leverage", key: "interestCoverage", label: "Interest coverage", kind: "x" },
  { group: "Growth", key: "revenueGrowth", label: "Revenue growth", kind: "pct" },
  { group: "Growth", key: "netIncomeGrowth", label: "Net income growth", kind: "pct" },
  { group: "Growth", key: "epsGrowth", label: "EPS growth", kind: "pct" },
];

function Ratios({ r }: { r: Research }) {
  if (r.ratios.length === 0) return <div className="p-2 dim">No annual statements available for {r.symbol}.</div>;
  let lastGroup = "";
  return (
    <div className="p-1">
      <div className="dim text-[10px] px-1 mb-1">DuPont: ROE = net margin × asset turnover × equity multiplier (average balances).</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Ratio</th>
            {r.ratios.map((y) => <th key={y.date}>FY{y.date.slice(0, 4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {RATIO_ROWS.flatMap((row) => {
            const out = [];
            if (row.group !== lastGroup) {
              lastGroup = row.group;
              out.push(
                <tr key={row.group} className="pointer-events-none">
                  <td colSpan={r.ratios.length + 1} className="!text-left amber text-[10px] uppercase tracking-wider pt-2">{row.group}</td>
                </tr>
              );
            }
            if (r.ratios.some((y) => y[row.key] !== null)) {
              out.push(
                <tr key={row.key} className="pointer-events-none">
                  <td>{row.label}</td>
                  {r.ratios.map((y) => {
                    const v = y[row.key] as N;
                    return <td key={y.date} className={row.group === "Growth" ? pctClass(v) : ""}>{row.kind === "pct" ? pct(v) : times(v)}</td>;
                  })}
                </tr>
              );
            }
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="dim">{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" className="w-20 !py-0" step={suffix === "%" ? 0.1 : 1} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="dim w-3">{suffix}</span>
      </span>
    </label>
  );
}

function Valuation({ r }: { r: Research }) {
  const d = r.dcf;
  const [inputs, setInputs] = useState({ growth: 0, discountRate: 0, terminalGrowth: 0, years: 5 });
  useEffect(() => {
    if (d) setInputs({ growth: round2(d.growth * 100), discountRate: round2(d.discountRate * 100), terminalGrowth: round2(d.terminalGrowth * 100), years: d.years });
  }, [d]);

  const result = useMemo(
    () =>
      d && d.freeCashFlow !== null && d.shares
        ? discountedCashFlow({
            freeCashFlow: d.freeCashFlow, netDebt: d.netDebt, shares: d.shares, years: inputs.years,
            growth: inputs.growth / 100, discountRate: inputs.discountRate / 100, terminalGrowth: inputs.terminalGrowth / 100,
          })
        : null,
    [d, inputs]
  );
  const intrinsic = result && r.stmtToTrading ? result.perShare * r.stmtToTrading : null;
  const up = upside(intrinsic, r.price);
  const p = r.scores.piotroski;
  const a = r.scores.altman;
  const b = r.scores.beneish;

  return (
    <div className="p-2 grid grid-cols-2 gap-x-4">
      <div>
        <Section title="Discounted cash flow">
          {!d || d.freeCashFlow === null ? (
            <div className="dim">Free cash flow is not reported, so a DCF can't be built.</div>
          ) : (
            <>
              <Stat label={`Base free cash flow (${r.statementCurrency})`} value={fmtBig(d.freeCashFlow)} className={d.freeCashFlow < 0 ? "down" : ""} />
              <Stat label="Net debt" value={fmtBig(d.netDebt)} />
              <NumberField label="FCF growth, years 1–N" value={inputs.growth} suffix="%" onChange={(v) => setInputs((s) => ({ ...s, growth: v }))} />
              <NumberField label="Projection years" value={inputs.years} onChange={(v) => setInputs((s) => ({ ...s, years: Math.max(1, Math.min(20, Math.round(v))) }))} />
              <NumberField label="Discount rate" value={inputs.discountRate} suffix="%" onChange={(v) => setInputs((s) => ({ ...s, discountRate: v }))} />
              <NumberField label="Terminal growth" value={inputs.terminalGrowth} suffix="%" onChange={(v) => setInputs((s) => ({ ...s, terminalGrowth: v }))} />
              <div className="dim text-[10px] my-1">
                Defaults: growth = revenue CAGR {pct(d.revenueCagr)} (capped −5…25%); discount = CAPM {pct(d.riskFree)} + β {fmt(d.beta)} × {pct(d.equityRiskPremium)} ERP.
              </div>
              {result ? (
                <>
                  <Stat label="PV of projected FCF" value={fmtBig(result.presentValueOfFlows)} />
                  <Stat label="PV of terminal value" value={`${fmtBig(result.presentValueOfTerminal)} (${pct(result.presentValueOfTerminal / result.enterpriseValue, 0)} of EV)`} />
                  <Stat label="Equity value" value={fmtBig(result.equityValue)} />
                  <Stat label={`Intrinsic value / share (${r.currency})`} value={fmtPrice(intrinsic)} className="font-bold" />
                  <Stat label="vs price" value={up === null ? "—" : `${up >= 0 ? "+" : ""}${pct(up)}`} className={pctClass(up)} />
                </>
              ) : (
                <div className="down">Discount rate must exceed terminal growth.</div>
              )}
            </>
          )}
        </Section>
        {r.scores.graham && (
          <Section title="Graham number">
            <Stat label="EPS (diluted, FY)" value={fmt(r.scores.graham.eps)} />
            <Stat label="Book value / share" value={fmt(r.scores.graham.bookValuePerShare)} />
            <Stat label={`Graham number (${r.currency})`} value={fmtPrice(r.scores.graham.value)} />
          </Section>
        )}
      </div>
      <div>
        <Section title={`Piotroski F-score ${p ? `— ${p.score}/${p.evaluated}` : ""}`}>
          {p ? (
            p.checks.map((c) => (
              <div key={c.name} className="flex gap-2 py-0.5 border-b border-[#161616]">
                <span className={c.passed === null ? "dim" : c.passed ? "up" : "down"}>{c.passed === null ? "○" : c.passed ? "✓" : "✗"}</span>
                <span className="flex-1">{c.name}</span>
                <span className="dim">{c.passed === null ? "n/a" : c.detail}</span>
              </div>
            ))
          ) : (
            <div className="dim">Needs two fiscal years of statements.</div>
          )}
        </Section>
        <Section title={`Altman Z-score ${a && a.z !== null ? `— ${fmt(a.z, 2)} (${a.zone})` : ""}`}>
          {!a ? <div className="dim">No statements.</div> : a.z === null ? (
            <div className="dim">Missing: {a.missing.join(", ")}</div>
          ) : (
            Object.entries(a.parts).map(([k, v]) => <Stat key={k} label={k} value={fmt(v, 3)} />)
          )}
        </Section>
        <Section title={`Beneish M-score ${b && b.m !== null ? `— ${fmt(b.m, 2)}` : ""}`}>
          {!b ? <div className="dim">Needs two fiscal years of statements.</div> : b.m === null ? (
            <div className="dim">Missing: {b.missing.join(", ")}</div>
          ) : (
            <>
              <div className={`mb-1 ${b.likelyManipulator ? "down" : "up"}`}>
                {b.likelyManipulator ? "Above −1.78: pattern consistent with earnings manipulation" : "Below −1.78: unlikely manipulator"}
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                {Object.entries(b.parts).map(([k, v]) => <Stat key={k} label={k} value={fmt(v, 3)} />)}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function Analysts({ r }: { r: Research }) {
  const a = r.analysts;
  if (!a) return <div className="p-2 dim">No analyst coverage for {r.symbol}.</div>;
  const buckets = [
    ["Strong buy", a.strongBuy, "#00c853"],
    ["Buy", a.buy, "#69f0ae"],
    ["Hold", a.hold, "#ffab00"],
    ["Sell", a.sell, "#ff8a65"],
    ["Strong sell", a.strongSell, "#ff3d3d"],
  ] as const;
  const max = Math.max(...buckets.map((x) => x[1]), 1);
  const lo = a.targetLow;
  const hi = a.targetHigh;
  const span = lo !== null && hi !== null ? Math.max(hi, r.price ?? hi) - Math.min(lo, r.price ?? lo) : null;
  const base = lo !== null ? Math.min(lo, r.price ?? lo) : 0;
  const pos = (x: N) => (x === null || !span ? null : ((x - base) / span) * 100);
  return (
    <div className="p-2">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-xl font-bold">{a.consensus ?? "—"}</span>
        <span className="dim">score {fmt(a.score, 2)} (1 strong buy … 5 strong sell) · {a.total} analysts</span>
      </div>
      <Section title="Recommendations">
        {buckets.map(([label, count, color]) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            <span className="dim w-24 whitespace-nowrap">{label}</span>
            <div className="flex-1 h-3 bg-[#161616]">
              <div className="h-3" style={{ width: `${(count / max) * 100}%`, background: color }} />
            </div>
            <span className="w-6 text-right">{count}</span>
          </div>
        ))}
      </Section>
      <Section title={`12-month price target (${r.currency})`}>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <Stat label="Low" value={fmtPrice(lo)} />
          <Stat label="Average" value={fmtPrice(a.targetAverage)} />
          <Stat label="High" value={fmtPrice(hi)} />
          <Stat label="Upside" value={pct(upside(a.targetAverage, r.price))} className={pctClass(upside(a.targetAverage, r.price))} />
        </div>
        {span ? (
          <div className="relative h-8 mx-2">
            <div className="absolute top-3.5 left-0 right-0 h-1 bg-[#262626]" />
            <div className="absolute top-3.5 h-1 bg-[var(--amber-dim)]" style={{ left: `${pos(lo)}%`, width: `${(pos(hi) ?? 0) - (pos(lo) ?? 0)}%` }} />
            <div className="absolute top-1.5 w-0.5 h-5 bg-[var(--amber)]" style={{ left: `${pos(a.targetAverage)}%` }} title="Average target" />
            {r.price !== null && (
              <div className="absolute top-0 -translate-x-1/2 text-[10px]" style={{ left: `${pos(r.price)}%` }} title="Current price">
                ▼<div className="text-center -mt-0.5">{fmtPrice(r.price)}</div>
              </div>
            )}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function Peers({ r }: { r: Research }) {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const { data, error, isLoading } = useQuery({
    queryKey: ["peers", r.symbol],
    queryFn: () => apiGet<Peer[]>(`/api/research/${encodeURIComponent(r.symbol)}/peers`),
    staleTime: 30 * 60_000,
  });
  if (isLoading) return <div className="p-2 dim">Loading peers…</div>;
  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  return (
    <div className="p-1">
      <div className="dim text-[10px] px-1 mb-1">
        Largest companies in {r.profile?.industry ?? "the same industry"} on the same market · market cap in USD · click to open
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Company</th><th>Price</th><th>MCap $</th><th>P/E</th><th>P/B</th><th>EV/EBITDA</th><th>Net mgn</th><th>ROE</th><th>Rev g</th><th>Yield</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.ticker} onClick={() => setActiveSymbol(p.symbol)} className={p.symbol === r.symbol ? "bg-[#1f1a10]" : ""}>
              <td className="!text-left"><span className="font-bold">{p.symbol}</span> <span className="dim">{p.name.slice(0, 28)}</span></td>
              <td>{fmtPrice(p.price)} <span className="dim">{p.currency}</span></td>
              <td>{fmtBig(p.marketCapUsd)}</td>
              <td>{times(p.pe)}</td>
              <td>{times(p.pb)}</td>
              <td>{times(p.evEbitda)}</td>
              <td>{pctPts(p.netMargin)}</td>
              <td>{pctPts(p.roe)}</td>
              <td className={pctClass(p.revenueGrowth)}>{pctPts(p.revenueGrowth)}</td>
              <td>{pctPts(p.dividendYield, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ResearchWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const [tab, setTab] = useState<Tab>("Overview");
  const { data, error, isLoading } = useQuery({
    queryKey: ["research", symbol],
    queryFn: () => apiGet<Research>(`/api/research/${encodeURIComponent(symbol)}`),
    staleTime: 30 * 60_000,
    retry: false, // the server already falls back across providers
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap items-center shrink-0 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button key={t} className={`term-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        {data && (
          <span className="ml-auto truncate pl-2">
            <span className="font-bold">{data.name}</span>{" "}
            <span className="dim">{fmtPrice(data.price)} {data.currency}</span>
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading && <div className="p-2 dim">Researching {symbol}…</div>}
        {error && <div className="p-2 down">{(error as Error).message}</div>}
        {data && tab === "Overview" && <Overview r={data} />}
        {data && tab === "Financials" && <Financials r={data} />}
        {data && tab === "Ratios" && <Ratios r={data} />}
        {data && tab === "Valuation" && <Valuation r={data} />}
        {data && tab === "Analysts" && <Analysts r={data} />}
        {data && tab === "Peers" && <Peers r={data} />}
      </div>
      <div className="dim text-[9px] px-2 py-0.5 border-t border-[var(--border)] shrink-0">
        Statements: Yahoo Finance / SEC EDGAR · Profile, analysts & peers: TradingView · Models are screens, not investment advice.
      </div>
    </div>
  );
}
