// TradingView's "Technicals" summary for a symbol, from its daily candles: each moving average and
// oscillator votes buy, sell or neutral as in TradingView's Technical Ratings, and the votes add up
// to Strong sell … Strong buy. A reading of the indicators, not a forecast.

import * as ta from "./ta/core";

export type Vote = 1 | 0 | -1;
export type Rating = "Strong sell" | "Sell" | "Neutral" | "Buy" | "Strong buy";
export type Group = { buy: number; neutral: number; sell: number; rating: Rating; score: number };
export type Technicals = { summary: Group; movingAverages: Group; oscillators: Group };

const MA_LENGTHS = [10, 20, 30, 50, 100, 200];

/** TradingView's bands on a score from −1 (all sell) to 1 (all buy). */
export function ratingOf(score: number): Rating {
  if (score > 0.5) return "Strong buy";
  if (score > 0.1) return "Buy";
  if (score >= -0.1) return "Neutral";
  if (score >= -0.5) return "Sell";
  return "Strong sell";
}

function group(votes: Vote[]): Group {
  const counted = votes.length || 1;
  const score = votes.reduce<number>((a, v) => a + v, 0) / counted;
  return {
    buy: votes.filter((v) => v === 1).length,
    neutral: votes.filter((v) => v === 0).length,
    sell: votes.filter((v) => v === -1).length,
    rating: ratingOf(score),
    score,
  };
}

const at = (x: number[], back = 0) => x[x.length - 1 - back];
const ok = (...v: number[]) => v.every(Number.isFinite);

/** The summary for candles in time order; null when there are too few to judge. */
export function technicals(candles: Array<{ high: number; low: number; close: number }>): Technicals | null {
  if (candles.length < 30) return null;
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const price = at(close);

  // Moving averages: buy when the price is above, sell when below (an average not yet formed is left out).
  const maVotes: Vote[] = [];
  for (const len of MA_LENGTHS) {
    for (const ma of [ta.sma(close, len), ta.ema(close, len)]) {
      const v = at(ma);
      if (ok(v)) maVotes.push(price > v ? 1 : price < v ? -1 : 0);
    }
  }

  // Oscillators, with TradingView's rules.
  const oscVotes: Vote[] = [];
  const rsi = ta.rsi(close, 14);
  if (ok(at(rsi), at(rsi, 1))) oscVotes.push(at(rsi) < 30 && at(rsi) > at(rsi, 1) ? 1 : at(rsi) > 70 && at(rsi) < at(rsi, 1) ? -1 : 0);
  const k = ta.sma(ta.stoch(close, high, low, 14), 3);
  const d = ta.sma(k, 3);
  if (ok(at(k), at(d))) oscVotes.push(at(k) < 20 && at(k) > at(d) ? 1 : at(k) > 80 && at(k) < at(d) ? -1 : 0);
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  const cci = ta.cci(hlc3, 20);
  if (ok(at(cci), at(cci, 1))) oscVotes.push(at(cci) < -100 && at(cci) > at(cci, 1) ? 1 : at(cci) > 100 && at(cci) < at(cci, 1) ? -1 : 0);
  const slow = ta.ema(close, 26);
  const macd = ta.ema(close, 12).map((v, i) => v - slow[i]);
  const signal = ta.ema(macd, 9);
  if (ok(at(macd), at(signal))) oscVotes.push(at(macd) > at(signal) ? 1 : at(macd) < at(signal) ? -1 : 0);
  const mom = ta.change(close, 10);
  if (ok(at(mom), at(mom, 1))) oscVotes.push(at(mom) > at(mom, 1) ? 1 : at(mom) < at(mom, 1) ? -1 : 0);

  const movingAverages = group(maVotes);
  const oscillators = group(oscVotes);
  const score = (movingAverages.score + oscillators.score) / 2;
  return {
    movingAverages,
    oscillators,
    summary: {
      buy: movingAverages.buy + oscillators.buy,
      neutral: movingAverages.neutral + oscillators.neutral,
      sell: movingAverages.sell + oscillators.sell,
      rating: ratingOf(score),
      score,
    },
  };
}
