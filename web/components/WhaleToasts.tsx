"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet, fmt, fmtBig } from "../lib/api";
import { useChartSymbol } from "../lib/pair";
import { markPair, markSeen, pairKnown, seenAlerts, setPopupsOn, usePopupsOn } from "../lib/whale-popups";

// Pop-ups at the top of the screen when a whale or an institution buys or sells the pair open on
// the chart (server: providers/whalealerts.ts): a spot ETF's day of inflow or outflow, a treasury
// company's purchase, a company insider's trade, a whale's transfer, a big trade on an exchange.
// Each shows once; the first time a pair is opened, only its last day's.

type Party = { name: string | null; address: string | null; role?: string | null; tag?: "etf" | "treasury" | "whale" | "news" | "holder" | "cot" };
export type WhaleAlert = {
  id: string;
  asset: string;
  category: "onchain" | "exchange" | "insider" | "institution" | "whale";
  time: number;
  from: Party;
  to: Party;
  amount: number;
  unit: string;
  usd: number | null;
  side?: "buy" | "sell";
  note?: string;
  link?: string;
  source?: string;
};

const POLL_MS = 60_000;
const SHOW_MS = 30_000;
const FIRST_LOOK_S = 86_400;
const MAX_SHOWN = 4;

const keyOf = (a: WhaleAlert) => `${a.asset}:${a.id}`;

/** Who did it, as a pop-up names them. */
function kindOf(a: WhaleAlert): { icon: string; label: string } {
  const tag = (a.side === "sell" ? a.from : a.to).tag ?? a.from.tag ?? a.to.tag;
  if (a.category === "institution") {
    if (tag === "etf") return { icon: "🏦", label: "ETF spot" };
    if (tag === "treasury") return { icon: "🏢", label: "Perusahaan treasury" };
    if (tag === "holder") return { icon: "🏛", label: "Pemegang besar (13G/13D)" };
    if (tag === "cot") return { icon: "📊", label: "Posisi institusi (COT)" };
    return { icon: "🏦", label: "Institusi" };
  }
  if (a.category === "insider") return { icon: "👔", label: "Orang dalam (Form 4)" };
  if (a.category === "exchange") return { icon: "🐋", label: "Transaksi besar di bursa" };
  return { icon: "🐋", label: "Whale on-chain" };
}

/** The buyer or the seller by name, where the transaction gives one. */
function actorOf(a: WhaleAlert): string {
  const party = a.side === "sell" ? a.from : a.to;
  const generic = /^(pasar|market|pembeli|penjual|buyer|seller)$/i;
  if (party.name && !generic.test(party.name)) return party.name;
  if (a.category === "exchange") return `Order besar di ${(a.side === "sell" ? a.to : a.from).name ?? "bursa"}`;
  return "Whale";
}

function ago(seconds: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - seconds));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86_400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86_400)} hari lalu`;
}

function Toast({ a, onClose }: { a: WhaleAlert; onClose: () => void }) {
  const [hover, setHover] = useState(false);
  const left = useRef(SHOW_MS);
  // Closes on its own after a while; not while the pointer is on it.
  useEffect(() => {
    if (hover) return;
    const started = Date.now();
    const t = setTimeout(onClose, left.current);
    return () => {
      clearTimeout(t);
      left.current = Math.max(3000, left.current - (Date.now() - started));
    };
  }, [hover, onClose]);
  const buy = a.side === "buy";
  const kind = kindOf(a);
  const amount = `${fmt(a.amount, a.amount >= 100 ? 0 : 2)} ${a.unit}`;
  return (
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`pointer-events-auto bg-[#141414] border border-[var(--border)] border-l-4 ${buy ? "border-l-[var(--up)]" : "border-l-[var(--down)]"} shadow-2xl px-3 py-2 text-fs-11`}
    >
      <div className="flex items-center gap-2">
        <span>{kind.icon}</span>
        <span className="dim uppercase tracking-wider text-fs-9">{kind.label}</span>
        <span className="amber font-bold text-fs-10">{a.asset}</span>
        <span className={`px-1.5 rounded-[3px] text-fs-9 font-bold ${buy ? "bg-[#12301f] up" : "bg-[#3a1414] down"}`}>{buy ? "BELI" : "JUAL"}</span>
        <span className="dim text-fs-9 ml-auto">{ago(a.time)}</span>
        <button className="dim hover:text-[var(--text)] px-1" title="Tutup" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="mt-0.5 text-[var(--text)]">
        <span className="font-bold">{actorOf(a)}</span> {buy ? "membeli" : "menjual"} <span className={buy ? "up" : "down"}>{amount}</span>
        {a.usd ? <span className="dim"> (≈ ${fmtBig(a.usd)})</span> : null}
      </div>
      {(a.note || a.source || a.link) && (
        <div className="dim text-fs-9 mt-0.5 flex gap-2">
          <span className="truncate">{a.source ?? a.note}</span>
          {a.link && (
            <a href={a.link} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-[#5aa9ff] hover:underline">
              sumber →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function WhaleToasts() {
  const symbol = useChartSymbol();
  const on = usePopupsOn();
  const [shown, setShown] = useState<WhaleAlert[]>([]);
  const { data } = useQuery({
    queryKey: ["whale-alerts", symbol],
    queryFn: () => apiGet<{ alerts: WhaleAlert[] }>(`/api/whale-alerts?symbol=${encodeURIComponent(symbol)}`),
    enabled: on && Boolean(symbol),
    refetchInterval: POLL_MS,
    staleTime: 30_000,
  });

  // Another pair: the last one's pop-ups go.
  useEffect(() => setShown([]), [symbol]);

  useEffect(() => {
    if (!data || !on) return;
    const seen = seenAlerts();
    const fresh = data.alerts.filter((a) => !seen.has(keyOf(a)));
    // The first look at a pair shows only its last day; older ones are taken as seen.
    const first = !pairKnown(symbol);
    const now = Date.now() / 1000;
    const show = first ? fresh.filter((a) => now - a.time < FIRST_LOOK_S) : fresh;
    markSeen(fresh.map(keyOf));
    markPair(symbol);
    if (show.length) setShown((s) => [...show.slice(0, MAX_SHOWN), ...s].slice(0, MAX_SHOWN));
  }, [data, on, symbol]);

  if (!on || !shown.length) return null;
  const close = (k: string) => setShown((s) => s.filter((a) => keyOf(a) !== k));
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[70] w-[min(560px,92vw)] flex flex-col gap-1 pointer-events-none">
      {shown.map((a) => (
        <Toast key={keyOf(a)} a={a} onClose={() => close(keyOf(a))} />
      ))}
      <div className="pointer-events-auto self-end flex gap-2 text-fs-9">
        {shown.length > 1 && (
          <button className="dim hover:text-[var(--text)] bg-[#141414] border border-[var(--border)] px-1.5" onClick={() => setShown([])}>
            Tutup semua
          </button>
        )}
        <button
          className="dim hover:text-[var(--text)] bg-[#141414] border border-[var(--border)] px-1.5"
          title="Matikan pop-up whale & institusi (nyalakan lagi di tab Insider)"
          onClick={() => {
            setPopupsOn(false);
            setShown([]);
          }}
        >
          🔕 Matikan pop-up
        </button>
      </div>
    </div>
  );
}
