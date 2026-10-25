// Recent bars for any TradingView symbol (EXCHANGE:TICKER) from TradingView's own chart
// feed — what Pine's request.security("BINANCE:BTCUSDT", timeframe, ...) reads. Used by the
// charts' history and by indicators that compare the same ticker across exchanges or brokers.
//
// A chart session per symbol, as the public chart does for a signed-out visitor, over websockets
// kept open and shared: opening one (TLS, the handshake, the token) cost ~0.5 s a request, as much
// as many requests themselves. A socket idle for a minute is closed; one that dies mid-request has
// its requests asked again once on a fresh socket. Symbols an exchange doesn't list come back as
// null, like ignore_invalid_symbol = true.

export type TvBar = { time: number; open: number; high: number; low: number; close: number; volume: number | null };

const URL = "wss://data.tradingview.com/socket.io/websocket?type=chart";
const HEADERS = { Origin: "https://www.tradingview.com", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

export const SYMBOL_RE = /^[A-Z0-9_]{1,24}:[A-Z0-9._!\-]{1,40}$/;
export const RESOLUTION_RE = /^(\d{1,4}|\d{0,2}[DWM])$/;

const frame = (m: string, p: unknown[]) => {
  const body = JSON.stringify({ m, p });
  return `~m~${body.length}~m~${body}`;
};

/** Splits one websocket message into its ~m~len~m~ payloads. */
export function parseFrames(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const m = /^~m~(\d+)~m~/.exec(raw.slice(i));
    if (!m) break;
    const start = i + m[0].length;
    const len = Number(m[1]);
    out.push(raw.slice(start, start + len));
    i = start + len;
  }
  return out;
}

// ---------------------------------------------------------------- the shared sockets

/** At most this many sockets to TradingView, each carrying at most this many requests at once. */
const MAX_SOCKETS = 3;
const PER_SOCKET = 6;
const IDLE_MS = 60_000;
/** How long a socket may take to open (it takes ~0.5 s). */
const CONNECT_MS = 10_000;

type Msg = { m?: string; p?: any[] };

class Conn {
  ws: WebSocket;
  ready: Promise<boolean>;
  alive = true;
  inflight = 0;
  lastUsed = Date.now();
  /** When anything last came in (TradingView's heartbeat is every ~10 s). */
  lastMsg = Date.now();
  /** By chart session: what to do with its messages, and with the socket's end. */
  sessions = new Map<string, { onMsg: (msg: Msg) => void; onClose: () => void }>();

  constructor() {
    // Node's WebSocket (undici) takes request headers in its options object.
    this.ws = new (WebSocket as unknown as new (url: string, opts: unknown) => WebSocket)(URL, { headers: HEADERS });
    this.ready = new Promise((resolve) => {
      // A connection that stalls while opening would hold its requests (and their room on the
      // socket) for good, and every chart after them would wait: it is given up instead.
      const stalled = setTimeout(() => end(), CONNECT_MS);
      this.ws.onopen = () => {
        clearTimeout(stalled);
        this.ws.send(frame("set_auth_token", ["unauthorized_user_token"]));
        resolve(true);
      };
      const end = () => {
        clearTimeout(stalled);
        resolve(false);
        this.close();
      };
      this.ws.onerror = end;
      this.ws.onclose = end;
    });
    this.ws.onmessage = (ev: MessageEvent) => {
      this.lastMsg = Date.now();
      for (const payload of parseFrames(String(ev.data))) {
        if (payload.startsWith("~h~")) {
          this.send(`~m~${payload.length}~m~${payload}`); // heartbeat echo
          continue;
        }
        let msg: Msg;
        try {
          msg = JSON.parse(payload);
        } catch {
          continue;
        }
        const session = msg.p?.[0];
        if (typeof session === "string") this.sessions.get(session)?.onMsg(msg);
      }
    };
  }

  send(data: string): void {
    try {
      this.ws.send(data);
    } catch {
      this.close();
    }
  }

