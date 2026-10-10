import { describe, expect, it } from "vitest";
import { buildRecap, sectorsOf, toneOfItem, type RecapInput } from "./recap.js";

const DAY = Date.UTC(2026, 9, 9);
let n = 0;
function item(title: string, extra: Partial<RecapInput> = {}): RecapInput {
  n++;
  return {
    id: `id${n}`,
    title,
    link: `https://example.com/${n}`,
    summary: "",
    publisher: `Outlet ${n}`,
    feedId: "x",
    category: "MARKETS",
    region: "GLOBAL",
    tier: 2,
    publishedAt: new Date(DAY + n * 60_000).toISOString(),
    ...extra,
  };
}
const sectors = (title: string, extra: Partial<RecapInput> = {}) => sectorsOf({ title, summary: "", category: "MARKETS", feedId: "x", ...extra });
const tone = (title: string) => toneOfItem({ title, summary: "" });

describe("news recap", () => {
  it("files headlines under their sector", () => {
    expect(sectors("Oil prices jump as OPEC+ agrees deeper output cuts")[0]).toBe("energy");
    expect(sectors("Fed holds interest rates steady, Powell signals patience")[0]).toBe("macro");
    expect(sectors("Nvidia unveils new AI chip for data centers")[0]).toBe("tech");
    expect(sectors("Bitcoin tops $120,000 as crypto ETFs draw inflows")[0]).toBe("crypto");
    expect(sectors("Gold hits record as miners rally")[0]).toBe("materials");
    expect(sectors("Pfizer wins FDA approval for new cancer drug")[0]).toBe("health");
    expect(sectors("JPMorgan profit rises as bank lending grows")[0]).toBe("financials");
    expect(sectors("IHSG ditutup menguat, saham perbankan memimpin")).toContain("equities");
    // A place name is not a bank, and the feed's beat counts when the words don't say.
    expect(sectors("Palestinian man killed in West Bank")[0]).toBe("geopolitics");
    expect(sectors("Statement on the latest meeting", { feedId: "fed-press", category: "REGULATORY" })[0]).toBe("macro");
    expect(sectors("A painting stolen from a museum has been found")).toEqual(["other"]);
    // Two sectors when the second has clear evidence of its own.
    expect(sectors("Oil surges as Iran war fears grow, sanctions tighten").sort()).toEqual(["energy", "geopolitics"]);
  });

  it("reads the tone of a headline, phrases and negation included", () => {
    expect(tone("Stocks rally to record high on strong earnings")).toBe(1);
    expect(tone("Shares plunge after profit warning")).toBe(-1);
    expect(tone("Fed signals rate cuts ahead")).toBe(1); // a rate cut is good news, a cut alone isn't
    expect(tone("Company announces job cuts")).toBe(-1);
    expect(tone("Inflation rises more than expected")).toBe(-1);
    expect(tone("Economy does not slow, data show")).toBe(1);
    expect(tone("Central bank publishes its annual report")).toBe(0);
    expect(tone("Saham BBCA menguat, laba naik")).toBe(1);
  });

  it("groups one story told by several outlets, and ranks it first", () => {
    const items = [
      item("Oil prices jump after OPEC agrees surprise output cut", { tier: 1, publisher: "Reuters" }),
      item("OPEC agrees surprise output cut, oil prices jump", { publisher: "Bloomberg" }),
      item("Oil prices jump as OPEC agrees surprise cut in output", { publisher: "CNBC" }),
      item("Refinery fire halts gasoline output in Texas", { publisher: "AP" }),
      item("Natural gas prices slump on mild weather", { publisher: "MarketWatch" }),
    ];
    const recap = buildRecap(items, [], DAY, DAY + 86_400_000, "day");
    const energy = recap.sectors.find((s) => s.id === "energy")!;
    expect(energy.count).toBe(5);
    expect(energy.stories[0].publishers).toBe(3);
    expect(energy.stories[0].headline.publisher).toBe("Reuters"); // the best tier tells it
    expect(energy.stories[0].related).toHaveLength(2);
    expect(energy.stories).toHaveLength(3);
    expect(energy.conclusion).toContain("5 berita dari 5 sumber");
    expect(energy.conclusion).toContain("(3 sumber)");
    expect(recap.summary).toContain("Energi");
  });

  it("keeps to the period, counts a headline once, and compares with the period before", () => {
    const today = [
      item("Bitcoin slumps as crypto selloff deepens"),
      item("Bitcoin slumps as crypto selloff deepens", { publisher: "Outlet 1" }), // the same, twice
      item("Ether falls, crypto losses mount on fears"),
      item("Crypto exchange hacked, tokens stolen"),
      item("Tomorrow's crypto news", { publishedAt: new Date(DAY + 86_400_000 + 1).toISOString() }),
    ];
    today[1].publisher = today[0].publisher;
    const yesterday = [item("Bitcoin rallies to record"), item("Crypto stocks surge on approval")];
    const recap = buildRecap(today, yesterday, DAY, DAY + 86_400_000, "day");
    const crypto = recap.sectors.find((s) => s.id === "crypto")!;
    expect(crypto.count).toBe(3);
    expect(crypto.negative).toBe(3);
    expect(crypto.toneLabel).toBe("negatif");
    expect(crypto.previous).toEqual({ count: 2, tone: 1 });
    expect(crypto.conclusion).toContain("Dibanding kemarin, pemberitaan lebih ramai (+50%) dan nadanya memburuk.");
    // Without a full record of yesterday, no comparison.
    const alone = buildRecap(today, null, DAY, DAY + 86_400_000, "day").sectors.find((s) => s.id === "crypto")!;
    expect(alone.previous).toBeNull();
    expect(alone.conclusion).not.toContain("Dibanding");
  });

  it("names the topics several stories share", () => {
    const items = [
      item("Nvidia shares climb on Blackwell demand"),
      item("Microsoft signs Nvidia Blackwell supply deal"),
      item("Apple unveils new iPhone software"),
      item("Google cloud revenue beats forecasts"),
      item("Oil prices steady"),
    ];
    const tech = buildRecap(items, [], DAY, DAY + 86_400_000, "day").sectors.find((s) => s.id === "tech")!;
    expect(tech.topics[0]).toMatch(/Nvidia|Blackwell/);
  });

  it("says so when there is nothing yet", () => {
    const recap = buildRecap([], null, DAY, DAY + 7 * 86_400_000, "week");
    expect(recap.sectors).toEqual([]);
    expect(recap.summary).toBe("Belum ada berita yang terekam untuk minggu ini.");
  });
});
