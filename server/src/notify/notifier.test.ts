import { describe, expect, it } from "vitest";
import type { H30Conclusion } from "../providers/h30.js";
import { fiveMinuteMoves, groupReleases, h30Message, reactionMessage, resultMessage, sideOf, type Release } from "./notifier.js";
import { toastScript, toastXml } from "./toast.js";

const at = "2026-11-10T13:30:00.000Z";
const T = Date.parse(at);
const cpi = (actual: number | null, forecast = 0.3): Release => ({ title: "Inflation Rate MoM", date: at, actual, forecast, unit: "%" });
const core = (actual: number | null, forecast = 0.3): Release => ({ title: "Core Inflation Rate MoM", date: at, actual, forecast, unit: "%" });

describe("the releases notified", () => {
  it("groups a minute's releases, the most market-moving first, and leaves out the rest", () => {
    const g = groupReleases([core(null), { title: "Redbook YoY", date: at, actual: null, forecast: null }, cpi(null), { ...cpi(null), date: "2026-11-11T13:30:00.000Z" }]);
    expect(g).toHaveLength(2);
    expect(g[0].releases.map((r) => r.title)).toEqual(["Inflation Rate MoM", "Core Inflation Rate MoM"]);
    expect(g[0].time).toBe(T);
  });

  it("calls the side against the consensus, claims and unemployment turned round, small gaps in line", () => {
    expect(sideOf(cpi(0.4))).toBe(1);
    expect(sideOf(cpi(0.2))).toBe(-1);
    expect(sideOf(cpi(0.32))).toBe(0);
    expect(sideOf({ title: "Initial Jobless Claims", date: at, actual: 240, forecast: 225 })).toBe(-1);
    expect(sideOf(cpi(null))).toBeNull();
  });

  it("says the result, the lead release first and the others after", () => {
    const [g] = groupReleases([cpi(0.4), core(0.3)]);
    const m = resultMessage(g)!;
    expect(m.title).toBe("CPI MoM: 0,4% (konsensus 0,3%)");
    expect(m.lines[0]).toContain("hawkish");
    expect(m.lines[1]).toBe("Core CPI MoM 0,3% (0,3%)");
    expect(resultMessage(groupReleases([cpi(null)])[0])).toBeNull();
  });

  it("says H-30 with the engine's band and the bias it kept, when there is one", () => {
    const [g] = groupReleases([cpi(null), core(null)]);
    const plain = h30Message(g, null);
    expect(plain.title).toMatch(/^30 menit lagi \(.+\): CPI MoM, Core CPI MoM$/);
    expect(plain.lines).toEqual(["Konsensus CPI MoM: 0,3%"]);
    const c = {
      driver: { key: "cpi_mom", label: "CPI MoM", consensus: 0.3, p10: 0.2, p50: 0.3, p90: 0.4 },
      assets: [
        { label: "XAU/USD", dir: "turun", chance: 0.58 },
        { label: "BTC", dir: "datar", chance: 0.51 },
        { label: "DXY", dir: "naik", chance: 0.6 },
      ],
    } as unknown as H30Conclusion;
    const m = h30Message(g, c);
    expect(m.lines[0]).toBe("Konsensus CPI MoM: 0,3% · model P50 0,3% (P10–P90 0,2–0,4%)");
    expect(m.lines[1]).toBe("Bias H-30 (bukan sinyal): DXY naik 60% · XAU/USD turun 58%");
  });
});

describe("the first five minutes", () => {
  const bar = (min: number, close: number) => ({ time: (T + min * 60_000) / 1000, open: close, high: close, low: close, close, volume: 0 });
  const series = {
    "OANDA:XAUUSD": [bar(-2, 4000), bar(-1, 4000), bar(0, 3990), bar(4, 3980), bar(5, 3970)],
    "TVC:US02Y": [bar(-1, 3.5), bar(4, 3.56)],
    "BITSTAMP:BTCUSD": [bar(-1, 80_000)], // no bar five minutes on
    "TVC:DXY": [bar(-30, 100), bar(4, 100.2)], // stale before the release
  };

  it("moves from the last close before the release to the close five minutes after", () => {
    const m = fiveMinuteMoves(series, T);
    expect(m.map((x) => x.key)).toEqual(["xau", "us2y"]);
    expect(m[0].move).toBeCloseTo(-0.5);
    expect(m[1].move).toBeCloseTo(6);
  });

  it("says the moves and how many went the surprise's way", () => {
    const [g] = groupReleases([cpi(0.4)]);
    const m = reactionMessage(g, fiveMinuteMoves(series, T))!;
    expect(m.title).toBe("Reaksi 5 menit · CPI MoM");
    expect(m.lines[0]).toBe("XAU/USD −0,5% · Yield 2Y +6 bp");
    // Hawkish: gold down and the 2-year up both agree.
    expect(m.lines[1]).toBe("Searah kejutan hawkish: 2 dari 2");
    expect(reactionMessage(g, [])).toBeNull();
  });
});

describe("the toast", () => {
  it("escapes its text, and passes the XML to PowerShell in base64", () => {
    const xml = toastXml('CPI <0,4%> & "panas"', ["a", "b", "c"]);
    expect(xml).toContain("<text>CPI &lt;0,4%&gt; &amp; &quot;panas&quot;</text><text>a</text><text>b</text></binding>");
    const script = toastScript(xml, "IhsanMP.OpenTerminal");
    expect(script).toContain(Buffer.from(xml, "utf8").toString("base64"));
    expect(script).toContain("CreateToastNotifier('IhsanMP.OpenTerminal')");
    expect(script).not.toContain("<toast>");
  });
});
