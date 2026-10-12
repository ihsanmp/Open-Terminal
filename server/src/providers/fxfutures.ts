// Money in and out of a currency pair, from its CME futures: spot FX trades over the counter and
// publishes no volume (TradingView's FX:EURUSD "volume" is a count of price changes), while the
// CME's euro, pound, yen … futures report every contract traded. A contract is a fixed amount of
// the foreign currency (6E: €125,000), so contracts × size × price is dollars.
//
// The futures are priced in dollars per unit of the foreign currency. For a pair quoted the other
// way round (USDJPY, USDCAD, USDCHF, USDMXN) buying the future is selling the pair: its money
// flows are swapped and its prices turned over (1 / 0.0063325 = 157.9 yen per dollar).
//
// Who's behind it: the CFTC's weekly Traders in Financial Futures report (asset managers,
// leveraged funds, dealers), each group's net long change a week.

export type FxFuture = {
  /** TradingView's continuous front-month contract. */
  tv: string;
  /** Foreign currency per contract. */
  size: number;
  /** The pair is quoted in the foreign currency per dollar. */
  invert: boolean;
  /** The CFTC's market code for the contract. */
  cftc: string;
  currency: string;
};

const FUTURES: Record<string, FxFuture> = {
  EURUSD: { tv: "CME:6E1!", size: 125_000, invert: false, cftc: "099741", currency: "EUR" },
  GBPUSD: { tv: "CME:6B1!", size: 62_500, invert: false, cftc: "096742", currency: "GBP" },
  AUDUSD: { tv: "CME:6A1!", size: 100_000, invert: false, cftc: "232741", currency: "AUD" },
  NZDUSD: { tv: "CME:6N1!", size: 100_000, invert: false, cftc: "112741", currency: "NZD" },
  USDJPY: { tv: "CME:6J1!", size: 12_500_000, invert: true, cftc: "097741", currency: "JPY" },
  USDCAD: { tv: "CME:6C1!", size: 100_000, invert: true, cftc: "090741", currency: "CAD" },
  USDCHF: { tv: "CME:6S1!", size: 125_000, invert: true, cftc: "092741", currency: "CHF" },
  USDMXN: { tv: "CME:6M1!", size: 500_000, invert: true, cftc: "095741", currency: "MXN" },
};

/** The pair a symbol names (EURUSD=X, JPY=X for USDJPY as Yahoo writes it, FX:EURUSD), else null. */
export function fxPair(symbol: string): string | null {
  const s = symbol.toUpperCase();
  let m = /^(?:[A-Z_]+:)?([A-Z]{6})(?:=X)?$/.exec(s);
  if (m && FUTURES[m[1]]) return m[1];
  m = /^([A-Z]{3})=X$/.exec(s);
  if (m && FUTURES[`USD${m[1]}`]) return `USD${m[1]}`;
  return null;
}

export const fxFutureOf = (symbol: string): FxFuture | null => {
  const pair = fxPair(symbol);
  return pair ? FUTURES[pair] : null;
};

/** A futures trade as the pair's: dollars traded, the pair's price, and its side. */
export function asPairTrade<T extends { price: number; size: number; value: number; side: "buy" | "sell" }>(t: T, f: FxFuture): T {
  const value = t.size * f.size * t.price;
  const side = f.invert ? (t.side === "buy" ? "sell" : "buy") : t.side;
  return { ...t, price: f.invert && t.price > 0 ? 1 / t.price : t.price, value, side };
}

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

/**
 * Futures bars as the pair's, ready for the money-flow estimate: volume in units of the foreign
 * currency (contracts × size), so typical price × volume is dollars; a pair quoted the other way
 * gets its bars turned over (high and low swap), so a bar closing near the future's high closes
 * near the pair's low.
 */
export function asPairBars(bars: Candle[], f: FxFuture): Candle[] {
  return bars.map((b) => {
    const volume = b.volume * f.size;
    if (!f.invert) return { ...b, volume };
    // The dollars traded stay the future's (price × volume); the shape is the pair's.
    const inv = (p: number) => (p > 0 ? 1 / p : 0);
    const typical = (b.high + b.low + b.close) / 3;
    const pairTypical = (inv(b.high) + inv(b.low) + inv(b.close)) / 3;
    return { time: b.time, open: inv(b.open), high: inv(b.low), low: inv(b.high), close: inv(b.close), volume: pairTypical > 0 ? (volume * typical) / pairTypical : 0 };
  });
}

// ---------------------------------------------------------------- CFTC positioning

export type CotRow = {
  date: string;
  /** Net long change (contracts) of each group over the week. */
  assetManagers: number;
  leveragedFunds: number;
  dealers: number;
  /** Net long held at the week's end. */
  netAssetManagers: number;
  netLeveragedFunds: number;
  netDealers: number;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** The report's rows as each group's weekly change. */
export function cotRows(raw: Array<Record<string, string>>): CotRow[] {
  return raw
    .map((r) => ({
      date: String(r.report_date_as_yyyy_mm_dd ?? "").slice(0, 10),
      assetManagers: n(r.change_in_asset_mgr_long) - n(r.change_in_asset_mgr_short),
      leveragedFunds: n(r.change_in_lev_money_long) - n(r.change_in_lev_money_short),
      dealers: n(r.change_in_dealer_long_all) - n(r.change_in_dealer_short_all),
      netAssetManagers: n(r.asset_mgr_positions_long) - n(r.asset_mgr_positions_short),
      netLeveragedFunds: n(r.lev_money_positions_long) - n(r.lev_money_positions_short),
      netDealers: n(r.dealer_positions_long_all) - n(r.dealer_positions_short_all),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The last weeks of the CFTC's Traders in Financial Futures report for a contract. */
export async function cotReport(f: FxFuture, weeks = 26): Promise<CotRow[]> {
  const url =
    "https://publicreporting.cftc.gov/resource/gpe5-46if.json" +
    `?$limit=${weeks}&$order=report_date_as_yyyy_mm_dd%20DESC&$where=cftc_contract_market_code='${f.cftc}'`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`cftc ${res.status}`);
  return cotRows((await res.json()) as Array<Record<string, string>>);
}
