"use client";

import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useDeferredValue, useEffect, useState } from "react";
import { bigTradeFloor } from "../../lib/binance-stream";
import { ADAPTERS, subscribeExchanges, type ExchangeStatus } from "../../lib/exchange-streams";
import { apiGet, fmt, fmtBig, fmtPrice } from "../../lib/api";
import { liveLabel, subscribeTicks, type LiveState } from "../../lib/live-ticks";
import { usePoll } from "../../lib/refresh";
import { useWidgetSetting } from "../../store/terminal";

// An asset's transactions, newest first, each from whom to whom (server: providers/transfers.ts):
// a Bitcoin transfer between named wallets, a big trade on Binance, a US insider's trade, and the
// big institutions' buys and sales (spot ETFs' daily flows, treasury companies' 8-K reports).
// A coin gets its big trades as they happen from the exchanges' own streams (Binance, Bybit,
// Bitget, Gate, HTX, BingX, Hyperliquid: lib/exchange-streams.ts); a stock its
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
  /** An on-chain transfer's every sending address, and where it went. */
  inputs?: string[];
  outputs?: Array<{ address: string; amount: number }>;
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

/** Where an address is looked at: Etherscan for Ethereum, mempool.space for Bitcoin. */
const explorerOf = (address: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(address) ? `https://etherscan.io/address/${address}` : `https://mempool.space/address/${address}`;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="term-btn !px-1.5 !py-0 shrink-0"
      title="Salin alamat"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "✓ disalin" : "salin"}
    </button>
  );
}

/** One address in full, to copy or open. */
function AddressLine({ address, name, amount, unit }: { address: string; name?: string | null; amount?: number; unit?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 min-w-0">
      {name && <span className="text-[var(--text)] shrink-0">{name}</span>}
      <span className="font-mono select-all break-all min-w-0 flex-1">{address}</span>
      {amount !== undefined && (
        <span className="dim tabular-nums shrink-0">
          {fmt(amount, amount >= 100 ? 0 : 4)} {unit}
        </span>
      )}
      <CopyButton text={address} />
      <a href={explorerOf(address)} target="_blank" rel="noreferrer" className="term-btn !px-1.5 !py-0 shrink-0" title="Buka alamat di explorer" onClick={(e) => e.stopPropagation()}>
        ↗
      </a>
    </div>
  );
}

/** Why a side has no wallet address to show. */
function noAddressReason(r: Row, p: Party): string {
  if (r.category === "exchange") return `Transaksi di order book ${r.to.name ?? "exchange"}: terjadi di dalam exchange, tidak ada alamat wallet on-chain.`;
  if (r.category === "tape" || r.category === "insider") return "Transaksi saham: tidak ada wallet.";
  if (p.tag === "etf") return "Arus ETF dilaporkan harian (Farside); alamat kustodian ETF tidak dipublikasikan per transaksi.";
  if (p.tag === "treasury" || p.tag === "news") return "Dilaporkan lewat 8-K/berita; perusahaan tidak menyebutkan alamat wallet-nya.";
  if (p.name === "Pasar") return "Lawan transaksinya pasar (banyak pihak), bukan satu wallet.";
  return "Alamat tidak tersedia.";
}

/** The named holder's wallets the app knows (its exchange's cold wallets, a watched whale). */
function knownOf(p: Party, wallets: Wallet[] | undefined): Wallet[] {
  if (!p.name || !wallets?.length) return [];
  const base = p.name.replace(/\s*\(.*\)$/, "").toLowerCase();
  return wallets.filter((w) => w.name.toLowerCase() === base || w.name.toLowerCase().startsWith(`${base} `));
}

