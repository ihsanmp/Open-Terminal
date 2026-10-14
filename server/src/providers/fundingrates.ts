// The overnight funding rates beside FedWatch: SOFR, TGCR and BGCR as the New York Fed publishes
// them each morning for the day before (rate and volume), and the Fed's overnight reverse repo
// facility (ON RRP) from FRED: how much money market funds park at the Fed, and at what rate.

import * as fred from "./fred.js";

export type FundingKind = "sofr" | "tgcr" | "bgcr" | "rrp";
export const FUNDING_KINDS: FundingKind[] = ["sofr", "tgcr", "bgcr", "rrp"];
export type FundingPoint = { date: string; rate: number | null; volume: number | null };
export type FundingSeries = { kind: FundingKind; name: string; unit: string; points: FundingPoint[]; source: string };

const NAMES: Record<FundingKind, string> = {
  sofr: "Secured Overnight Financing Rate (SOFR)",
  tgcr: "Tri-Party General Collateral Rate (TGCR)",
  bgcr: "Broad General Collateral Rate (BGCR)",
  rrp: "Overnight Reverse Repo (ON RRP)",
};

type NyFedRate = { effectiveDate: string; percentRate?: number; volumeInBillions?: number };

/** The last `days` business days of a New York Fed reference rate, oldest first. */
async function nyFed(kind: "sofr" | "tgcr" | "bgcr", days: number): Promise<FundingPoint[]> {
  const res = await fetch(`https://markets.newyorkfed.org/api/rates/secured/${kind}/last/${days}.json`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`nyfed ${kind} ${res.status}`);
  const body = (await res.json()) as { refRates?: NyFedRate[] };
  return (body.refRates ?? [])
    .map((r) => ({ date: r.effectiveDate, rate: r.percentRate ?? null, volume: r.volumeInBillions ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** ON RRP: the amount taken each day (billions) and the award rate, joined by date. */
async function reverseRepo(days: number): Promise<FundingPoint[]> {
  const [amounts, rates] = await Promise.all([fred.series("RRPONTSYD", days), fred.series("RRPONTSYAWARD", days + 30).catch(() => [])]);
  const rateOn = new Map(rates.map((p) => [p.date, p.value]));
  let lastRate: number | null = null;
  return amounts.map((p) => {
    lastRate = rateOn.get(p.date) ?? lastRate;
    return { date: p.date, rate: lastRate, volume: p.value };
  });
}

export async function fundingSeries(kind: FundingKind, days = 120): Promise<FundingSeries> {
  const points = kind === "rrp" ? await reverseRepo(days) : await nyFed(kind, days);
  return { kind, name: NAMES[kind], unit: "%", points, source: kind === "rrp" ? "FRED (RRPONTSYD, RRPONTSYAWARD)" : "Federal Reserve Bank of New York" };
}
