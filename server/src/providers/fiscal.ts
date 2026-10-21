// US fiscal pressure, from the Treasury's own Fiscal Data API (api.fiscaldata.treasury.gov, no key):
//   - the debt to the penny (daily): total public debt, held by the public, intragovernmental;
//   - the Monthly Treasury Statement: each month's receipts, outlays and deficit (or surplus);
//   - the interest paid on the debt held by the public, per month;
//   - the average rate the Treasury pays on its marketable debt, per month;
//   - the Treasury General Account (its cash at the Fed), per day: when it fills (tax days, heavy
//     issuance) it drains reserves from the banks, when it runs down it adds them.

import { cached } from "../cache.js";

const BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

async function rows(path: string, query: string): Promise<Array<Record<string, string>>> {
  const res = await fetch(`${BASE}/${path}?${query}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`fiscaldata ${res.status} ${path}`);
  return ((await res.json()) as { data?: Array<Record<string, string>> }).data ?? [];
}

const n = (v: string | undefined) => {
  const x = Number(v);
  return v == null || v === "null" || !Number.isFinite(x) ? null : x;
};

export type Point = { date: string; value: number };
export type MonthBudget = { month: string; receipts: number; outlays: number; deficit: number };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The Monthly Treasury Statement's rows as months: each report's own month. A report lists the
 * last fiscal year's months and this one's so far, each under its "FY 2026" heading line, so the
 * month is taken from under its own fiscal year's heading (by the rows' line numbers).
 */
export function monthlyBudget(raw: Array<Record<string, string>>): MonthBudget[] {
  const headings = new Map<string, Array<{ line: number; fy: number }>>();
  for (const r of raw) {
    const fy = /^FY (\d{4})$/.exec(r.classification_desc ?? "");
    if (fy) (headings.get(r.record_date) ?? headings.set(r.record_date, []).get(r.record_date)!).push({ line: Number(r.src_line_nbr), fy: Number(fy[1]) });
  }
  const out = new Map<string, MonthBudget>();
  for (const r of raw) {
    const date = r.record_date ?? "";
    const m = Number(date.slice(5, 7));
    if (!m || r.classification_desc !== MONTH_NAMES[m - 1]) continue;
    const line = Number(r.src_line_nbr);
    const under = (headings.get(date) ?? []).filter((h) => h.line < line).sort((a, b) => b.line - a.line)[0];
    if (!under || under.fy !== fiscalYear(date.slice(0, 7))) continue;
    const receipts = n(r.current_month_gross_rcpt_amt);
    const outlays = n(r.current_month_gross_outly_amt);
    const deficit = n(r.current_month_dfct_sur_amt);
    if (receipts == null || outlays == null || deficit == null) continue;
    out.set(date.slice(0, 7), { month: date.slice(0, 7), receipts, outlays, deficit });
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** The fiscal year a month falls in (October starts the next one: 2026-10 is FY2027). */
export const fiscalYear = (month: string) => Number(month.slice(0, 4)) + (Number(month.slice(5, 7)) >= 10 ? 1 : 0);

/** A sum of a series' months per fiscal year, with how many months it has. */
export function byFiscalYear(months: Array<{ month: string; value: number }>): Array<{ fy: number; value: number; months: number }> {
  const out = new Map<number, { fy: number; value: number; months: number }>();
  for (const m of months) {
    const fy = fiscalYear(m.month);
    const e = out.get(fy) ?? { fy, value: 0, months: 0 };
    e.value += m.value;
    e.months++;
    out.set(fy, e);
  }
  return [...out.values()].sort((a, b) => a.fy - b.fy);
}

export type Fiscal = {
  debt: { latest: Point | null; heldByPublic: number | null; intragov: number | null; change30d: number | null; change1y: number | null; series: Point[] };
  budget: { months: MonthBudget[]; fytd: { fy: number; deficit: number; months: number } | null; priorSamePeriod: number | null; last12: number | null };
  interest: { months: Point[]; last12: number | null; prior12: number | null };
  avgRate: { latest: Point | null; yearAgo: number | null; series: Point[] };
  tga: { latest: Point | null; change30d: number | null; series: Point[] };
  asOf: number;
};

export async function fiscal(): Promise<Fiscal> {
  // An hour: the daily files (debt, TGA) come out each afternoon US time.
  return cached("fiscal:all", 3_600_000, async () => {
    const [debtRaw, mtsRaw, intRaw, rateRaw, tgaRaw] = await Promise.all([
      rows("v2/accounting/od/debt_to_penny", "sort=-record_date&page[size]=800&fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt"),
      // src_line_nbr keeps the rows apart: with only the other fields the API adds up the two
      // fiscal years' rows of the same month.
      rows("v1/accounting/mts/mts_table_1", "sort=-record_date&page[size]=2000&fields=record_date,src_line_nbr,classification_desc,current_month_gross_rcpt_amt,current_month_gross_outly_amt,current_month_dfct_sur_amt"),
      rows("v2/accounting/od/interest_expense", "sort=-record_date&page[size]=2000&fields=record_date,expense_catg_desc,month_expense_amt"),
      rows("v2/accounting/od/avg_interest_rates", "sort=-record_date&page[size]=1000&fields=record_date,security_desc,avg_interest_rate_amt"),
      rows("v1/accounting/dts/operating_cash_balance", "sort=-record_date&page[size]=1500&fields=record_date,account_type,open_today_bal,close_today_bal"),
    ]);

    const debtSeries = debtRaw
      .map((r) => ({ date: r.record_date, value: n(r.tot_pub_debt_out_amt) }))
      .filter((p): p is Point => p.value != null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const latestDebt = debtSeries.at(-1) ?? null;
    const before = (days: number) => {
      if (!latestDebt) return null;
      const cut = new Date(Date.parse(latestDebt.date) - days * 86_400_000).toISOString().slice(0, 10);
      return [...debtSeries].reverse().find((p) => p.date <= cut) ?? null;
    };
    const d30 = before(30);
    const d365 = before(365);
    const latestRow = debtRaw[0];

    const months = monthlyBudget(mtsRaw);
    const last = months.at(-1);
    const fy = last ? fiscalYear(last.month) : null;
    const thisFy = months.filter((m) => fiscalYear(m.month) === fy);
    const fytd = fy != null ? { fy, deficit: thisFy.reduce((s, m) => s + m.deficit, 0), months: thisFy.length } : null;
    const priorSame =
      fy != null && thisFy.length
        ? months.filter((m) => fiscalYear(m.month) === fy - 1).slice(0, thisFy.length)
        : [];

    const interestByMonth = new Map<string, number>();
    for (const r of intRaw) {
      if (!/PUBLIC ISSUES/i.test(r.expense_catg_desc ?? "")) continue;
      const v = n(r.month_expense_amt);
      if (v == null) continue;
      const m = (r.record_date ?? "").slice(0, 7);
      interestByMonth.set(m, (interestByMonth.get(m) ?? 0) + v);
    }
    const interest = [...interestByMonth.entries()].map(([m, value]) => ({ date: m, value })).sort((a, b) => a.date.localeCompare(b.date));
    const sum = (xs: Point[]) => (xs.length ? xs.reduce((s, p) => s + p.value, 0) : null);

    const rateSeries = rateRaw
      .filter((r) => r.security_desc === "Total Marketable")
      .map((r) => ({ date: r.record_date.slice(0, 7), value: n(r.avg_interest_rate_amt) }))
      .filter((p): p is Point => p.value != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    // The closing balance: in older days' files the "Closing Balance" line, in millions of dollars.
    const tgaSeries = tgaRaw
      .filter((r) => /TGA\) Closing Balance|Closing Balance/i.test(r.account_type ?? "") && /Treasury General Account|TGA/i.test(r.account_type ?? ""))
      .map((r) => ({ date: r.record_date, value: n(r.close_today_bal) ?? n(r.open_today_bal) }))
      .filter((p): p is Point => p.value != null)
      .map((p) => ({ date: p.date, value: p.value * 1e6 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const tgaLatest = tgaSeries.at(-1) ?? null;
    const tga30 = tgaLatest ? [...tgaSeries].reverse().find((p) => p.date <= new Date(Date.parse(tgaLatest.date) - 30 * 86_400_000).toISOString().slice(0, 10)) : null;

    return {
      debt: {
        latest: latestDebt,
        heldByPublic: n(latestRow?.debt_held_public_amt),
        intragov: n(latestRow?.intragov_hold_amt),
        change30d: latestDebt && d30 ? latestDebt.value - d30.value : null,
        change1y: latestDebt && d365 ? latestDebt.value - d365.value : null,
        // A point a week is plenty for the chart.
        series: debtSeries.filter((_, i) => i % 5 === 0 || i === debtSeries.length - 1),
      },
      budget: {
        months: months.slice(-36),
        fytd,
        priorSamePeriod: priorSame.length === thisFy.length && priorSame.length ? priorSame.reduce((s, m) => s + m.deficit, 0) : null,
        last12: months.length >= 12 ? months.slice(-12).reduce((s, m) => s + m.deficit, 0) : null,
      },
      interest: { months: interest.slice(-36), last12: interest.length >= 12 ? sum(interest.slice(-12)) : null, prior12: interest.length >= 24 ? sum(interest.slice(-24, -12)) : null },
      avgRate: { latest: rateSeries.at(-1) ?? null, yearAgo: rateSeries.at(-13)?.value ?? null, series: rateSeries.slice(-60) },
      tga: { latest: tgaLatest, change30d: tgaLatest && tga30 ? tgaLatest.value - tga30.value : null, series: tgaSeries.slice(-260) },
      asOf: Date.now(),
    };
  });
}
