"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { bigTradeFloor, subscribeTrades } from "../../lib/binance-stream";
import { apiGet, fmt, fmtBig, fmtPrice } from "../../lib/api";
import { liveLabel, subscribeTicks, type LiveState } from "../../lib/live-ticks";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";

// An asset's transactions, newest first, each from whom to whom (server: providers/transfers.ts):
// a Bitcoin transfer between named wallets, a big trade on Binance, a US insider's trade, and the
// big institutions' buys and sales (spot ETFs' daily flows, treasury companies' 8-K reports).
// A coin on Binance gets its big trades there as they happen, from Binance's stream; a stock its
// every trade (the tape) from TradingView's quote stream through the server.

type Party = { name: string | null; address: string | null; role?: string | null; tag?: "etf" | "treasury" | "whale" | "news" };
type Category = "onchain" | "exchange" | "insider" | "institution" | "whale" | "tape";
type Row = {
  id: string;
  category: Category;
  time: number;
  from: Party;
  to: Party;
  amount: number;
  unit: string;
  usd: number | null;
  side?: "buy" | "sell";
  price?: number | null;
  note?: string;
  link?: string;
  /** The value's currency when not dollars (an IDX stock's rupiah). */
  currency?: string;
  /** The headline it was read from, before a filing reports it. */
  source?: string;
  /** Among the biggest of those seen lately. */
  big?: boolean;
};
type Wallet = { name: string; address: string; chain: "BTC" | "ETH"; kind: string; link: string };
type Transfers = { kind: "onchain" | "exchange" | "insider" | "none"; source: string; rows: Row[]; note?: string; wallets?: Wallet[] };

const KIND_LABEL: Record<string, string> = {
  exchange: "Exchange",
  individual: "Individu",
  bridge: "Bridge",
  fund: "Dana",
  government: "Pemerintah (sitaan)",
  hack: "Hasil hack",
};

