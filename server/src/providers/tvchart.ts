// Recent bars for any TradingView symbol (EXCHANGE:TICKER) from TradingView's own chart
// feed — what Pine's request.security("BINANCE:BTCUSDT", timeframe, ...) reads. Used by
// indicators that compare the same ticker across exchanges or brokers (Arbitrage Matrix).
//
// One websocket per call with a chart session per symbol, as the public chart does for a
// signed-out visitor. Symbols an exchange doesn't list come back as null, like
// ignore_invalid_symbol = true.

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

export async function bars(symbols: string[], resolution: string, count: number, timeoutMs = 12_000): Promise<Record<string, TvBar[] | null>> {
  const result: Record<string, TvBar[] | null> = {};
  if (symbols.length === 0) return result;
  const pending = new Map<string, string>(); // chart session → symbol
  const collected = new Map<string, TvBar[]>();

  return new Promise((resolve) => {
    // Node's WebSocket (undici) takes request headers in its options object.
    const ws = new (WebSocket as unknown as new (url: string, opts: unknown) => WebSocket)(URL, { headers: HEADERS });
    const finish = () => {
      clearTimeout(timer);
      for (const sym of pending.values()) result[sym] ??= collected.get(sym) ?? null;
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(result);
    };
    const timer = setTimeout(finish, timeoutMs);
    const settle = (session: string, value: TvBar[] | null) => {
      const sym = pending.get(session);
      if (sym === undefined || sym in result) return;
      result[sym] = value;
      if (Object.keys(result).length === pending.size) finish();
    };

    ws.onopen = () => {
      ws.send(frame("set_auth_token", ["unauthorized_user_token"]));
      symbols.forEach((sym, i) => {
        const cs = `cs_${i}`;
        pending.set(cs, sym);
        ws.send(frame("chart_create_session", [cs, ""]));
        ws.send(frame("resolve_symbol", [cs, "sds_sym_1", "=" + JSON.stringify({ symbol: sym, adjustment: "splits" })]));
        ws.send(frame("create_series", [cs, "sds_1", "s1", "sds_sym_1", resolution, count, ""]));
      });
    };
    ws.onerror = () => finish();
    ws.onclose = () => finish();
    ws.onmessage = (ev: MessageEvent) => {
      for (const payload of parseFrames(String(ev.data))) {
        if (payload.startsWith("~h~")) {
          ws.send(`~m~${payload.length}~m~${payload}`); // heartbeat echo
          continue;
        }
        let msg: { m?: string; p?: any[] };
        try {
          msg = JSON.parse(payload);
        } catch {
          continue;
        }
        const session = msg.p?.[0];
        if (typeof session !== "string") continue;
        if (msg.m === "timescale_update") {
          const rows: Array<{ v: number[] }> = msg.p?.[1]?.sds_1?.s ?? [];
          const sym = pending.get(session);
          if (sym === undefined) continue;
          const list = collected.get(sym) ?? [];
          for (const { v } of rows) {
            list.push({ time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: Number.isFinite(v[5]) ? v[5] : null });
          }
          collected.set(sym, list);
        } else if (msg.m === "series_completed") {
          const sym = pending.get(session);
          if (sym !== undefined) settle(session, (collected.get(sym) ?? []).sort((a, b) => a.time - b.time));
        } else if (msg.m === "symbol_error" || msg.m === "series_error") {
          settle(session, null);
        }
      }
    };
  });
}
