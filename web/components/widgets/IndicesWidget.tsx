"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";
import Flash from "../Flash";
import { useTerminal } from "../../store/terminal";

type IndexRow = {
  symbol: string; name: string; country: string; region: string;
  price: number | null; change: number | null; changePercent: number | null; currency: string | null;
};

const REGIONS = ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa"];

export default function IndicesWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const { data = [], error } = useQuery({
    queryKey: ["indices"],
    queryFn: () => apiGet<IndexRow[]>("/api/indices"),
    refetchInterval: 15_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (data.length === 0) return <div className="p-2 dim">Loading world indices…</div>;

  return (
    <table className="data-table">
      <tbody>
        {REGIONS.map((region) => {
          const rows = data.filter((r) => r.region === region);
          if (rows.length === 0) return null;
          return [
            <tr key={region} className="pointer-events-none">
              <td colSpan={3} className="!text-left amber text-[10px] uppercase tracking-wider pt-2">{region}</td>
            </tr>,
            ...rows.map((r) => (
              <tr
                key={r.symbol}
                onClick={() => setActiveSymbol(r.symbol)}
                className={activeSymbol === r.symbol ? "bg-[#1f1a10]" : ""}
                title={`${r.symbol} · ${r.change !== null && r.change >= 0 ? "+" : ""}${fmt(r.change)} — open chart`}
              >
                <td className="!text-left">
                  <span className="dim inline-block w-6 text-[10px]">{r.country}</span>
                  {r.name}
                </td>
                <td><Flash value={r.price}>{fmt(r.price)}</Flash></td>
                <td className={pctClass(r.changePercent)}>
                  <Flash value={r.changePercent}>{r.changePercent !== null && r.changePercent >= 0 ? "+" : ""}{fmt(r.changePercent)}%</Flash>
                </td>
              </tr>
            )),
          ];
        })}
      </tbody>
    </table>
  );
}
