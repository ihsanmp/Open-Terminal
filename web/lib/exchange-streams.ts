// A coin's trades as they happen on several exchanges at once, each from its own public market
// stream: Binance (lib/binance-stream.ts), Bybit, Bitget, Gate, HTX, BingX and Hyperliquid. Each
// is read on the address that answers from where the app runs (Bybit's stream.bybit.kz, Bitget's
// ws.bitgetapi.com: the main ones are blocked by some networks, as Coinbase, OKX and Kraken are
// altogether). One socket per exchange and coin, shared, reconnecting when it drops; an exchange
// that doesn't list the coin simply sends nothing.
import { subscribeTrades, type LiveTrade } from "./binance-stream";

export type ExchangeTrade = LiveTrade & { exchange: string };
/** Each exchange's stream: connected, and whether it has carried a trade of the coin yet. */
export type ExchangeStatus = Record<string, { live: boolean; trading: boolean }>;

type Raw = Record<string, any>;
type Adapter = {
  name: string;
  url: string;
  subscribe: (base: string) => string;
  /** A keep-alive the exchange wants every so often. */
  ping?: { every: number; message: () => string };
  /** An answer the exchange's own ping needs. */
  reply?: (m: Raw | string) => string | null;
  /** Its frames are gzip-compressed. */
  gzip?: boolean;
  parse: (m: Raw, base: string, openedAt: number) => LiveTrade[] | null;
};

const num = Number;

export const ADAPTERS: Adapter[] = [
  {
    name: "Bybit",
    url: "wss://stream.bybit.kz/v5/public/spot",
    subscribe: (b) => JSON.stringify({ op: "subscribe", args: [`publicTrade.${b}USDT`] }),
    ping: { every: 20_000, message: () => JSON.stringify({ op: "ping" }) },
    parse: (m) =>
      typeof m.topic === "string" && m.topic.startsWith("publicTrade.") && Array.isArray(m.data)
        ? m.data.map((d: Raw) => ({ id: num(d.i) || d.T, time: num(d.T), price: num(d.p), qty: num(d.v), buyerMaker: d.S === "Sell" }))
        : null,
  },
  {
    name: "Bitget",
    url: "wss://ws.bitgetapi.com/v2/ws/public",
    subscribe: (b) => JSON.stringify({ op: "subscribe", args: [{ instType: "SPOT", channel: "trade", instId: `${b}USDT` }] }),
    ping: { every: 25_000, message: () => "ping" },
    // The first message is a snapshot of trades already made: only updates are new.
    parse: (m) =>
      m.action === "update" && m.arg?.channel === "trade" && Array.isArray(m.data)
        ? m.data.map((d: Raw) => ({ id: num(d.tradeId), time: num(d.ts), price: num(d.price), qty: num(d.size), buyerMaker: d.side === "sell" }))
        : null,
  },
  {
    name: "Gate",
    url: "wss://api.gateio.ws/ws/v4/",
    subscribe: (b) => JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.trades", event: "subscribe", payload: [`${b}_USDT`] }),
    ping: { every: 20_000, message: () => JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }) },
    parse: (m) => {
      if (m.channel !== "spot.trades" || m.event !== "update" || !m.result) return null;
      const d = m.result;
      return [{ id: num(d.id), time: Math.floor(num(d.create_time_ms)), price: num(d.price), qty: num(d.amount), buyerMaker: d.side === "sell" }];
    },
  },
  {
    name: "HTX",
    url: "wss://api.huobi.pro/ws",
    gzip: true,
    subscribe: (b) => JSON.stringify({ sub: `market.${b.toLowerCase()}usdt.trade.detail`, id: "t" }),
    reply: (m) => (typeof m === "object" && m.ping !== undefined ? JSON.stringify({ pong: m.ping }) : null),
    parse: (m) =>
      typeof m.ch === "string" && m.ch.endsWith(".trade.detail") && Array.isArray(m.tick?.data)
        ? m.tick.data.map((d: Raw) => ({ id: num(d.tradeId), time: num(d.ts), price: num(d.price), qty: num(d.amount), buyerMaker: d.direction === "sell" }))
        : null,
  },
  {
    name: "BingX",
    url: "wss://open-api-ws.bingx.com/market",
    gzip: true,
    subscribe: (b) => JSON.stringify({ id: "t", reqType: "sub", dataType: `${b}-USDT@trade` }),
    reply: (m) => (m === "Ping" ? "Pong" : null),
    parse: (m) => {
      if (typeof m.dataType !== "string" || !m.dataType.endsWith("@trade") || !m.data) return null;
      const d = m.data;
      return [{ id: num(d.t), time: num(d.T), price: num(d.p), qty: num(d.q), buyerMaker: Boolean(d.m) }];
    },
  },
  {
    name: "Hyperliquid",
    url: "wss://api.hyperliquid.xyz/ws",
    subscribe: (b) => JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: b } }),
    ping: { every: 45_000, message: () => JSON.stringify({ method: "ping" }) },
    // Its first message repeats the last trades made: only those after the socket opened are new.
    // "A" is the ask side taking: a seller.
    parse: (m, _b, openedAt) =>
      m.channel === "trades" && Array.isArray(m.data)
        ? m.data
            .filter((d: Raw) => num(d.time) >= openedAt - 1000)
            .map((d: Raw) => ({ id: num(d.tid), time: num(d.time), price: num(d.px), qty: num(d.sz), buyerMaker: d.side === "A" }))
        : null,
  },
];

