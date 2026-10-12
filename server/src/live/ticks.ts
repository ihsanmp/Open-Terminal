// Trades read off TradingView's quote stream: the stream gives a symbol's last price, its day's
// volume and its bid and ask as they change, so each rise in the volume is a trade (or a few
// within a moment) of that many shares at the last price. Which side started it is read as
// markets usually do without the tape's flags: at the ask or above, or up from the last price,
// a buy; at the bid or below, or down, a sell; at the same price, the side of the trade before.

export type Side = "buy" | "sell";
export type Tick = { time: number; price: number; size: number; value: number; side: Side; extended?: true };

/** A symbol's state on the stream: what the last update left. */
export type QuoteState = {
  price: number | null; volume: number | null; bid: number | null; ask: number | null; side: Side;
  extPrice: number | null; extTime: number | null;
};

export type QuoteUpdate = { lp?: number; volume?: number; bid?: number; ask?: number; lp_time?: number; rtc?: number; rtc_time?: number };

export const emptyState = (): QuoteState => ({ price: null, volume: null, bid: null, ask: null, side: "buy", extPrice: null, extTime: null });

/** The side that started a trade at this price. */
export function classify(price: number, prev: QuoteState): Side {
  if (prev.ask !== null && price >= prev.ask) return "buy";
  if (prev.bid !== null && price <= prev.bid) return "sell";
  if (prev.price !== null && price > prev.price) return "buy";
  if (prev.price !== null && price < prev.price) return "sell";
  return prev.side;
}

/**
 * The state after an update, and the trade it shows if the volume rose. The first volume seen
 * only sets where counting starts; a lower one (a new day) starts it again.
 */
export function applyUpdate(state: QuoteState, u: QuoteUpdate, now: number): { state: QuoteState; tick: Tick | null } {
  const next: QuoteState = { ...state };
  const price = u.lp ?? state.price;
  let tick: Tick | null = null;
  if (u.volume !== undefined && Number.isFinite(u.volume)) {
    if (state.volume !== null && u.volume > state.volume && price !== null) {
      const size = u.volume - state.volume;
      const side = classify(price, state);
      tick = { time: now, price, size, value: size * price, side };
      next.side = side;
    }
    next.volume = u.volume;
  }
  if (price !== null) next.price = price;
  // Extended hours: a newer trade time is a trade at the extended price (the last if it's the same).
  const extPrice = u.rtc ?? state.extPrice;
  if (u.rtc_time !== undefined && Number.isFinite(u.rtc_time)) {
    if (!tick && state.extTime !== null && u.rtc_time > state.extTime && extPrice !== null) {
      const side = classify(extPrice, { ...state, price: state.extPrice ?? state.price });
      tick = { time: now, price: extPrice, size: 0, value: 0, side, extended: true };
      next.side = side;
    }
    next.extTime = u.rtc_time;
  }
  if (extPrice !== null) next.extPrice = extPrice;
  // The quote is read after the trade is: the bid and ask it was matched against are the old ones.
  if (u.bid !== undefined) next.bid = u.bid;
  if (u.ask !== undefined) next.ask = u.ask;
  return { state: next, tick };
}