/** The named wallets of the coin's chain, each with its full address to copy or open. */
function WalletDirectory({ wallets }: { wallets: Wallet[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (address: string) => {
    void navigator.clipboard?.writeText(address).then(() => {
      setCopied(address);
      setTimeout(() => setCopied((c) => (c === address ? null : c)), 1500);
    });
  };
  const chain = wallets[0]?.chain;
  return (
    <div className="border border-[var(--border)] max-h-[calc(16rem*var(--font-scale))] overflow-auto">
      <div className="px-2 py-1 dim text-fs-10 uppercase tracking-wider border-b border-[var(--border)] flex justify-between sticky top-0 bg-[var(--panel)] z-[1]">
        <span>
          Alamat wallet yang dikenali · {chain === "BTC" ? "Bitcoin" : "Ethereum"} ({wallets.length})
        </span>
        <span className="normal-case">{chain === "BTC" ? "label: bitinfocharts" : "dipantau · data/watched-wallets.json"}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th className="!text-left">Nama</th>
            <th className="!text-left">Jenis</th>
            <th className="!text-left">Alamat wallet</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.address}>
              <td className="!text-left text-[var(--text)]">{w.name}</td>
              <td className="!text-left dim">{KIND_LABEL[w.kind] ?? w.kind}</td>
              <td className="!text-left font-mono select-all break-all !whitespace-normal">{w.address}</td>
              <td className="whitespace-nowrap">
                <button className="term-btn !px-1.5 !py-0" onClick={() => copy(w.address)} title="Salin alamat">
                  {copied === w.address ? "✓ disalin" : "salin"}
                </button>{" "}
                <a href={w.link} target="_blank" rel="noreferrer" className="term-btn !px-1.5 !py-0 inline-block" title={chain === "BTC" ? "Buka di mempool.space" : "Buka di Etherscan"}>
                  ↗
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function ago(t: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - t);
  if (s < 60) return `${Math.floor(s)} dtk lalu`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86_400) return `${Math.floor(s / 3600)} jam lalu`;
  if (s < 60 * 86_400) return `${Math.floor(s / 86_400)} hari lalu`;
  return new Date(t * 1000).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function PartyCell({ p }: { p: Party }) {
  const named = Boolean(p.name);
  return (
    <span className="min-w-0 truncate flex items-baseline gap-1" title={[p.name, p.role, p.address].filter(Boolean).join(" · ")}>
      <span className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 self-center ${p.tag === "whale" ? "bg-[#b388ff]" : p.tag ? "bg-[var(--amber)]" : named ? "bg-[#5b9cf6]" : "bg-[#404040]"}`} />
      {p.tag && (
        <span className={`text-fs-9 px-1 border shrink-0 ${p.tag === "whale" ? "border-[#b388ff] text-[#b388ff]" : "border-[var(--amber)] amber"}`}>
          {p.tag === "etf" ? "ETF" : p.tag === "treasury" ? "8-K" : p.tag === "news" ? "BERITA" : "WHALE"}
        </span>
      )}
      <span className={p.tag === "whale" ? "text-[#b388ff] font-bold" : p.tag ? "amber font-bold" : named ? "text-[var(--text)]" : "dim"}>{p.name ?? (p.address ? short(p.address) : "Tidak diketahui")}</span>
      {p.name && p.address && <span className="dim text-fs-10">({short(p.address)})</span>}
      {p.role && <span className="dim text-fs-10">{p.role}</span>}
    </span>
  );
}

const OWN_LABEL: Record<Category, string> = { onchain: "ON-CHAIN", exchange: "BINANCE", insider: "INSIDER", institution: "INSTITUSI", whale: "WHALE", tape: "REAL-TIME" };

const isCoin = (symbol: string) => /-USDT?$/.test(symbol.toUpperCase());

/** A stock's every trade as it happens (shares, at what price, buyer- or seller-started). */
function useTape(symbol: string, currency: string | undefined): { rows: Row[]; state: LiveState | null } {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<LiveState | null>(null);
  useEffect(() => {
    setRows([]);
    setState(null);
    if (isCoin(symbol)) return;
    const recent: number[] = [];
    let pending: Row[] = [];
    let seq = 0;
    let ticker: string | null = null;
    const flush = setInterval(() => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setRows((list) => [...batch.reverse(), ...list].slice(0, 300));
    }, 1000);
    const stop = subscribeTicks(
      symbol,
      (ticks) => {
        for (const t of ticks) {
          if (t.value > 0) {
            recent.push(t.value);
            if (recent.length > 1000) recent.shift();
          }
          pending.push({
            id: `tape-${++seq}-${t.time}`,
            category: "tape",
            time: t.time / 1000,
            from: { name: t.side === "buy" ? "Pembeli" : "Penjual", address: null, role: t.extended ? "extended hours" : "agresif" },
            to: { name: ticker?.split(":")[0] ?? "Bursa", address: null, role: ticker?.split(":")[1] ?? symbol },
            amount: t.size,
            unit: "saham",
            usd: t.size > 0 ? t.value : null,
            side: t.side,
            price: t.price,
            currency: currency && currency !== "USD" ? currency : undefined,
            big: recent.length >= 50 && t.value >= bigTradeFloor(recent, 0),
          });
        }
      },
      (st) => {
        ticker = st.ticker;
        setState(st);
      }
    );
    return () => {
      stop();
      clearInterval(flush);
    };
  }, [symbol, currency]);
  return { rows, state };
}

export default function TransfersList({ symbol, currency }: { symbol: string; currency?: string }) {
  const poll = usePoll(15_000);
  const [only, setOnly] = useWidgetSetting<"all" | Category>("txFilter", "all");
  const { data, error, isLoading } = useQuery({
    queryKey: ["transfers", symbol],
    queryFn: () => apiGet<Transfers>(`/api/transfers/${encodeURIComponent(symbol)}`),
    refetchInterval: poll,
  });

  const tape = useTape(symbol, currency);
  const tapeOn = tape.state !== null && !tape.state.unavailable;

  // A coin traded on Binance: its big trades from the stream, as they happen.
  const base = data?.kind === "exchange" ? /^([A-Z0-9]{1,20})-USDT?$/.exec(symbol.toUpperCase())?.[1] ?? null : null;
  const [liveRows, setLiveRows] = useState<Row[]>([]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    setLiveRows([]);
    if (!base) return;
    // The latest trades' values, for what counts as big (the top 2%, at least $10,000).
    const recent: number[] = [];
    let pending: Row[] = [];
    const flush = setInterval(() => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setLiveRows((rows) => [...batch.reverse(), ...rows].slice(0, 300));
    }, 1000);
    const stop = subscribeTrades(
      base,
      (trades) => {
        for (const t of trades) {
          const usd = t.price * t.qty;
          recent.push(usd);
          if (recent.length > 2000) recent.shift();
          if (recent.length < 200 || usd < bigTradeFloor(recent)) continue;
          const side = t.buyerMaker ? "sell" : "buy";
          pending.push({
            id: String(t.id),
            category: "exchange",
            time: Math.floor(t.time / 1000),
            from: { name: side === "buy" ? "Pembeli" : "Penjual", address: null, role: "taker" },
            to: { name: "Binance", address: null, role: `${base}/USDT` },
            amount: t.qty,
            unit: base,
            usd,
            side,
            price: t.price,
          });
        }
      },
      setLive
    );
    return () => {
      stop();
      clearInterval(flush);
    };
  }, [base]);
  if (error && !tapeOn) return <div className="down">Error: {(error as Error).message}</div>;
  if ((isLoading || !data) && !tapeOn) return <div className="dim">Memuat riwayat transaksi {symbol}…</div>;
  if (data?.kind === "none" && !tapeOn) return <div className="dim">{data.note}</div>;
  const kind = data?.kind ?? "none";
  const listedRows = data?.rows ?? [];

  // The stream's trades the server hasn't listed yet go on top.
  const listed = new Set(listedRows.map((r) => r.id));
  const streamed = [...liveRows, ...tape.rows];
  const rows = streamed.length ? [...streamed.filter((r) => !listed.has(r.id)), ...listedRows].sort((a, b) => b.time - a.time) : listedRows;

  // The kinds this asset has, a stock's live tape and institutions first: each a filter. The
  // institutions' filter shows the named wallets too, so it's there whenever there are some.
  const kinds = (["tape", "institution", "whale", "onchain", "exchange", "insider"] as Category[]).filter(
    (k) => rows.some((r) => r.category === k) || (k === "institution" && (data?.wallets?.length ?? 0) > 0) || (k === "tape" && tapeOn)
  );
  const tapeLabel = tape.state && tapeOn ? liveLabel(tape.state) : null;
  const shown = only === "all" || !kinds.includes(only) ? rows : rows.filter((r) => r.category === only);

  return (
    <div className="flex flex-col gap-1">
      {kinds.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          <button className={`term-btn ${only === "all" || !kinds.includes(only) ? "active" : ""}`} onClick={() => setOnly("all")}>
            SEMUA <span className="dim">{rows.length}</span>
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              className={`term-btn ${only === k ? "active" : ""}`}
              onClick={() => setOnly(k)}
              title={k === "tape" ? "Setiap transaksi saham ini saat terjadi (stream TradingView)" : k === "institution" ? "ETF spot (BlackRock, Fidelity, Grayscale …) dan perusahaan treasury (Strategy, MARA …)" : k === "whale" ? "Wallet Ethereum yang dipantau (Vitalik, Justin Sun, Binance …)" : undefined}
            >
              {OWN_LABEL[k]} <span className="dim">{rows.filter((r) => r.category === k).length}</span>
            </button>
          ))}
        </div>
      )}
      {(only === "institution" || only === "whale") && kinds.includes(only) && data?.wallets && data.wallets.length > 0 && <WalletDirectory wallets={data.wallets} />}
      <div className="dim text-fs-10">
        {shown.length} transaksi{data && kind !== "none" ? ` · sumber: ${data.source}` : ""}
        {tapeLabel && (
          <span className="ml-2" title="Stream TradingView: tiap kenaikan volume harian dihitung satu transaksi pada harga terakhir; sisi beli/jual dibaca dari bid/ask. Di luar jam reguler hanya harga yang tersedia (ukuran tidak diketahui).">
            <span className={tapeLabel.live ? "up" : "amber"}>●</span> {tapeLabel.text} · {tape.state?.ticker}
          </span>
        )}
        {base && (
          <span className="ml-2">
            <span className={live ? "up" : "amber"}>●</span> {live ? "LIVE dari stream Binance" : "menyambung ke stream…"}
          </span>
        )}
      </div>
      {rows.length === 0 && (
        <div className="dim">{kind === "exchange" ? "Belum ada transaksi besar yang terekam; daftar ini terisi selama halaman terbuka." : "Belum ada transaksi."}</div>
      )}
      <div className="border border-[var(--border)]">
        {shown.map((r) => {
          const color = r.side === "sell" ? "down" : r.side === "buy" ? "up" : "up";
          const value = r.usd === null ? "—" : r.currency ? `${r.currency} ${fmtBig(r.usd)}` : `$${fmtBig(r.usd)}`;
          const body = (
            <>
              <span className="w-[96px] max-sm:w-auto shrink-0 text-[#5b9cf6] tabular-nums whitespace-nowrap" title={new Date(r.time * 1000).toLocaleString("id-ID")}>
                {ago(r.time)}
              </span>
              <span className="flex-1 min-w-0 max-sm:basis-full max-sm:order-first grid grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)] gap-2 items-baseline">
                <PartyCell p={r.from} />
                <span className="dim">→</span>
                <PartyCell p={r.to} />
              </span>
              {r.note && <span className="dim text-fs-10 shrink-0 w-[96px] max-sm:w-auto truncate">{r.note}</span>}
              {r.side && !r.note && <span className={`${color} text-fs-10 shrink-0 w-[40px] max-sm:w-auto uppercase`}>{r.side === "buy" ? "beli" : "jual"}</span>}
              <span className={`${color} shrink-0 w-[110px] max-sm:w-auto max-sm:ml-auto text-right tabular-nums ${r.big ? "font-bold" : ""}`}>
                {r.category === "tape" && r.amount === 0 ? "—" : r.amount >= 1000 ? fmtBig(r.amount) : fmt(r.amount, r.amount >= 100 || r.category === "tape" ? 0 : 2)} <span className="dim">{r.unit}</span>
              </span>
              {r.price !== undefined && <span className="dim shrink-0 w-[84px] max-sm:w-auto text-right tabular-nums">{r.price ? `@ ${fmtPrice(r.price)}` : ""}</span>}
              <span className={`shrink-0 w-[84px] max-sm:w-auto text-right tabular-nums ${r.big ? "amber font-bold" : "text-[var(--text)]"}`}>{value}</span>
            </>
          );
          const cls = "flex items-baseline gap-3 max-sm:flex-wrap max-sm:gap-y-0.5 px-2 py-1.5 border-b border-[#161616] hover:bg-[#161616]";
          return r.link ? (
            <a key={r.id} href={r.link} target="_blank" rel="noreferrer" className={cls} title={r.category === "onchain" ? "Buka transaksi di mempool.space" : r.category === "whale" ? "Buka transaksi di Etherscan" : r.source ? `Belum ada 8-K: dari berita — ${r.source}` : "Buka sumbernya"}>
              {body}
            </a>
          ) : (
            <div key={r.id} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
      {data?.note && kind !== "none" && <div className="dim text-fs-10 leading-relaxed">{data.note}</div>}
      {kinds.includes("tape") && (
        <div className="dim text-fs-10 leading-relaxed">
          Real-time: setiap transaksi saham ini dari stream kuotasi TradingView — tiap kenaikan volume harian dihitung satu transaksi pada harga terakhir (beberapa transaksi dalam satu detik bisa tergabung), beli/jual dibaca dari posisinya terhadap bid/ask. Saham AS real-time; bursa lain (mis. IDX) hanya tersedia tertunda 10 menit tanpa login. Di pra/pasca-pasar hanya harganya yang tersedia. Yang tebal: 2% transaksi terbesar.
        </div>
      )}
      {kinds.includes("whale") && (
        <div className="dim text-fs-10 leading-relaxed">
          Whale: transfer ≥ $50.000 dari/ke wallet Ethereum yang dipantau (Vitalik Buterin, Justin Sun, Binance Hot Wallet 1 &amp; Cold Storage, Arbitrum Sequencer Inbox), dari Blockscout. Wallet lain bisa ditambahkan di data/watched-wallets.json.
        </div>
      )}
      {kinds.includes("institution") && (
        <div className="dim text-fs-10 leading-relaxed">
          Institusi: arus harian tiap ETF spot (BlackRock IBIT, Fidelity FBTC, Grayscale GBTC …) dari Farside, dalam koin pada harga penutupan hari itu; dan pembelian/penjualan perusahaan treasury (Strategy, MARA, Strive, BitMine …) dari laporan 8-K mereka ke SEC (dicek tiap 10 menit). Sebelum 8-K terbit, pembelian yang sudah diberitakan (mis. "Strategy buys 250 bitcoin") langsung tampil dengan catatan "Berita: beli" dan diganti data 8-K begitu filing-nya masuk.
        </div>
      )}
    </div>
  );
}
