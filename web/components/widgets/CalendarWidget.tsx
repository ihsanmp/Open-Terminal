"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { IMPACTS, countriesOf, countryOf, filterEvents, impactOf, type Impact } from "../../lib/econ-filter";
import { dayIn, monthWeeks, periodLabel, rangeOf, step, weekStart, type Period } from "../../lib/econ-range";
import { useTerminal, useWidgetSetting } from "../../store/terminal";

type EconEvent = {
  title: string;
  country: string;
  date: string;
  impact: "Low" | "Medium" | "High" | "Holiday";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

type EarningsEntry = {
  symbol: string;
  nextEarningsDate: number | null;
  lastEarningsDate: number | null;
  epsForecast: number | null;
};

const IMPACT_CLASS: Record<EconEvent["impact"], string> = {
  High: "down",
  Medium: "amber",
  Low: "dim",
  Holiday: "dim",
};

const TIMEZONES: Array<{ label: string; zone: string | undefined }> = [
  { label: "Local", zone: undefined },
  { label: "UTC", zone: "UTC" },
  { label: "New York", zone: "America/New_York" },
  { label: "Chicago", zone: "America/Chicago" },
  { label: "London", zone: "Europe/London" },
  { label: "Frankfurt", zone: "Europe/Berlin" },
  { label: "Tokyo", zone: "Asia/Tokyo" },
  { label: "Sydney", zone: "Australia/Sydney" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** A month to pick a day from, or a whole week with the » at the start of its row. */
function PeriodPicker({ period, today, onPick, onClose }: { period: Period; today: string; onPick: (p: Period) => void; onClose: () => void }) {
  const [y, m] = period.day.split("-").map(Number);
  const [month, setMonth] = useState({ y, m: m - 1 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const turn = (k: number) => setMonth(({ y, m }) => ({ y: y + Math.floor((m + k) / 12), m: (((m + k) % 12) + 12) % 12 }));
  const thisMonth = (day: string) => Number(day.slice(5, 7)) === month.m + 1;

  return (
    <div ref={ref} className="absolute z-20 top-full left-0 mt-1 p-1 bg-[var(--panel)] border border-[var(--border)] shadow-lg text-fs-11 select-none">
      <div className="flex items-center justify-between mb-1">
        <button className="term-btn !px-2" onClick={() => turn(-1)} aria-label="Previous month">
          ‹
        </button>
        <span className="amber font-bold">
          {MONTHS[month.m]} {month.y}
        </span>
        <button className="term-btn !px-2" onClick={() => turn(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <table className="border-collapse">
        <thead>
          <tr>
            <th />
            {WEEKDAYS.map((w, i) => (
              <th key={i} className={`w-7 text-center text-fs-10 font-normal ${i >= 5 ? "dim" : ""}`}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month.y, month.m).map((week) => {
            const weekOn = period.kind === "week" && weekStart(period.day) === week[0];
            return (
              <tr key={week[0]} className={weekOn ? "bg-[rgba(46,204,143,0.25)]" : ""}>
                <td className="p-0">
                  <button
                    className={`w-6 h-6 text-center ${weekOn ? "up font-bold" : "dim"} hover:text-[var(--text)]`}
                    onClick={() => onPick({ kind: "week", day: week[0] })}
                    title="Show this week"
                  >
                    »
                  </button>
                </td>
                {week.map((day) => {
                  const dayOn = period.kind === "day" && period.day === day;
                  return (
                    <td key={day} className="p-0">
                      <button
                        className={`w-7 h-6 text-center hover:bg-[var(--panel-2)] ${dayOn ? "bg-[rgba(46,204,143,0.45)] font-bold" : ""} ${
                          day === today ? "amber font-bold underline" : thisMonth(day) ? "" : "dim opacity-50"
                        }`}
                        onClick={() => onPick({ kind: "day", day })}
                        title="Show this day"
                      >
                        {Number(day.slice(8))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EconomicTab() {
  // The old HIGH+MED / ALL switch, as the starting impacts.
  const [minImpact] = useWidgetSetting<"all" | "medium">("minImpact", "medium");
  const [impacts, setImpacts] = useWidgetSetting<Impact[]>("impacts", minImpact === "all" ? IMPACTS.map((i) => i.id) : ["High", "Medium"]);
  const [hiddenCountries, setHiddenCountries] = useWidgetSetting<string[]>("hiddenCountries", []);
  const [tz, setTz] = useWidgetSetting<string>("tz", "Local");

  const zone = TIMEZONES.find((t) => t.label === tz)?.zone;
  const today = dayIn(Date.now(), zone);
  // The day or week shown; this week to start with.
  const [period, setPeriod] = useState<Period>(() => ({ kind: "week", day: weekStart(dayIn(Date.now(), zone)) }));
  const [picking, setPicking] = useState(false);
  const { from, to } = rangeOf(period, zone);

  const { data = [], isLoading, isFetching, error } = useQuery({
    queryKey: ["econ-calendar", from, to],
    queryFn: () => apiGet<EconEvent[]>(`/api/econ-calendar?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`),
    placeholderData: keepPreviousData,
    // A period still running gets its actuals as they're released.
    refetchInterval: to > Date.now() ? 300_000 : false,
  });

  const events = useMemo(() => filterEvents(data, impacts, hiddenCountries), [data, impacts, hiddenCountries]);
  const countries = useMemo(() => countriesOf(data), [data]);
  /** Events per country, at the chosen impacts: how many each country chip would add. */
  const perCountry = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of filterEvents(data, impacts, [])) n.set(countryOf(e.country), (n.get(countryOf(e.country)) ?? 0) + 1);
    return n;
  }, [data, impacts]);
  const perImpact = useMemo(() => {
    const n = new Map<Impact, number>();
    for (const e of filterEvents(data, IMPACTS.map((i) => i.id), hiddenCountries)) n.set(impactOf(e.impact), (n.get(impactOf(e.impact)) ?? 0) + 1);
    return n;
  }, [data, hiddenCountries]);

  const thisWeek: Period = { kind: "week", day: weekStart(today) };
  const nextWeek = step(thisWeek, 1);
  const pick = (p: Period) => {
    setPeriod(p);
    setPicking(false);
  };
  const toggleImpact = (id: Impact) => setImpacts(impacts.includes(id) ? impacts.filter((i) => i !== id) : [...impacts, id]);
  const toggleCountry = (code: string) =>
    setHiddenCountries(hiddenCountries.includes(code) ? hiddenCountries.filter((c) => c !== code) : [...hiddenCountries, code]);

  return (
    <div>
      <div className="flex gap-1 p-1 items-center flex-wrap">
        <span className="dim text-fs-10 tracking-wider mr-1">{period.kind === "week" ? "WEEK" : "DAY"}</span>
        <button className="term-btn !px-2" onClick={() => setPeriod(step(period, -1))} title={`Previous ${period.kind}`}>
          ‹
        </button>
        <span className="relative">
          <button className={`term-btn ${picking ? "active" : ""}`} onClick={() => setPicking(!picking)} title="Pick a day, or a week with »">
            {periodLabel(period)} ▾
          </button>
          {picking && <PeriodPicker period={period} today={today} onPick={pick} onClose={() => setPicking(false)} />}
        </span>
        <button className="term-btn !px-2" onClick={() => setPeriod(step(period, 1))} title={`Next ${period.kind}`}>
          ›
        </button>
        <button className={`term-btn ${period.kind === "day" && period.day === today ? "active" : ""}`} onClick={() => setPeriod({ kind: "day", day: today })}>
          TODAY
        </button>
        <button className={`term-btn ${period.kind === "week" && period.day === thisWeek.day ? "active" : ""}`} onClick={() => setPeriod(thisWeek)}>
          THIS WEEK
        </button>
        <button className={`term-btn ${period.kind === "week" && period.day === nextWeek.day ? "active" : ""}`} onClick={() => setPeriod(nextWeek)}>
          NEXT WEEK
        </button>
        {isFetching && <span className="dim text-fs-10">loading…</span>}
      </div>
      <div className="flex gap-1 px-1 pb-1 items-center flex-wrap">
        <span className="dim text-fs-10 tracking-wider mr-1">IMPACT</span>
        {IMPACTS.map((i) => (
          <button
            key={i.id}
            className={`term-btn ${impacts.includes(i.id) ? "active" : ""}`}
            onClick={() => toggleImpact(i.id)}
            title={`${i.id} impact`}
            aria-pressed={impacts.includes(i.id)}
          >
            <span className={i.cls}>●</span> {i.label} <span className="dim">{perImpact.get(i.id) ?? 0}</span>
          </button>
        ))}
        <button className="term-btn" onClick={() => setImpacts(impacts.length === IMPACTS.length ? [] : IMPACTS.map((i) => i.id))}>
          {impacts.length === IMPACTS.length ? "NONE" : "ALL"}
        </button>
        <span className="w-2" />
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="term-btn !py-0.5 bg-[var(--panel)] cursor-pointer"
        >
          {TIMEZONES.map((t) => (
            <option key={t.label} value={t.label}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-1 px-1 pb-1 items-center flex-wrap">
        <span className="dim text-fs-10 tracking-wider mr-1">COUNTRY</span>
        {countries.map((c) => {
          const on = !hiddenCountries.includes(c.code);
          return (
            <button
              key={c.code}
              className={`term-btn ${on ? "active" : ""}`}
              onClick={() => toggleCountry(c.code)}
              title={c.name}
              aria-pressed={on}
            >
              {c.code} <span className="dim">{perCountry.get(c.code) ?? 0}</span>
            </button>
          );
        })}
        <button
          className="term-btn"
          onClick={() => setHiddenCountries(hiddenCountries.length === 0 ? countries.map((c) => c.code) : [])}
        >
          {hiddenCountries.length === 0 ? "NONE" : "ALL"}
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Ccy</th>
            <th title="Impact">Imp</th>
            <th className="!text-left">Event</th>
            <th>Forecast</th>
            <th>Previous</th>
            <th>Actual</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            // In a week, each day's events under its own heading.
            const day = dayIn(Date.parse(e.date), zone);
            const newDay = period.kind === "week" && (i === 0 || dayIn(Date.parse(events[i - 1].date), zone) !== day);
            return (
              <Fragment key={`${e.title}-${e.date}-${i}`}>
                {newDay && (
                  <tr>
                    <td colSpan={7} className={`!text-left font-bold bg-[var(--panel-2)] ${day === today ? "amber" : ""}`}>
                      {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
                      {day === today && " · today"}
                    </td>
                  </tr>
                )}
                <tr>
              <td className="!text-left dim whitespace-nowrap">
                {new Date(e.date).toLocaleString(undefined, {
                  timeZone: zone,
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </td>
              <td>{e.country}</td>
              <td className={IMPACTS.find((i) => i.id === impactOf(e.impact))!.cls} title={`${impactOf(e.impact)} impact`}>
                ●
              </td>
              <td className={`!text-left ${IMPACT_CLASS[impactOf(e.impact)]}`}>{e.title}</td>
              <td>{e.forecast ?? "—"}</td>
              <td className="dim">{e.previous ?? "—"}</td>
              <td className={e.actual ? "text-[var(--text)]" : "dim"}>{e.actual ?? "—"}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      {isLoading && <div className="p-2 dim">Loading calendar…</div>}
      {!isLoading && !error && events.length === 0 && (
        <div className="p-3 dim">{data.length === 0 ? `No events this ${period.kind}.` : "No events match these filters."}</div>
      )}
    </div>
  );
}

const fmtDate = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleDateString("en-US") : "—");

type EarningsHistoryRow = {
  fiscalQtrEnd: string;
  dateReported: number;
  eps: number | null;
  consensusForecast: number | null;
  surprisePercent: number | null;
  dayAfterChangePercent: number | null;
};

/** Actual vs forecast: beat = green, miss = red, in-line = white. */
function surpriseClass(row: EarningsHistoryRow): string {
  if (row.eps === null || row.consensusForecast === null) return "dim";
  if (row.eps > row.consensusForecast) return "up";
  if (row.eps < row.consensusForecast) return "down";
  return "text-[var(--text)]";
}

function EarningsHistoryRows({ symbol }: { symbol: string }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["earnings-history", symbol],
    queryFn: () => apiGet<EarningsHistoryRow[]>(`/api/earnings-history/${symbol}`),
    staleTime: 3_600_000,
  });

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">Loading history for {symbol}…</div>;
  if (data.length === 0) return <div className="p-2 dim">No earnings history for {symbol}.</div>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Quarter</th>
          <th>Reported</th>
          <th>Forecast</th>
          <th>Actual</th>
          <th>Surprise</th>
          <th>Day After</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.dateReported}>
            <td className="!text-left dim">{row.fiscalQtrEnd}</td>
            <td className="!text-left dim">{fmtDate(row.dateReported)}</td>
            <td className="dim">{row.consensusForecast != null ? `$${row.consensusForecast.toFixed(2)}` : "—"}</td>
            <td className={surpriseClass(row)}>{row.eps != null ? `$${row.eps.toFixed(2)}` : "—"}</td>
            <td className={surpriseClass(row)}>{row.surprisePercent != null ? `${fmt(row.surprisePercent, 1)}%` : "—"}</td>
            <td className={pctClass(row.dayAfterChangePercent)}>
              {row.dayAfterChangePercent != null ? `${fmt(row.dayAfterChangePercent, 1)}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EarningsTab() {
  const watchlist = useTerminal((s) => s.watchlist);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["calendar", watchlist],
    queryFn: () => apiGet<EarningsEntry[]>(`/api/calendar?symbols=${watchlist.join(",")}`),
    enabled: watchlist.length > 0,
    staleTime: 3_600_000,
  });

  const sorted = useMemo(
    () =>
      [...data].sort((a, b) => {
        if (a.nextEarningsDate === null && b.nextEarningsDate === null) return 0;
        if (a.nextEarningsDate === null) return 1;
        if (b.nextEarningsDate === null) return -1;
        return a.nextEarningsDate - b.nextEarningsDate;
      }),
    [data]
  );

  if (error) return <div className="p-2 down">Error: {(error as Error).message}</div>;
  if (isLoading) return <div className="p-2 dim">Loading earnings…</div>;

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Sym</th>
          <th>Last Earnings</th>
          <th>Next Earnings</th>
          <th>EPS Est.</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <Fragment key={e.symbol}>
            <tr
              onClick={() => setExpanded(expanded === e.symbol ? null : e.symbol)}
              className="cursor-pointer"
              title="Click for earnings history"
            >
              <td className="!text-left text-[var(--text)] font-bold underline decoration-1">{e.symbol}</td>
              <td className="dim">{fmtDate(e.lastEarningsDate)}</td>
              <td className="amber">{fmtDate(e.nextEarningsDate)}</td>
              <td>{e.epsForecast != null ? `$${e.epsForecast.toFixed(2)}` : "—"}</td>
            </tr>
            {expanded === e.symbol && (
              <tr>
                <td colSpan={4} className="!text-left p-0">
                  <EarningsHistoryRows symbol={e.symbol} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={4} className="dim p-3">
              No upcoming earnings data for your watchlist.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function CalendarWidget() {
  const [tab, setTab] = useWidgetSetting<"econ" | "earnings">("tab", "econ");

  return (
    <div>
      <div className="flex gap-1 p-1">
        <button className={`term-btn ${tab === "econ" ? "active" : ""}`} onClick={() => setTab("econ")}>
          ECONOMIC
        </button>
        <button className={`term-btn ${tab === "earnings" ? "active" : ""}`} onClick={() => setTab("earnings")}>
          EARNINGS
        </button>
      </div>
      {tab === "econ" ? <EconomicTab /> : <EarningsTab />}
    </div>
  );
}