const FLUSH_MS = 300;

async function frameText(data: unknown, gzip: boolean): Promise<string> {
  if (typeof data === "string") return data;
  const buf = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer);
  if (!gzip) return new TextDecoder().decode(buf);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

type StatusListener = (name: string, live: boolean, trading: boolean) => void;
type Feed = { listeners: Set<(t: ExchangeTrade[]) => void>; status: Set<StatusListener>; state: ExchangeStatus; set: StatusListener; close: () => void };
const feeds = new Map<string, Feed>();

function open(a: Adapter, base: string, feed: Feed): () => void {
  let closed = false;
  let retry = 0;
  let ws: WebSocket | null = null;
  let timer: number | null = null;
  let pinger: number | null = null;
  let trading = false;
  const tell = (live: boolean) => feed.set(a.name, live, trading);
  const connect = () => {
    if (closed) return;
    const socket = new WebSocket(a.url);
    ws = socket;
    socket.binaryType = "arraybuffer";
    let openedAt = Date.now();
    let batch: ExchangeTrade[] = [];
    let flush: number | null = null;
    socket.onopen = () => {
      retry = 0;
      openedAt = Date.now();
      socket.send(a.subscribe(base));
      if (a.ping) pinger = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send(a.ping!.message()), a.ping.every);
      tell(true);
    };
    socket.onmessage = async (e) => {
      let text: string;
      try {
        text = await frameText(e.data, Boolean(a.gzip));
      } catch {
        return;
      }
      let m: Raw | string = text;
      try {
        m = JSON.parse(text);
      } catch {
        // a plain-text ping or pong
      }
      const answer = a.reply?.(m);
      if (answer) socket.send(answer);
      if (typeof m !== "object" || m === null) return;
      const trades = a.parse(m, base, openedAt);
      if (!trades?.length) return;
      const good = trades.filter((t) => t.price > 0 && t.qty > 0 && Number.isFinite(t.time));
      if (!good.length) return;
      if (!trading) {
        trading = true;
        tell(true);
      }
      batch.push(...good.map((t) => ({ ...t, exchange: a.name })));
      flush ??= window.setTimeout(() => {
        flush = null;
        const out = batch;
        batch = [];
        for (const f of feed.listeners) f(out);
      }, FLUSH_MS);
    };
    socket.onclose = () => {
      if (pinger !== null) clearInterval(pinger);
      pinger = null;
      tell(false);
      if (closed) return;
      // Back in 2, 4, 8 … up to 60 seconds (an exchange that's unreachable isn't hammered).
      timer = window.setTimeout(connect, Math.min(60_000, 2000 * 2 ** retry++));
    };
    socket.onerror = () => socket.close();
  };
  connect();
  return () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    if (pinger !== null) clearInterval(pinger);
    ws?.close();
  };
}

/**
 * A coin's trades (its USDT pairs) on every exchange read, as they happen, and each stream's
 * state. Returns the way to stop listening; the sockets close when nobody listens.
 */
export function subscribeExchanges(
  base: string,
  onTrades: (t: ExchangeTrade[]) => void,
  onStatus?: (name: string, live: boolean, trading: boolean) => void
): () => void {
  const key = base.toUpperCase();
  let feed = feeds.get(key);
  if (!feed) {
    const f: Feed = {
      listeners: new Set(),
      status: new Set(),
      state: {},
      set: (name, live, trading) => {
        f.state[name] = { live, trading };
        for (const s of f.status) s(name, live, trading);
      },
      close: () => {},
    };
    let binanceTrading = false;
    const stops = [
      subscribeTrades(
        key,
        (trades) => {
          if (!binanceTrading && trades.length) {
            binanceTrading = true;
            f.set("Binance", true, true);
          }
          const out = trades.map((t) => ({ ...t, exchange: "Binance" }));
          for (const l of f.listeners) l(out);
        },
        (live) => f.set("Binance", live, binanceTrading)
      ),
      ...ADAPTERS.map((a) => open(a, key, f)),
    ];
    f.close = () => stops.forEach((stop) => stop());
    feeds.set(key, f);
    feed = f;
  }
  feed.listeners.add(onTrades);
  if (onStatus) {
    feed.status.add(onStatus);
    for (const [name, st] of Object.entries(feed.state)) onStatus(name, st.live, st.trading);
  }
  const f = feed;
  return () => {
    f.listeners.delete(onTrades);
    if (onStatus) f.status.delete(onStatus);
    if (f.listeners.size === 0) {
      f.close();
      feeds.delete(key);
    }
  };
}
