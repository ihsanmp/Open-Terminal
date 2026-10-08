"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, fmt, fmtBig, pctClass } from "../../lib/api";
import { useTerminal, useWidgetSetting } from "../../store/terminal";
import Flash from "../Flash";
import { sessionRefreshMs, usePoll } from "../../lib/refresh";

/** The periods the change (and its filter and sort) can be over. */
const PERIODS = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
type Period = (typeof PERIODS)[number];

type Row = {
  symbol: string; name: string; price: number | null;
  changePercent: number | null; volume: number | null; marketCap: number | null;
  sector: string; perf?: Partial<Record<Period, number | null>>;
};

export default function ScreenerWidget() {
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [sector, setSector] = useWidgetSetting("sector", "");
  const [changeMin, setChangeMin] = useWidgetSetting("changeMin", "");
  const [marketCapMinB, setMarketCapMinB] = useWidgetSetting("marketCapMinB", "");
  const [volumeMinM, setVolumeMinM] = useWidgetSetting("volumeMinM", "");
  const [sort, setSort] = useWidgetSetting("sort", "marketCap");
  const [dir, setDir] = useWidgetSetting<"asc" | "desc">("dir", "desc");
  const [period, setPeriod] = useWidgetSetting<Period>("chgPeriod", "1D");
  const changeOf = (q: Row) => (period === "1D" ? q.changePercent : (q.perf?.[period] ?? null));

  const poll = usePoll(sessionRefreshMs(60_000, 600_000));
  const { data: sectors = [] } = useQuery({
    queryKey: ["sectors"],
    queryFn: () => apiGet<string[]>("/api/sectors"),
    staleTime: 600_000,
  });

  const params = new URLSearchParams();
  if (sector) params.set("sector", sector);
  if (changeMin) params.set("changeMin", changeMin);
  if (marketCapMinB) params.set("marketCapMin", String(Number(marketCapMinB) * 1e9));
  if (volumeMinM) params.set("volumeMin", String(Number(volumeMinM) * 1e6));
  params.set("period", period);
  params.set("sort", sort);
  params.set("dir", dir);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["screener", params.toString()],
    queryFn: () => apiGet<Row[]>(`/api/screener?${params}`),
    refetchInterval: poll,
  });

  const th = (key: string, label: string) => (
    <th
      onClick={() => {
        if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
        else setSort(key);
      }}
      className={sort === key ? "!text-[var(--amber)]" : ""}
    >
      {label} {sort === key ? (dir === "desc" ? "▼" : "▲") : ""}
    </th>
  );

  return (
    <div>
      <div className="flex gap-2 p-1 flex-wrap items-center">
        <select value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="flex items-center gap-1" role="group" aria-label="Change over">
          <span className="dim">Chg over</span>
          {PERIODS.map((p) => (
            <button key={p} className={`term-btn ${p === period ? "active" : ""}`} onClick={() => setPeriod(p)} aria-pressed={p === period}>
              {p}
            </button>
          ))}
        </span>
        <input className="w-28" placeholder={`Chg% ${period} min`} value={changeMin} onChange={(e) => setChangeMin(e.target.value)} />
        <input className="w-24" placeholder="MCap min ($B)" value={marketCapMinB} onChange={(e) => setMarketCapMinB(e.target.value)} />
        <input className="w-24" placeholder="Vol min (M)" value={volumeMinM} onChange={(e) => setVolumeMinM(e.target.value)} />
        <span className="dim ml-auto">{isLoading ? "…" : `${data.length} results`}</span>
      </div>
      {error && data.length === 0 && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <table className="data-table">
        <thead>
          <tr>
            {th("symbol", "Sym")}
            <th>Name</th>
            <th>Sector</th>
            {th("price", "Last")}
            {th("changePercent", `Chg% ${period}`)}
            {th("volume", "Vol")}
            {th("marketCap", "MCap")}
          </tr>
        </thead>
        <tbody>
          {data.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              <td className="font-bold">{q.symbol}</td>
              <td className="!text-left max-w-40 truncate">{q.name}</td>
              <td className="!text-left dim">{q.sector}</td>
              <td><Flash value={q.price}>{fmt(q.price)}</Flash></td>
              <td className={pctClass(changeOf(q))}>
                <Flash value={changeOf(q)}>{changeOf(q) === null ? "—" : `${fmt(changeOf(q))}%`}</Flash>
              </td>
              <td>{fmtBig(q.volume)}</td>
              <td>{fmtBig(q.marketCap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
