// A stock's trades as they happen, from the server's relay of TradingView's quote stream
// (/api/live/<symbol>, server-sent events). One stream per symbol, shared by whoever listens,
// closed when the last one leaves; trades are handed over in batches a few times a second.
// US listings come in real time; some exchanges delayed (IDX by ten minutes): the status says.

export type StockTick = { time: number; price: number; size: number; value: number; side: "buy" | "sell"; extended?: true };
export type LiveStatus = { mode: string | null; session: string | null; delaySeconds: number; price: number | null };
export type LiveState = { connected: boolean; ticker: string | null; status: LiveStatus | null; unavailable: boolean };

const FLUSH_MS = 300;

type Feed = {
  es: EventSource | null;
  listeners: Set<(t: StockTick[]) => void>;
  watchers: Set<(s: LiveState) => void>;
  state: LiveState;
};
const feeds = new Map<string, Feed>();

function open(symbol: string, feed: Feed) {
  const es = new EventSource(`/api/live/${encodeURIComponent(symbol)}`);
  feed.es = es;
  let batch: StockTick[] = [];
  let flush: number | null = null;
  const set = (patch: Partial<LiveState>) => {
    feed.state = { ...feed.state, ...patch };
    for (const w of feed.watchers) w(feed.state);
  };
  es.onopen = () => set({ connected: true });
  es.addEventListener("listing", (e) => {
    try {
      set({ ticker: JSON.parse((e as MessageEvent).data).ticker ?? null });
    } catch {}
  });
  es.addEventListener("status", (e) => {
    try {
      set({ status: JSON.parse((e as MessageEvent).data) });
    } catch {}
  });
  es.onmessage = (m) => {
    try {
      batch.push(JSON.parse(m.data));
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
  // The browser reconnects on its own; a stream the server refused (no listing) stays closed.
  es.onerror = () => set(es.readyState === EventSource.CLOSED ? { connected: false, unavailable: true } : { connected: false });
}

/** Trades of a stock (or anything TradingView lists) as they happen, and the stream's state.
 *  Returns the way to stop listening. */
export function subscribeTicks(symbol: string, onTicks: (t: StockTick[]) => void, onState?: (s: LiveState) => void): () => void {
  const key = symbol.toUpperCase();
  let feed = feeds.get(key);
  if (!feed) {
    feed = { es: null, listeners: new Set(), watchers: new Set(), state: { connected: false, ticker: null, status: null, unavailable: false } };
    feeds.set(key, feed);
    open(key, feed);
  }
  feed.listeners.add(onTicks);
  if (onState) {
    feed.watchers.add(onState);
    onState(feed.state);
  }
  const f = feed;
  return () => {
    f.listeners.delete(onTicks);
    if (onState) f.watchers.delete(onState);
    if (f.listeners.size === 0) {
      f.es?.close();
      feeds.delete(key);
    }
  };
}

const SESSIONS: Record<string, string> = {
  market: "pasar buka",
  pre_market: "pra-pasar",
  post_market: "pasca-pasar",
  out_of_session: "pasar tutup",
};

/** The stream's state in a few words: "LIVE · pasar buka", "tertunda 10 mnt · pasar tutup". */
export function liveLabel(s: LiveState): { text: string; live: boolean } {
  if (s.unavailable) return { text: "stream tidak tersedia", live: false };
  if (!s.connected || !s.status) return { text: "menyambung…", live: false };
  const session = SESSIONS[s.status.session ?? ""] ?? s.status.session ?? "";
  const delay = s.status.delaySeconds;
  const head = delay > 0 ? `TERTUNDA ${Math.round(delay / 60)} MNT` : "LIVE";
  return { text: session ? `${head} · ${session}` : head, live: delay === 0 };
}
