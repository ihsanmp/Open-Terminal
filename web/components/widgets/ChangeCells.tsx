"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";
import Flash from "../Flash";

/** The change over the day, the last week and the last month: three columns where one "Chg%" was. */
export function ChgHeads() {
  return (
    <>
      <th title="Perubahan harian: sejak harga penutupan sebelumnya (kripto: 24 jam terakhir)">Hari %</th>
      <th title="Perubahan satu minggu terakhir (TradingView)">Minggu %</th>
      <th title="Perubahan satu bulan terakhir (TradingView)">Bulan %</th>
    </>
  );
}

/** A change in percent, "—" when unknown; one that rounds to nothing is 0.00 (not "-0.00"). */
export const pctText = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmt(Math.abs(v) < 0.005 ? 0 : v)}%`);

/** A change too small to show counts as none (neither up nor down). */
export const tiny = (v: number | null | undefined) => (v !== null && v !== undefined && Math.abs(v) < 0.005 ? 0 : v);

export function ChgCells({ day, week, month }: { day: number | null | undefined; week: number | null | undefined; month: number | null | undefined }) {
  return (
    <>
      <td className={pctClass(day)}>
        <Flash value={day}>{pctText(day)}</Flash>
      </td>
      <td className={pctClass(tiny(week))}>{pctText(week)}</td>
      <td className={pctClass(tiny(month))}>{pctText(month)}</td>
    </>
  );
}

export type Perf = Record<string, { week: number | null; month: number | null } | null>;

/** The week's and the month's change of symbols whose prices come from several sources (/api/perf). */
export function usePerf(symbols: string[]): Perf | undefined {
  const { data } = useQuery({
    queryKey: ["perf", symbols.join(",")],
    queryFn: () => apiGet<Perf>(`/api/perf?symbols=${symbols.map(encodeURIComponent).join(",")}`),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data;
}
