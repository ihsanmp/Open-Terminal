"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";
import { Bilingual } from "./NewsRecap";
import { ChgCells, ChgHeads, usePerf } from "./ChangeCells";

type RecapRow = { symbol: string; name: string; changePercent: number | null };
type RecapIndex = { symbol: string; label: string; price: number | null; changePercent: number | null };
type RecapSector = { sector: string; avgChangePercent: number };
type RecapNews = { title: string; link: string; publisher: string; publishedAt: string | null };

type Recap = {
  summary: string;
  /** The same in Indonesian. */
  summaryId?: string;
  updatedAt: string;
  indexes: RecapIndex[];
  vix: number | null;
  gainers: RecapRow[];
  losers: RecapRow[];
  sectors: RecapSector[];
  news: RecapNews[];
};

/** The market's day: indexes, sectors, the biggest movers and the headlines (News → MARKET). */
export default function MarketRecap() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const poll = usePoll(sessionRefreshMs(60_000, 600_000));
  const { data, error } = useQuery({
    queryKey: ["recap"],
    queryFn: () => apiGet<Recap>("/api/recap"),
    refetchInterval: poll,
  });

  const perf = usePerf(data?.indexes.map((q) => q.symbol) ?? []);

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (!data) return <div className="p-2 dim">Loading market recap…</div>;

  return (
    <div>
      <div className="px-2 py-1 flex justify-between items-baseline">
        <span className="dim text-fs-10 uppercase">Market Recap</span>
        <span className="dim text-fs-9">
          Updated {new Date(data.updatedAt).toLocaleTimeString()}
        </span>
      </div>

      <div className="px-2 pb-2 text-fs-12 leading-relaxed border-b border-[#161616]">
        <Bilingual en={data.summary} id={data.summaryId} />
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>Last</th>
            <ChgHeads />
          </tr>
        </thead>
        <tbody>
          {data.indexes.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              <td>{q.label}</td>
              <td>
                <Flash value={q.price}>{fmt(q.price)}</Flash>
              </td>
              <ChgCells day={q.changePercent} week={perf?.[q.symbol]?.week} month={perf?.[q.symbol]?.month} />
            </tr>
          ))}
          {data.vix !== null && (
            <tr className="cursor-pointer" onClick={() => setActiveSymbol("^VIX")}>
              <td>VIX</td>
              <td colSpan={4}>
                <Flash value={data.vix} className="amber">
                  {fmt(data.vix, 2)}
                </Flash>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-x-2 px-2 py-1">
        <div>
          <div className="dim text-fs-10 uppercase mb-1">Top gainers</div>
          {data.gainers.map((r) => (
            <div key={r.symbol} className="flex justify-between cursor-pointer hover:bg-[#161616]" onClick={() => setActiveSymbol(r.symbol)}>
              <span className="truncate mr-1">{r.symbol}</span>
              <span className={pctClass(r.changePercent)}>
                <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="dim text-fs-10 uppercase mb-1">Top losers</div>
          {data.losers.map((r) => (
            <div key={r.symbol} className="flex justify-between cursor-pointer hover:bg-[#161616]" onClick={() => setActiveSymbol(r.symbol)}>
              <span className="truncate mr-1">{r.symbol}</span>
              <span className={pctClass(r.changePercent)}>
                <Flash value={r.changePercent}>{fmt(r.changePercent)}%</Flash>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-2 py-1 border-t border-[#161616]">
        <div className="dim text-fs-10 uppercase mb-1">Sector performance</div>
        {data.sectors.map((s) => (
          <div key={s.sector} className="flex justify-between">
            <span className="truncate mr-1">{s.sector}</span>
            <span className={pctClass(s.avgChangePercent)}>{fmt(s.avgChangePercent)}%</span>
          </div>
        ))}
      </div>

      <div className="border-t border-[#161616]">
        <div className="dim text-fs-10 uppercase px-2 pt-1">Headlines</div>
        {data.news.map((n, i) => (
          <a
            key={i}
            href={n.link}
            target="_blank"
            rel="noreferrer"
            className="block px-2 py-1 border-b border-[#161616] hover:bg-[#161616]"
          >
            <div className="truncate">{n.title}</div>
            <div className="dim text-fs-10">{n.publisher}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
