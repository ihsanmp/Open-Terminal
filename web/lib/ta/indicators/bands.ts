import * as ta from "../core";
import { type Anchor, type Series } from "../core";
import { C, alpha, b, bool, float, int, n, s, select, src, type Color, type IndicatorDef, type Marker } from "../types";

const donchian = (high: Series, low: Series, len: number) =>
  ta.zip(ta.highest(high, len), ta.lowest(low, len), (h, l) => (h + l) / 2);

export const bands: IndicatorDef[] = [
  {
    id: "bb", name: "Bollinger Bands", short: "BB", category: "Bands & Channels", overlay: true,
    inputs: [int("length", "Length", 20), select("maType", "Basis MA Type", ta.MA_TYPES, "SMA"), src(), float("mult", "StdDev", 2, 0.1, 0.001), int("offset", "Offset", 0, -500)],
    plots: [
      { key: "basis", title: "Basis", color: C.blue },
      { key: "upper", title: "Upper", color: C.red },
      { key: "lower", title: "Lower", color: C.green },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const basis = ta.maByType(s(p, "maType"), x, len, bars.volume);
      const dev = ta.scale(ta.stdev(x, len), n(p, "mult"));
      const o = n(p, "offset");
      return {
        plots: { basis, upper: ta.add(basis, dev), lower: ta.sub(basis, dev) },
        offsets: { basis: o, upper: o, lower: o },
        fills: [{ a: "upper", b: "lower", color: alpha(C.lightBlue, 0.05) }],
      };
    },
  },
  {
    id: "kc", name: "Keltner Channels", short: "KC", category: "Bands & Channels", overlay: true,
    inputs: [
      int("length", "Length", 20), float("mult", "Multiplier", 2), src(), bool("useExp", "Use Exponential MA", true),
      select("bandsStyle", "Bands Style", ["Average True Range", "True Range", "Range"], "Average True Range"), int("atrLength", "ATR Length", 10),
    ],
    plots: [
      { key: "upper", title: "Upper", color: C.blue },
      { key: "basis", title: "Basis", color: C.blue },
      { key: "lower", title: "Lower", color: C.blue },
    ],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const len = n(p, "length");
      const ma = b(p, "useExp") ? ta.ema(x, len) : ta.sma(x, len);
      const style = s(p, "bandsStyle");
      const range =
        style === "True Range" ? ta.tr(bars, true)
        : style === "Average True Range" ? ta.atr(bars, n(p, "atrLength"))
        : ta.rma(ta.sub(bars.high, bars.low), len);
      const w = ta.scale(range, n(p, "mult"));
      return {
        plots: { upper: ta.add(ma, w), basis: ma, lower: ta.sub(ma, w) },
        fills: [{ a: "upper", b: "lower", color: alpha(C.lightBlue, 0.05) }],
      };
    },
  },
  {
    id: "dc", name: "Donchian Channels", short: "DC", category: "Bands & Channels", overlay: true,
    inputs: [int("length", "Length", 20), int("offset", "Offset", 0, -500)],
    plots: [
      { key: "basis", title: "Basis", color: C.orange },
      { key: "upper", title: "Upper", color: C.blue },
      { key: "lower", title: "Lower", color: C.blue },
    ],
    compute: (bars, p) => {
      const len = n(p, "length");
      const upper = ta.highest(bars.high, len);
      const lower = ta.lowest(bars.low, len);
      const o = n(p, "offset");
      return {
        plots: { basis: ta.zip(upper, lower, (u, l) => (u + l) / 2), upper, lower },
        offsets: { basis: o, upper: o, lower: o },
        fills: [{ a: "upper", b: "lower", color: alpha(C.lightBlue, 0.05) }],
      };
    },
  },
  {
    id: "ichimoku", name: "Ichimoku Cloud", short: "Ichimoku", category: "Trend", overlay: true,
    inputs: [int("conversion", "Conversion Line Length", 9), int("base", "Base Line Length", 26), int("spanB", "Leading Span B Length", 52), int("displacement", "Lagging Span", 26)],
    plots: [
      { key: "conversion", title: "Conversion Line", color: C.blue },
      { key: "base", title: "Base Line", color: "#B71C1C" },
      { key: "lagging", title: "Lagging Span", color: "#43A047" },
      { key: "leadA", title: "Leading Span A", color: "#A5D6A7" },
      { key: "leadB", title: "Leading Span B", color: "#EF9A9A" },
    ],
    compute: (bars, p) => {
      const conversion = donchian(bars.high, bars.low, n(p, "conversion"));
      const base = donchian(bars.high, bars.low, n(p, "base"));
      const leadA = ta.zip(conversion, base, (c, k) => (c + k) / 2);
      const leadB = donchian(bars.high, bars.low, n(p, "spanB"));
      const d = n(p, "displacement") - 1;
      return {
        plots: { conversion, base, lagging: bars.close, leadA, leadB },
        offsets: { lagging: -d, leadA: d, leadB: d },
        fills: [{ a: "leadA", b: "leadB", color: leadA.map((a, i) => (a > leadB[i] ? "rgba(67,160,71,0.1)" : "rgba(244,67,54,0.1)")) }],
      };
    },
  },
  {
    id: "supertrend", name: "Supertrend", short: "Supertrend", category: "Trend", overlay: true,
    inputs: [int("atrPeriod", "ATR Length", 10), float("factor", "Factor", 3, 0.01, 0.01)],
    plots: [
      { key: "up", title: "Up Trend", color: C.green },
      { key: "down", title: "Down Trend", color: C.red },
      { key: "body", title: "Body Middle", color: C.gray, display: "none" },
    ],
    compute: (bars, p) => {
      const { value, direction } = ta.supertrend(bars, n(p, "factor"), n(p, "atrPeriod"));
      const up = value.map((v, i) => (direction[i] < 0 ? v : NaN));
      const down = value.map((v, i) => (direction[i] < 0 ? NaN : v));
      const body = ta.zip(bars.open, bars.close, (o, c) => (o + c) / 2);
      return {
        plots: { up, down, body },
        fills: [
          { a: "body", b: "up", color: alpha(C.green, 0.1) },
          { a: "body", b: "down", color: alpha(C.red, 0.1) },
        ],
      };
    },
  },
  {
    id: "psar", name: "Parabolic SAR", short: "SAR", category: "Trend", overlay: true,
    inputs: [float("start", "Start", 0.02, 0.001, 0), float("increment", "Increment", 0.02, 0.001, 0), float("maximum", "Max Value", 0.2, 0.01, 0)],
    plots: [{ key: "sar", title: "ParabolicSAR", color: C.blue, style: "circles" }],
    compute: (bars, p) => ({ plots: { sar: ta.sar(bars, n(p, "start"), n(p, "increment"), n(p, "maximum")) } }),
  },
  {
    id: "chandelier", name: "Chandelier Exit", short: "CE", category: "Trend", overlay: true,
    inputs: [int("length", "ATR Period", 22), float("mult", "ATR Multiplier", 3), bool("useClose", "Use Close Price for Extremums", true)],
    plots: [
      { key: "long", title: "Long Stop", color: C.green },
      { key: "short", title: "Short Stop", color: C.red },
    ],
    compute: (bars, p) => {
      const len = n(p, "length");
      const a = ta.scale(ta.atr(bars, len), n(p, "mult"));
      const useClose = b(p, "useClose");
      const hh = ta.highest(useClose ? bars.close : bars.high, len);
      const ll = ta.lowest(useClose ? bars.close : bars.low, len);
      const count = bars.length;
      const longStop = ta.fill(count);
      const shortStop = ta.fill(count);
      const long = ta.fill(count);
      const short = ta.fill(count);
      const markers: Marker[] = [];
      let dir = 1;
      for (let i = 0; i < count; i++) {
        let ls = hh[i] - a[i];
        let ss = ll[i] + a[i];
        const lsPrev = i > 0 ? ta.nz(longStop[i - 1], ls) : ls;
        const ssPrev = i > 0 ? ta.nz(shortStop[i - 1], ss) : ss;
        if (i > 0 && bars.close[i - 1] > lsPrev) ls = Math.max(ls, lsPrev);
        if (i > 0 && bars.close[i - 1] < ssPrev) ss = Math.min(ss, ssPrev);
        longStop[i] = ls;
        shortStop[i] = ss;
        const prevDir = dir;
        dir = bars.close[i] > ssPrev ? 1 : bars.close[i] < lsPrev ? -1 : dir;
        if (ta.isNa(ls)) continue;
        if (dir === 1) long[i] = ls;
        else short[i] = ss;
        if (dir !== prevDir) {
          markers.push(
            dir === 1
              ? { index: i, position: "belowBar", shape: "arrowUp", color: C.green, text: "Buy" }
              : { index: i, position: "aboveBar", shape: "arrowDown", color: C.red, text: "Sell" }
          );
        }
      }
      return { plots: { long, short }, markers };
    },
  },
  {
    id: "ckstop", name: "Chande Kroll Stop", short: "CKS", category: "Trend", overlay: true,
    inputs: [int("p", "ATR Length", 10), float("x", "ATR Coefficient", 1), int("q", "Stop Length", 9)],
    plots: [
      { key: "long", title: "Stop Long", color: C.blue },
      { key: "short", title: "Stop Short", color: C.orange },
    ],
    compute: (bars, p) => {
      const len = n(p, "p");
      const a = ta.scale(ta.atr(bars, len), n(p, "x"));
      const firstHigh = ta.sub(ta.highest(bars.high, len), a);
      const firstLow = ta.add(ta.lowest(bars.low, len), a);
      return { plots: { long: ta.lowest(firstLow, n(p, "q")), short: ta.highest(firstHigh, n(p, "q")) } };
    },
  },
  {
    id: "vstop", name: "Volatility Stop", short: "VStop", category: "Trend", overlay: true,
    inputs: [int("length", "Length", 20), src(), float("factor", "Multiplier", 2)],
    plots: [{ key: "stop", title: "Volatility Stop", color: C.teal, style: "circles" }],
    compute: (bars, p) => {
      const x = ta.source(bars, s(p, "source"));
      const a = ta.atr(bars, n(p, "length"));
      const trr = ta.tr(bars);
      const count = bars.length;
      const stop = ta.fill(count);
      const colors: Color[] = new Array(count);
      let max = x[0], min = x[0], uptrend = true, prevStop = NaN;
      for (let i = 0; i < count; i++) {
        const atrM = ta.nz(a[i] * n(p, "factor"), trr[i]);
        max = Math.max(max, x[i]);
        min = Math.min(min, x[i]);
        // Math.max/min propagate NaN exactly like Pine's math.max(na, x) = na.
        let st = ta.nz(uptrend ? Math.max(prevStop, max - atrM) : Math.min(prevStop, min + atrM), x[i]);
        const prevUp: boolean = uptrend;
        uptrend = x[i] - st >= 0;
        if (uptrend !== prevUp) {
          max = x[i];
          min = x[i];
          st = uptrend ? max - atrM : min + atrM;
        }
        prevStop = st;
        if (!ta.isNa(a[i])) {
          stop[i] = st;
          colors[i] = uptrend ? C.teal : "#F44336";
        }
      }
      return { plots: { stop }, colors: { stop: colors } };
    },
  },
  {
    id: "pivots", name: "Pivot Points Standard", short: "Pivots", category: "Support & Resistance", overlay: true, autoscale: false,
    inputs: [
      select("type", "Type", ["Traditional", "Fibonacci", "Woodie", "Classic", "DM", "Camarilla"], "Traditional"),
      select("timeframe", "Pivots Timeframe", ["Auto", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly"], "Auto"),
      int("back", "Number of Pivots Back", 15, 1, 500),
    ],
    plots: ["P", "R1", "S1", "R2", "S2", "R3", "S3", "R4", "S4", "R5", "S5"].map((k) => ({
      key: k, title: k, color: k === "P" ? C.orange : k.startsWith("R") ? C.red : C.green,
    })),
    compute: (bars, p) => {
      const tf = s(p, "timeframe");
      const spacing = ta.barSpacing(bars.time);
      const anchor: Anchor =
        tf === "Daily" ? "Session" : tf === "Weekly" ? "Week" : tf === "Monthly" ? "Month" : tf === "Quarterly" ? "Quarter" : tf === "Yearly" ? "Year"
        : spacing <= 15 * 60 ? "Session" : spacing < 20 * 3600 ? "Week" : "Month";
      const keys = ta.periodKeys(bars.time, anchor);
      const starts: number[] = [];
      for (let i = 0; i < keys.length; i++) if (i === 0 || keys[i] !== keys[i - 1]) starts.push(i);
      const levels = ["P", "R1", "S1", "R2", "S2", "R3", "S3", "R4", "S4", "R5", "S5"];
      const plots: Record<string, Series> = Object.fromEntries(levels.map((l) => [l, ta.fill(bars.length)]));
      const firstPeriod = Math.max(1, starts.length - n(p, "back"));
      for (let k = firstPeriod; k < starts.length; k++) {
        const from = starts[k - 1];
        const to = starts[k] - 1;
        let H = -Infinity, L = Infinity;
        for (let i = from; i <= to; i++) { H = Math.max(H, bars.high[i]); L = Math.min(L, bars.low[i]); }
        const Cl = bars.close[to];
        const O = bars.open[from];
        const lv = pivotLevels(s(p, "type"), H, L, Cl, O, bars.open[starts[k]]);
        const end = k + 1 < starts.length ? starts[k + 1] - 1 : bars.length - 1;
        // Leave the first bar of each period empty so consecutive periods don't join up.
        for (let i = starts[k] + (k > firstPeriod ? 1 : 0); i <= end; i++) {
          for (const [name, v] of Object.entries(lv)) plots[name][i] = v;
        }
      }
      return { plots };
    },
  },
  {
    id: "pivotshl", name: "Pivot Points High Low", short: "Pivots HL", category: "Support & Resistance", overlay: true,
    inputs: [int("leftH", "Pivot High Left", 10), int("rightH", "Pivot High Right", 10), int("leftL", "Pivot Low Left", 10), int("rightL", "Pivot Low Right", 10)],
    plots: [],
    compute: (bars, p) => {
      const markers: Marker[] = [];
      const highs = ta.pivotHighs(bars.high, n(p, "leftH"), n(p, "rightH"));
      const lows = ta.pivotLows(bars.low, n(p, "leftL"), n(p, "rightL"));
      for (let i = 0; i < bars.length; i++) {
        if (highs[i]) markers.push({ index: i, position: "aboveBar", shape: "arrowDown", color: C.red, text: bars.high[i].toFixed(2) });
        if (lows[i]) markers.push({ index: i, position: "belowBar", shape: "arrowUp", color: C.green, text: bars.low[i].toFixed(2) });
      }
      return { plots: {}, markers };
    },
  },
  {
    id: "fractals", name: "Williams Fractal", short: "Fractals", category: "Support & Resistance", overlay: true,
    inputs: [int("periods", "Periods", 2, 2)],
    plots: [],
    compute: (bars, p) => {
      const np = n(p, "periods");
      const markers: Marker[] = [];
      const h = bars.high;
      const l = bars.low;
      // Port of TradingView's frontier checks: newer bars strictly lower/higher,
      // older bars may tie for up to 4 bars before a strictly lower/higher one.
      const isFractal = (x: number[], c: number, better: (a: number, b: number) => boolean, orEqual: (a: number, b: number) => boolean) => {
        const v = x[c];
        for (let i = 1; i <= np; i++) if (c + i >= x.length || !better(x[c + i], v)) return false;
        for (let ties = 0; ties <= 4; ties++) {
          let ok = true;
          for (let t = 1; t <= ties && ok; t++) if (c - t < 0 || !orEqual(x[c - t], v)) ok = false;
          for (let i = 1; i <= np && ok; i++) if (c - i - ties < 0 || !better(x[c - i - ties], v)) ok = false;
          if (ok) return true;
        }
        return false;
      };
      for (let c = np; c < bars.length - np; c++) {
        if (isFractal(h, c, (a, v) => a < v, (a, v) => a <= v)) markers.push({ index: c, position: "aboveBar", shape: "arrowDown", color: C.teal });
        if (isFractal(l, c, (a, v) => a > v, (a, v) => a >= v)) markers.push({ index: c, position: "belowBar", shape: "arrowUp", color: "#F44336" });
      }
      return { plots: {}, markers };
    },
  },
  {
    id: "zigzag", name: "Zig Zag", short: "ZigZag", category: "Support & Resistance", overlay: true,
    inputs: [float("deviation", "Price Deviation for Reversals (%)", 5, 0.1, 0.00001), int("depth", "Pivot Legs", 10, 2), bool("extend", "Extend to Last Bar", true)],
    plots: [{ key: "zz", title: "Zig Zag", color: C.blue, connectGaps: true, width: 2 }],
    compute: (bars, p) => {
      const legs = Math.floor(n(p, "depth") / 2);
      const threshold = n(p, "deviation");
      type Pivot = { index: number; price: number; isHigh: boolean };
      const pivots: Pivot[] = [];
      const consider = (index: number, price: number, isHigh: boolean) => {
        const last = pivots[pivots.length - 1];
        if (!last) return void pivots.push({ index, price, isHigh });
        if (last.isHigh === isHigh) {
          if (isHigh ? price > last.price : price < last.price) {
            pivots[pivots.length - 1] = { index, price, isHigh };
          }
        } else if (Math.abs((100 * (price - last.price)) / last.price) >= threshold) {
          pivots.push({ index, price, isHigh });
        }
      };
      for (let i = 2 * legs; i < bars.length; i++) {
        const c = i - legs;
        const found = (x: number[], isHigh: boolean) => {
          const v = x[c];
          for (let j = c + 1; j <= i; j++) if (isHigh ? x[j] > v : x[j] < v) return false;
          for (let j = c - legs; j < c; j++) if (isHigh ? x[j] >= v : x[j] <= v) return false;
          return true;
        };
        if (found(bars.high, true)) consider(c, bars.high[c], true);
        if (found(bars.low, false)) consider(c, bars.low[c], false);
      }
      const zz = ta.fill(bars.length);
      for (const pv of pivots) zz[pv.index] = pv.price;
      const last = pivots[pivots.length - 1];
      if (b(p, "extend") && last && last.index < bars.length - 1) zz[bars.length - 1] = bars.close[bars.length - 1];
      return { plots: { zz } };
    },
  },
];

function pivotLevels(type: string, H: number, L: number, Cl: number, O: number, currOpen: number): Record<string, number> {
  const range = H - L;
  switch (type) {
    case "Fibonacci": {
      const P = (H + L + Cl) / 3;
      return { P, R1: P + 0.382 * range, S1: P - 0.382 * range, R2: P + 0.618 * range, S2: P - 0.618 * range, R3: P + range, S3: P - range };
    }
    case "Woodie": {
      const P = (H + L + 2 * currOpen) / 4;
      const R3 = H + 2 * (P - L);
      const S3 = L - 2 * (H - P);
      return { P, R1: 2 * P - L, S1: 2 * P - H, R2: P + range, S2: P - range, R3, S3, R4: R3 + range, S4: S3 - range };
    }
    case "Classic": {
      const P = (H + L + Cl) / 3;
      return { P, R1: 2 * P - L, S1: 2 * P - H, R2: P + range, S2: P - range, R3: P + 2 * range, S3: P - 2 * range, R4: P + 3 * range, S4: P - 3 * range };
    }
    case "DM": {
      const X = Cl < O ? H + 2 * L + Cl : Cl > O ? 2 * H + L + Cl : H + L + 2 * Cl;
      return { P: X / 4, R1: X / 2 - L, S1: X / 2 - H };
    }
    case "Camarilla": {
      const P = (H + L + Cl) / 3;
      const R5 = (H / L) * Cl;
      return {
        P,
        R1: Cl + (1.1 * range) / 12, S1: Cl - (1.1 * range) / 12,
        R2: Cl + (1.1 * range) / 6, S2: Cl - (1.1 * range) / 6,
        R3: Cl + (1.1 * range) / 4, S3: Cl - (1.1 * range) / 4,
        R4: Cl + (1.1 * range) / 2, S4: Cl - (1.1 * range) / 2,
        R5, S5: Cl - (R5 - Cl),
      };
    }
    default: {
      const P = (H + L + Cl) / 3;
      return {
        P, R1: P * 2 - L, S1: P * 2 - H, R2: P + range, S2: P - range,
        R3: P * 2 + (H - 2 * L), S3: P * 2 - (2 * H - L),
        R4: P * 3 + (H - 3 * L), S4: P * 3 - (3 * H - L),
        R5: P * 4 + (H - 4 * L), S5: P * 4 - (4 * H - L),
      };
    }
  }
}