  close(): void {
    if (!this.alive) return;
    this.alive = false;
    const i = pool.indexOf(this);
    if (i >= 0) pool.splice(i, 1);
    // Room for whoever waits on a socket.
    waiting.shift()?.();
    for (const s of [...this.sessions.values()]) s.onClose();
    this.sessions.clear();
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

const pool: Conn[] = [];
const waiting: Array<() => void> = [];
let sessionSeq = 0;

/** A socket with room for a request: the least busy open one, a new one, or a wait for room. */
async function connection(): Promise<Conn> {
  for (;;) {
    const open = pool.filter((c) => c.alive && c.inflight < PER_SOCKET).sort((a, b) => a.inflight - b.inflight)[0];
    if (open) return open;
    if (pool.length < MAX_SOCKETS) {
      const c = new Conn();
      pool.push(c);
      return c;
    }
    await new Promise<void>((r) => waiting.push(r));
  }
}

/**
 * Opens a socket ahead of the first request (the app's first chart comes right after the server
 * starts, and opening one costs ~0.5 s). Closed like any other if nothing uses it for a minute.
 */
export function warm(): void {
  if (!pool.some((c) => c.alive)) pool.push(new Conn());
}

// Sockets idle for a minute are closed (TradingView would drop them in time anyway).
setInterval(() => {
  for (const c of [...pool]) if (c.inflight === 0 && Date.now() - c.lastUsed > IDLE_MS) c.close();
}, 15_000).unref();

/** One symbol's bars over a shared socket; `retry` once on a fresh socket when the socket dies first. */
async function seriesOnce(symbol: string, resolution: string, count: number, timeoutMs: number): Promise<{ bars: TvBar[] | null; died: boolean }> {
  const conn = await connection();
  conn.inflight++;
  conn.lastUsed = Date.now();
  const cs = `cs_${++sessionSeq}`;
  try {
    if (!(await conn.ready)) return { bars: null, died: true };
    return await new Promise((resolve) => {
      const collected: TvBar[] = [];
      let done = false;
      const finish = (bars: TvBar[] | null, died = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        conn.sessions.delete(cs);
        if (conn.alive) conn.send(frame("chart_delete_session", [cs]));
        resolve({ bars, died });
      };
      const timer = setTimeout(() => finish(collected.length ? collected.sort((a, b) => a.time - b.time) : null), timeoutMs);
      conn.sessions.set(cs, {
        onMsg: (msg) => {
          if (msg.m === "timescale_update") {
            const rows: Array<{ v: number[] }> = msg.p?.[1]?.sds_1?.s ?? [];
            for (const { v } of rows) collected.push({ time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: Number.isFinite(v[5]) ? v[5] : null });
          } else if (msg.m === "series_completed") finish(collected.sort((a, b) => a.time - b.time));
          else if (msg.m === "symbol_error" || msg.m === "series_error") finish(null);
        },
        onClose: () => finish(collected.length ? collected.sort((a, b) => a.time - b.time) : null, collected.length === 0),
      });
      conn.send(frame("chart_create_session", [cs, ""]));
      conn.send(frame("resolve_symbol", [cs, "sds_sym_1", "=" + JSON.stringify({ symbol, adjustment: "splits" })]));
      conn.send(frame("create_series", [cs, "sds_1", "s1", "sds_sym_1", resolution, count, ""]));
    });
  } finally {
    conn.inflight--;
    conn.lastUsed = Date.now();
    waiting.shift()?.();
  }
}

// ---------------------------------------------------------------- live series

/**
 * A chart kept open: TradingView pushes its bars as they change ("du"), so a chart's refresh reads
 * them instead of asking again (a request costs two round trips, ~120 ms). Opened on a socket of
 * its own for each one read, closed three minutes after its last read.
 */
type Live = { bars: Map<number, TvBar>; cs: string; conn: Conn; ready: boolean; dead: boolean; lastRead: number };
const lives = new Map<string, Live>();
const LIVE_IDLE_MS = 3 * 60_000;
const MAX_LIVE = 40;
/** A socket silent this long (no heartbeat) is taken for dead. */
const SILENT_MS = 45_000;
let liveConn: Conn | null = null;

const rowsOf = (msg: Msg): TvBar[] =>
  ((msg.p?.[1]?.sds_1?.s ?? []) as Array<{ v: number[] }>).map(({ v }) => ({ time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: Number.isFinite(v[5]) ? v[5] : null }));

function dropLive(key: string, l: Live): void {
  lives.delete(key);
  l.dead = true;
  l.conn.sessions.delete(l.cs);
  if (l.conn.alive) l.conn.send(frame("chart_delete_session", [l.cs]));
}

function openLive(symbol: string, resolution: string): Live {
  if (!liveConn || !liveConn.alive || Date.now() - liveConn.lastMsg > SILENT_MS) {
    liveConn?.close();
    liveConn = new Conn();
  }
  const conn = liveConn;
  const l: Live = { bars: new Map(), cs: `cl_${++sessionSeq}`, conn, ready: false, dead: false, lastRead: Date.now() };
  conn.sessions.set(l.cs, {
    onMsg: (msg) => {
      if (msg.m === "timescale_update" || msg.m === "du") for (const b of rowsOf(msg)) l.bars.set(b.time, b);
      else if (msg.m === "series_completed") l.ready = true;
      else if (msg.m === "symbol_error" || msg.m === "series_error") l.dead = true;
    },
    onClose: () => (l.dead = true),
  });
  void conn.ready.then((ok) => {
    if (!ok || l.dead) return;
    conn.send(frame("chart_create_session", [l.cs, ""]));
    conn.send(frame("resolve_symbol", [l.cs, "sds_sym_1", "=" + JSON.stringify({ symbol, adjustment: "splits" })]));
    // A few bars back: enough to join the history a refresh already holds.
    conn.send(frame("create_series", [l.cs, "sds_1", "s1", "sds_sym_1", resolution, 10, ""]));
  });
  return l;
}

/**
 * The bars a live chart of `symbol` holds (its last ten and every one since it opened), or null
 * until it has them; the first call opens it. Reading keeps it open.
 */
export function liveBars(symbol: string, resolution: string): TvBar[] | null {
  const key = `${symbol}|${resolution}`;
  let l = lives.get(key);
  if (l && (l.dead || !l.conn.alive || Date.now() - l.conn.lastMsg > SILENT_MS)) {
    dropLive(key, l);
    l = undefined;
  }
  if (!l) {
    if (lives.size >= MAX_LIVE) {
      const oldest = [...lives].sort((a, b) => a[1].lastRead - b[1].lastRead)[0];
      if (oldest) dropLive(oldest[0], oldest[1]);
    }
    lives.set(key, openLive(symbol, resolution));
    return null;
  }
  l.lastRead = Date.now();
  return l.ready && l.bars.size ? [...l.bars.values()].sort((a, b) => a.time - b.time) : null;
}

setInterval(() => {
  for (const [key, l] of [...lives]) if (Date.now() - l.lastRead > LIVE_IDLE_MS) dropLive(key, l);
  if (!lives.size && liveConn) {
    liveConn.close();
    liveConn = null;
  }
}, 30_000).unref();

async function series(symbol: string, resolution: string, count: number, timeoutMs: number): Promise<TvBar[] | null> {
  const first = await seriesOnce(symbol, resolution, count, timeoutMs);
  if (!first.died) return first.bars;
  return (await seriesOnce(symbol, resolution, count, timeoutMs)).bars;
}

export async function bars(symbols: string[], resolution: string, count: number, timeoutMs = 12_000): Promise<Record<string, TvBar[] | null>> {
  const out: Record<string, TvBar[] | null> = {};
  await Promise.all(
    symbols.map(async (sym) => {
      out[sym] = await series(sym, resolution, count, timeoutMs).catch(() => null);
    }),
  );
  return out;
}
