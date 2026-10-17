import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The watch end to end, on a made-up CPI morning: nothing shown on screen, no network.
const h = vi.hoisted(() => ({ dir: "", shown: [] as Array<{ title: string; lines: string[] }>, calendar: [] as unknown[], live: [] as unknown[] }));
h.dir = mkdtempSync(join(tmpdir(), "ot-notify-"));

vi.mock("../db.js", () => ({ dataDir: h.dir }));
vi.mock("../cache.js", () => ({ cached: <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn() }));
vi.mock("./toast.js", () => ({
  toastsSupported: () => true,
  showToast: async (title: string, lines: string[]) => {
    h.shown.push({ title, lines });
    return true;
  },
}));
vi.mock("../providers/fedlive.js", () => ({ fedLive: async () => ({ checkedAt: 0, live: h.live, upcoming: [], schedule: [] }) }));
vi.mock("../providers/tvchart.js", () => ({
  bars: async () => {
    const bar = (min: number, close: number) => ({ time: (T + min * 60_000) / 1000, open: close, high: close, low: close, close, volume: 0 });
    return { "OANDA:XAUUSD": [bar(-1, 4000), bar(4, 3980)], "TVC:US02Y": [bar(-1, 3.5), bar(4, 3.55)] };
  },
}));

const at = "2026-11-10T13:30:00.000Z";
const T = Date.parse(at);
const release = (actual: number | null) => ({ title: "Inflation Rate MoM", date: at, importance: 1, actual, forecast: 0.3, unit: "%" });
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response(JSON.stringify({ status: "ok", result: h.calendar }))) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { check, updateSettings, recent } = await import("./notifier.js");
const MIN = 60_000;

describe("the notification watch", () => {
  beforeEach(() => {
    h.shown.length = 0;
  });

  it("notifies H-30, the result and the first five minutes, each once", async () => {
    h.calendar = [release(null)];
    await check(T - 40 * MIN);
    expect(h.shown).toEqual([]);
    // Inside the half hour, without the engine's conclusion: waits for H-25.
    await check(T - 29 * MIN);
    expect(h.shown).toEqual([]);
    await check(T - 24 * MIN);
    expect(h.shown.map((s) => s.title)).toEqual([expect.stringMatching(/^30 menit lagi .*CPI MoM$/)]);
    await check(T - 23 * MIN);
    expect(h.shown).toHaveLength(1);

    // Out, but the calendar doesn't have the actual yet: nothing.
    await check(T + 0.5 * MIN);
    expect(h.shown).toHaveLength(1);
    h.calendar = [release(0.4)];
    await check(T + 1.5 * MIN);
    expect(h.shown[1]).toEqual({ title: "CPI MoM: 0,4% (konsensus 0,3%)", lines: ["lebih panas/kuat dari perkiraan → hawkish"] });

    await check(T + 6 * MIN);
    expect(h.shown[2]).toEqual({ title: "Reaksi 5 menit · CPI MoM", lines: ["XAU/USD −0,5% · Yield 2Y +5 bp", "Searah kejutan hawkish: 2 dari 2"] });
    await check(T + 7 * MIN);
    expect(h.shown).toHaveLength(3);
    expect(recent().slice(0, 3).map((r) => r.kind)).toEqual(["reaction", "result", "h30"]);
  });

  it("notifies a Fed broadcast going live once, and not a kind turned off", async () => {
    h.calendar = [];
    h.live = [{ videoId: "abcdefghijk", title: "Chair Powell press conference", channel: "Federal Reserve", status: "live", start: null }];
    await check(T + 60 * MIN);
    expect(h.shown.map((s) => s.title)).toEqual(["The Fed LIVE: Chair Powell press conference"]);
    await check(T + 63 * MIN);
    expect(h.shown).toHaveLength(1);

    updateSettings({ fed: false });
    h.live = [{ videoId: "zyxwvutsrqp", title: "Governor speech", channel: "Federal Reserve", status: "live", start: null }];
    await check(T + 66 * MIN);
    expect(h.shown).toHaveLength(1);
  });
});