function SideDetail({ label, r, p, addresses, known }: { label: string; r: Row; p: Party; addresses: Array<{ address: string; amount?: number }>; known: Wallet[] }) {
  return (
    <div className="min-w-0">
      <div className="dim text-fs-10 uppercase tracking-wider mb-0.5">
        {label}: <span className="normal-case text-[var(--text)]">{p.name ?? "Tidak diketahui"}</span>
        {p.role && <span className="normal-case"> · {p.role}</span>}
      </div>
      {addresses.length > 0 ? (
        addresses.map((a) => <AddressLine key={a.address} address={a.address} name={a.address === p.address ? p.name : null} amount={a.amount} unit={r.unit} />)
      ) : (
        <div className="dim">{noAddressReason(r, p)}</div>
      )}
      {addresses.length === 0 && known.length > 0 && (
        <div className="mt-1">
          <div className="dim text-fs-10">Wallet {p.name} yang dikenali (bukan alamat transaksi ini):</div>
          {known.slice(0, 8).map((w) => (
            <AddressLine key={w.address} address={w.address} name={w.name} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A transaction opened: both sides' wallet addresses in full, and where to look it up. */
function TxDetail({ r, wallets }: { r: Row; wallets: Wallet[] | undefined }) {
  const fromAddresses = r.inputs?.length ? r.inputs.map((address) => ({ address })) : r.from.address ? [{ address: r.from.address }] : [];
  const toAddresses = r.outputs?.length ? r.outputs : r.to.address ? [{ address: r.to.address }] : [];
  return (
    <div className="px-3 py-2 bg-[#121212] border-b border-[var(--border)] grid gap-2 md:grid-cols-2 text-fs-11 cursor-default" onClick={(e) => e.stopPropagation()}>
      <SideDetail label="Dari" r={r} p={r.from} addresses={fromAddresses} known={knownOf(r.from, wallets)} />
      <SideDetail label="Ke" r={r} p={r.to} addresses={toAddresses} known={knownOf(r.to, wallets)} />
      <div className="md:col-span-2 flex gap-3 flex-wrap dim text-fs-10">
        <span>{FULL_TIME.format(r.time * 1000)}</span>
        {r.source && <span>sumber: {r.source}</span>}
        {r.link && (
          <a href={r.link} target="_blank" rel="noreferrer" className="amber hover:underline">
            {r.category === "onchain" ? "Buka transaksi di mempool.space ↗" : r.category === "whale" ? "Buka transaksi di Etherscan ↗" : "Buka sumbernya ↗"}
          </a>
        )}
      </div>
    </div>
  );
}

const FULL_TIME = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "medium" });

/** One transaction's row; drawn again only when it or the minute-ish clock changes. A click opens
 *  it: both sides' wallet addresses in full. */
const TxRow = memo(function TxRow({ r, now, open, onToggle, wallets }: { r: Row; now: number; open: boolean; onToggle: (id: string) => void; wallets?: Wallet[] }) {
  const color = r.side === "sell" ? "down" : r.side === "buy" ? "up" : "text-[var(--text)]";
  const value = r.usd === null ? "—" : r.currency ? `${r.currency} ${fmtBig(r.usd)}` : `$${fmtBig(r.usd)}`;
  const body = (
    <>
      <span className="w-[96px] max-sm:w-auto shrink-0 text-[#5b9cf6] tabular-nums whitespace-nowrap" title={FULL_TIME.format(r.time * 1000)}>
        {ago(r.time, now)}
      </span>
      <span className="flex-1 min-w-0 max-sm:basis-full max-sm:order-first grid grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)] gap-2 items-baseline">
        <PartyCell p={r.from} />
        <span className="dim">→</span>
        <PartyCell p={r.to} />
      </span>
      <span
        className={`text-fs-9 shrink-0 w-[34px] text-center border ${r.side === "buy" ? "up border-[var(--up)]" : r.side === "sell" ? "down border-[var(--down)]" : "dim border-[#333]"}`}
        title={r.side === "buy" ? "Inflow: uang masuk ke aset ini" : r.side === "sell" ? "Outflow: uang keluar dari aset ini" : "Transfer antar wallet: bukan beli atau jual"}
      >
        {r.side === "buy" ? "IN" : r.side === "sell" ? "OUT" : "—"}
      </span>
      {r.note && <span className="dim text-fs-10 shrink-0 w-[110px] max-sm:w-auto truncate" title={r.note}>{r.note}</span>}
      {r.side && !r.note && <span className={`${color} text-fs-10 shrink-0 w-[40px] max-sm:w-auto uppercase`}>{r.side === "buy" ? "beli" : "jual"}</span>}
      <span className={`${color} shrink-0 w-[110px] max-sm:w-auto max-sm:ml-auto text-right tabular-nums ${r.big ? "font-bold" : ""}`}>
        {r.category === "tape" && r.amount === 0 ? "—" : r.amount >= 1000 ? fmtBig(r.amount) : fmt(r.amount, r.amount >= 100 || r.category === "tape" ? 0 : 2)} <span className="dim">{r.unit}</span>
      </span>
      {r.price !== undefined && <span className="dim shrink-0 w-[84px] max-sm:w-auto text-right tabular-nums">{r.price ? `@ ${fmtPrice(r.price)}` : ""}</span>}
      <span className={`shrink-0 w-[84px] max-sm:w-auto text-right tabular-nums ${r.big ? "amber font-bold" : "text-[var(--text)]"}`}>{value}</span>
    </>
  );
  const cls = `flex items-baseline gap-3 max-sm:flex-wrap max-sm:gap-y-0.5 px-2 py-1.5 border-b border-[#161616] cursor-pointer select-none ${open ? "bg-[#1f1a10]" : "hover:bg-[#161616]"}`;
  return (
    <>
      <div
        role="button"
        aria-expanded={open}
        className={cls}
        title={open ? "Klik untuk menutup" : r.source ? `Belum ada 8-K: dari berita — ${r.source}. Klik untuk detail` : "Klik untuk melihat alamat wallet"}
        onClick={() => onToggle(r.id)}
      >
        {body}
      </div>
      {open && <TxDetail r={r} wallets={wallets} />}
    </>
  );
});

const OWN_LABEL: Record<Category, string> = { onchain: "ON-CHAIN", exchange: "EXCHANGE", insider: "INSIDER", institution: "INSTITUSI", whale: "WHALE", tape: "REAL-TIME" };

const PAGE = 150;
const isCoin = (symbol: string) => /-USDT?$/.test(symbol.toUpperCase());
const EXCHANGES = ["Binance", ...ADAPTERS.map((a) => a.name)];

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
        for (const t of ticks) if (t.value > 0) recent.push(t.value);
        if (recent.length > 1000) recent.splice(0, recent.length - 1000);
        const floor = recent.length >= 50 ? bigTradeFloor(recent, 0) : Infinity;
        for (const t of ticks) {
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
            big: t.value >= floor,
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

export default memo(function TransfersList({ symbol, currency }: { symbol: string; currency?: string }) {
  const poll = usePoll(15_000);
  const [only, setOnly] = useWidgetSetting<"all" | Category>("txFilter", "all");
  const [flow, setFlow] = useWidgetSetting<"both" | "in" | "out">("txFlow", "both");
  const [venue, setVenue] = useWidgetSetting<string>("txExchange", "all");
  // The filters answer at once: the button shows the choice now, the list follows (deferred), and
  // the choice is saved with the widget just after.
  const [flowNow, setFlowNow] = useState(flow);
  useEffect(() => setFlowNow(flow), [flow]);
  const pickFlow = (f: "both" | "in" | "out") => {
    setFlowNow(f);
    setTimeout(() => setFlow(f), 0);
  };
  const flowShown = useDeferredValue(flowNow);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(id);
  }, []);
  const [limit, setLimit] = useState(PAGE);
  // The row opened (its wallet addresses shown); one at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const toggleRow = useCallback((id: string) => setOpenId((o) => (o === id ? null : id)), []);
  // The kind and exchange chosen are deferred too: their buttons light at once, the list after.
  const onlyShown = useDeferredValue(only);
  const venueShown = useDeferredValue(venue);
  useEffect(() => setLimit(PAGE), [flowShown, onlyShown, venueShown, symbol]);
  const { data, error, isLoading } = useQuery({
    queryKey: ["transfers", symbol],
    queryFn: () => apiGet<Transfers>(`/api/transfers/${encodeURIComponent(symbol)}`),
    refetchInterval: poll,
  });

  const tape = useTape(symbol, currency);
  const tapeOn = tape.state !== null && !tape.state.unavailable;

  // A coin: its big trades on the exchanges, from their streams, as they happen.
  const base = isCoin(symbol) ? /^([A-Z0-9]{1,20})-USDT?$/.exec(symbol.toUpperCase())?.[1] ?? null : null;
  const [liveRows, setLiveRows] = useState<Row[]>([]);
  const [streams, setStreams] = useState<ExchangeStatus>({});
  useEffect(() => {
    setLiveRows([]);
    setStreams({});
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
    // The biggest across all the exchanges: the top 2% of the latest trades' values.
    const stop = subscribeExchanges(
      base,
      (trades) => {
        for (const t of trades) recent.push(t.price * t.qty);
        if (recent.length > 3000) recent.splice(0, recent.length - 3000);
        if (recent.length < 200) return;
        const floor = bigTradeFloor(recent);
        for (const t of trades) {
          const usd = t.price * t.qty;
          if (usd < floor) continue;
          const side = t.buyerMaker ? "sell" : "buy";
          pending.push({
            // Binance's as the server lists them (its aggregate trade ids), so they're listed once.
            id: t.exchange === "Binance" ? String(t.id) : `${t.exchange}-${t.id}`,
            category: "exchange",
            time: Math.floor(t.time / 1000),
            from: { name: side === "buy" ? "Pembeli" : "Penjual", address: null, role: "taker" },
            to: { name: t.exchange, address: null, role: t.exchange === "Hyperliquid" ? `${base} perp` : `${base}/USDT` },
            amount: t.qty,
            unit: base,
            usd,
            side,
            price: t.price,
          });
        }
      },
      (name, live, trading) => setStreams((s) => ({ ...s, [name]: { live, trading } }))
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
  const byKind = onlyShown === "all" || !kinds.includes(onlyShown) ? rows : rows.filter((r) => r.category === onlyShown);
  // Under EXCHANGE, one exchange's alone.
  const exchangesListed = onlyShown === "exchange" ? [...new Set(byKind.map((r) => r.to.name ?? r.from.name).filter((n): n is string => Boolean(n) && EXCHANGES.includes(n!)))] : [];
  const ofKind = onlyShown === "exchange" && venueShown !== "all" && exchangesListed.includes(venueShown) ? byKind.filter((r) => r.to.name === venueShown || r.from.name === venueShown) : byKind;
  // Inflow (bought, taken into holding) and outflow (sold, sent to be sold), each on its own or both.
  const inflows = ofKind.filter((r) => r.side === "buy");
  const outflows = ofKind.filter((r) => r.side === "sell");
  const shown = flowShown === "in" ? inflows : flowShown === "out" ? outflows : ofKind;
  // A long list is drawn a page at a time.
  const visible = shown.length > limit ? shown.slice(0, limit) : shown;
  // The totals in dollars; a stock's rupiah can't be added to them, so a list in one currency sums in it.
  const currencyOf = ofKind.find((r) => r.currency)?.currency;
  const sum = (list: Row[]) => list.reduce((a, r) => a + (r.usd ?? 0), 0);
  const total = (v: number) => (currencyOf ? `${currencyOf} ${fmtBig(v)}` : `$${fmtBig(v)}`);
  const inTotal = sum(inflows);
  const outTotal = sum(outflows);

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
      {exchangesListed.length > 1 && (
        <div className="flex gap-1 flex-wrap items-center">
          <span className="dim text-fs-10 mr-1">EXCHANGE</span>
          <button className={`term-btn ${venue === "all" || !exchangesListed.includes(venue) ? "active" : ""}`} onClick={() => setVenue("all")}>
            SEMUA
          </button>
          {EXCHANGES.filter((n) => exchangesListed.includes(n)).map((n) => (
            <button key={n} className={`term-btn ${venue === n ? "active" : ""}`} onClick={() => setVenue(n)}>
              {n} <span className="dim">{byKind.filter((r) => r.to.name === n || r.from.name === n).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1 flex-wrap items-center">
        <span className="dim text-fs-10 mr-1">ARAH</span>
        <button className={`term-btn ${flowNow === "both" ? "active" : ""}`} onClick={() => pickFlow("both")} title="Inflow dan outflow">
          IN + OUT
        </button>
        <button className={`term-btn ${flowNow === "in" ? "active" : ""}`} onClick={() => pickFlow("in")} title="Uang masuk: beli, ETF inflow, koin ditarik dari exchange untuk disimpan">
          <span className="up">▲ INFLOW</span> <span className="dim">{inflows.length}</span>
        </button>
        <button className={`term-btn ${flowNow === "out" ? "active" : ""}`} onClick={() => pickFlow("out")} title="Uang keluar: jual, ETF outflow, koin disetor ke exchange untuk dijual">
          <span className="down">▼ OUTFLOW</span> <span className="dim">{outflows.length}</span>
        </button>
        {inTotal + outTotal > 0 && (
          <span className="text-fs-10 ml-2 tabular-nums">
            <span className="up">masuk {total(inTotal)}</span> <span className="dim">·</span> <span className="down">keluar {total(outTotal)}</span>{" "}
            <span className="dim">·</span> <span className={inTotal >= outTotal ? "up" : "down"}>net {inTotal >= outTotal ? "+" : "-"}{total(Math.abs(inTotal - outTotal))}</span>
          </span>
        )}
      </div>
      {(only === "institution" || only === "whale") && kinds.includes(only) && data?.wallets && data.wallets.length > 0 && <WalletDirectory wallets={data.wallets} />}
      <div className="dim text-fs-10">
        {shown.length} transaksi{data && kind !== "none" ? ` · sumber: ${data.source}` : ""}
        {tapeLabel && (
          <span className="ml-2" title="Stream TradingView: tiap kenaikan volume harian dihitung satu transaksi pada harga terakhir; sisi beli/jual dibaca dari bid/ask. Di luar jam reguler hanya harga yang tersedia (ukuran tidak diketahui).">
            <span className={tapeLabel.live ? "up" : "amber"}>●</span> {tapeLabel.text} · {tape.state?.ticker}
          </span>
        )}
        {base && (
          <span className="ml-2" title="Transaksi besar (2% terbesar, minimal $10.000) dari stream publik tiap exchange. Hijau: tersambung dan ada transaksi koin ini; kuning: menyambung; abu-abu: tersambung tapi koin ini tidak diperdagangkan di sana (atau belum ada transaksi). Coinbase, OKX dan Kraken diblokir di jaringan ini.">
            LIVE:{" "}
            {EXCHANGES.map((name) => {
              const st = streams[name];
              return (
                <span key={name} className="mr-1.5 whitespace-nowrap">
                  <span className={st?.live && st.trading ? "up" : st?.live ? "dim" : "amber"}>●</span> {name}
                </span>
              );
            })}
          </span>
        )}
      </div>
      {rows.length > 0 && shown.length === 0 && <div className="dim">Tidak ada {flowShown === "in" ? "inflow" : "outflow"} di daftar ini.</div>}
      {rows.length === 0 && (
        <div className="dim">{kind === "exchange" ? "Belum ada transaksi besar yang terekam; daftar ini terisi selama halaman terbuka." : "Belum ada transaksi."}</div>
      )}
      <div className="border border-[var(--border)]">
        {visible.map((r) => (
          <TxRow key={r.id} r={r} now={now} open={openId === r.id} onToggle={toggleRow} wallets={openId === r.id ? data?.wallets : undefined} />
        ))}
      </div>
      {shown.length > visible.length && (
        <button className="term-btn self-start" onClick={() => setLimit((l) => l + PAGE)}>
          Tampilkan {Math.min(PAGE, shown.length - visible.length)} lagi <span className="dim">({shown.length - visible.length} tersisa)</span>
        </button>
      )}
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
});
