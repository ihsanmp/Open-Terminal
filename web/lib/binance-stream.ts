// A coin's trades as they happen on Binance, from its market-data stream
// (data-stream.binance.vision: the official mirror, reachable where api.binance.com and
// stream.binance.com are blocked). One socket per coin, shared by whoever listens, reconnecting
// when it drops; trades are handed over in batches a few times a second.

export type LiveTrade = { id: number; time: number; price: number; qty: number; buyerMaker: boolean };

const STREAM = "wss://data-stream.binance.vision/ws";
const FLUSH_MS = 300;

type Feed = { ws: WebSocket | null; listeners: Set<(t: LiveTrade[]) => void>; status: Set<(live: boolean) => void>; live: boolean; retry: number; timer: number | null; closed: boolean };
const feeds = new Map<string, Feed>();

function open(base: string, feed: Feed) {
  if (feed.closed) return;
  const ws = new WebSocket(`${STREAM}/${base.toLowerCase()}usdt@aggTrade`);
  feed.ws = ws;
  let batch: LiveTrade[] = [];
  let flush: number | null = null;
  const setLive = (live: boolean) => {
    if (feed.live === live) return;
    feed.live = live;
    for (const f of feed.status) f(live);
  };
  ws.onopen = () => {
    feed.retry = 0;
    setLive(true);
  };
  ws.onmessage = (m) => {
    try {
      const d = JSON.parse(String(m.data));
      batch.push({ id: d.a, time: d.T, price: Number(d.p), qty: Number(d.q), buyerMaker: Boolean(d.m) });
    } catch {
      return;
    }
    flush ??= window.setTimeout(() => {
      flush = null;
      const out = batch;
      batch = [];
      for (const f of feed.listeners) f(out);
    }, FLUSH_MS);
  };
  ws.onclose = () => {
    setLive(false);
    if (feed.closed) return;
    // Back again in 1, 2, 4 … up to 30 seconds.
    const wait = Math.min(30_000, 1000 * 2 ** feed.retry++);
    feed.timer = window.setTimeout(() => open(base, feed), wait);
  };
  ws.onerror = () => ws.close();
}

/** Trades of a coin (its USDT pair) as they happen, and whether the stream is up. Returns the
 *  way to stop listening; the socket closes when nobody listens. */
export function subscribeTrades(base: string, onTrades: (t: LiveTrade[]) => void, onStatus?: (live: boolean) => void): () => void {
  const key = base.toUpperCase();
  let feed = feeds.get(key);
  if (!feed) {
    feed = { ws: null, listeners: new Set(), status: new Set(), live: false, retry: 0, timer: null, closed: false };
    feeds.set(key, feed);
    open(key, feed);
  }
  feed.listeners.add(onTrades);
  if (onStatus) {
    feed.status.add(onStatus);
    onStatus(feed.live);
  }
  const f = feed;
  return () => {
    f.listeners.delete(onTrades);
    if (onStatus) f.status.delete(onStatus);
    if (f.listeners.size === 0) {
      f.closed = true;
      if (f.timer !== null) clearTimeout(f.timer);
      f.ws?.close();
      feeds.delete(key);
    }
  };
}

// ---------------------------------------------------------------- money flow, kept up to date

export type FlowBar = { time: number; inflow: number; outflow: number };
export type FlowPeriod = { period: string; interval: string; bars: FlowBar[]; inflow: number; outflow: number; net: number; buyShare: number | null; error: string | null };

const BINANCE_SECONDS: Record<string, number> = { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800 };
const MONDAY = 4 * 86_400; // the Unix epoch was a Thursday; Binance's weeks start on Monday

/** The start of the bar a moment falls in (unix seconds), for a Binance interval. */
export function barStart(timeSec: number, interval: string): number | null {
  const len = BINANCE_SECONDS[interval];
  if (!len) return null;
  if (interval === "1w") return Math.floor((timeSec - MONDAY) / len) * len + MONDAY;
  return Math.floor(timeSec / len) * len;
}

/**
 * The periods with the trades made since they were read (after `asOf`, ms) added: a taker buy's
 * value to its bar's inflow, a taker sell's to its outflow, a new bar begun when a trade falls
 * past the last.
 */
export function withTrades(periods: FlowPeriod[], trades: LiveTrade[], asOf: number): FlowPeriod[] {
  const fresh = trades.filter((t) => t.time > asOf);
  if (!fresh.length) return periods;
  return periods.map((p) => {
    if (p.error || !BINANCE_SECONDS[p.interval]) return p;
    const bars = p.bars.map((b) => ({ ...b }));
    let inflow = p.inflow;
    let outflow = p.outflow;
    for (const t of fresh) {
      const start = barStart(Math.floor(t.time / 1000), p.interval)!;
      const value = t.price * t.qty;
      let bar = bars.length && bars[bars.length - 1].time === start ? bars[bars.length - 1] : bars.find((b) => b.time === start);
      if (!bar) {
        if (bars.length && start < bars[bars.length - 1].time) continue;
        bar = { time: start, inflow: 0, outflow: 0 };
        bars.push(bar);
      }
      if (t.buyerMaker) {
        bar.outflow += value;
        outflow += value;
      } else {
        bar.inflow += value;
        inflow += value;
      }
    }
    const total = inflow + outflow;
    return { ...p, bars, inflow, outflow, net: inflow - outflow, buyShare: total > 0 ? inflow / total : null };
  });
}

/** The value a trade needs to count as a big one: the top 2% of those seen lately, and at least
 *  $10,000 (the server's rule for its list). */
export function bigTradeFloor(recentValues: readonly number[]): number {
  if (!recentValues.length) return 10_000;
  const sorted = [...recentValues].sort((a, b) => a - b);
  return Math.max(10_000, sorted[Math.floor(sorted.length * 0.98)] ?? 0);
}
