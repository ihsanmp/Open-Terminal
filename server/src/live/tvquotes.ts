// Symbols' trades as they happen, read off TradingView's quote stream (the one its signed-out
// chart uses): one socket and one quote session for every symbol anybody listens to, opened on
// the first, closed a while after the last leaves, reconnecting when it drops. US listings
// stream in real time; some exchanges come delayed (IDX by ten minutes) — each symbol's status
// says which.
import { parseFrames } from "../providers/tvchart.js";
import { applyUpdate, emptyState, type QuoteState, type QuoteUpdate, type Tick } from "./ticks.js";

const URL = "wss://data.tradingview.com/socket.io/websocket?type=chart";
const HEADERS = { Origin: "https://www.tradingview.com", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const SESSION = "qs_live";
const FIELDS = ["lp", "lp_time", "volume", "rtc", "rtc_time", "bid", "ask", "update_mode", "current_session", "ch", "chp"];
const IDLE_CLOSE_MS = 30_000;

export type LiveStatus = { mode: string | null; session: string | null; delaySeconds: number; price: number | null };
type Listener = { onTick: (t: Tick) => void; onStatus: (s: LiveStatus) => void };
type Watch = { listeners: Set<Listener>; state: QuoteState; status: LiveStatus };

const frame = (m: string, p: unknown[]) => {
  const body = JSON.stringify({ m, p });
  return `~m~${body.length}~m~${body}`;
};

const watches = new Map<string, Watch>();
let ws: WebSocket | null = null;
let ready = false;
let retry = 0;
let idleTimer: NodeJS.Timeout | null = null;

/** "delayed_streaming_600" → 600 seconds; "streaming" → 0. */
export function delayOf(mode: string | null): number {
  const m = /delayed_streaming_(\d+)/.exec(mode ?? "");
  return m ? Number(m[1]) : 0;
}

function send(m: string, p: unknown[]) {
  if (ws && ready) ws.send(frame(m, p));
}

function connect() {
  if (ws) return;
  const socket = new (WebSocket as unknown as new (url: string, opts: unknown) => WebSocket)(URL, { headers: HEADERS });
  ws = socket;
  socket.onopen = () => {
    ready = true;
    retry = 0;
    socket.send(frame("set_auth_token", ["unauthorized_user_token"]));
    socket.send(frame("quote_create_session", [SESSION]));
    socket.send(frame("quote_set_fields", [SESSION, ...FIELDS]));
    // Everything already watched (again, after a reconnect), counting afresh.
    for (const w of watches.values()) w.state = emptyState();
    if (watches.size) socket.send(frame("quote_add_symbols", [SESSION, ...watches.keys()]));
  };
  socket.onmessage = (ev: MessageEvent) => {
    for (const payload of parseFrames(String(ev.data))) {
      if (payload.startsWith("~h~")) {
        socket.send(`~m~${payload.length}~m~${payload}`); // heartbeat echo
        continue;
      }
      let msg: { m?: string; p?: any[] };
      try {
        msg = JSON.parse(payload);
      } catch {
        continue;
      }
      if (msg.m !== "qsd") continue;
      const d = msg.p?.[1] as { n?: string; s?: string; v?: QuoteUpdate & { update_mode?: string; current_session?: string } } | undefined;
      const w = d?.n ? watches.get(d.n) : undefined;
      if (!w || !d?.v || d.s === "error") continue;
      const v = d.v;
      const { state, tick } = applyUpdate(w.state, v, Date.now());
      w.state = state;
      const status: LiveStatus = {
        mode: v.update_mode ?? w.status.mode,
        session: v.current_session ?? w.status.session,
        delaySeconds: delayOf(v.update_mode ?? w.status.mode),
        price: state.price,
      };
      const changed = status.mode !== w.status.mode || status.session !== w.status.session;
      w.status = status;
      for (const l of w.listeners) {
        if (changed) l.onStatus(status);
        if (tick) l.onTick(tick);
      }
    }
  };
  const lost = () => {
    if (ws !== socket) return;
    ws = null;
    ready = false;
    if (!watches.size) return;
    // Back in 1, 2, 4 … up to 30 seconds.
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++)).unref?.();
  };
  socket.onclose = lost;
  socket.onerror = () => {
    try {
      socket.close();
    } catch {
      lost();
    }
  };
}

/** Listen to a symbol's trades (EXCHANGE:TICKER) and status; returns the way to stop. */
export function watch(tvSymbol: string, onTick: (t: Tick) => void, onStatus: (s: LiveStatus) => void): () => void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  let w = watches.get(tvSymbol);
  if (!w) {
    w = { listeners: new Set(), state: emptyState(), status: { mode: null, session: null, delaySeconds: 0, price: null } };
    watches.set(tvSymbol, w);
    if (ws && ready) send("quote_add_symbols", [SESSION, tvSymbol]);
  }
  const listener = { onTick, onStatus };
  w.listeners.add(listener);
  if (w.status.mode) onStatus(w.status);
  connect();
  const watched = w;
  return () => {
    watched.listeners.delete(listener);
    if (watched.listeners.size) return;
    watches.delete(tvSymbol);
    send("quote_remove_symbols", [SESSION, tvSymbol]);
    if (watches.size) return;
    // Nobody listening: the socket goes after a while (a page switching symbols comes right back).
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (watches.size || !ws) return;
      const socket = ws;
      ws = null;
      ready = false;
      socket.close();
    }, IDLE_CLOSE_MS);
    idleTimer.unref?.();
  };
}
