import { describe, expect, it } from "vitest";
import { GROUPS, HUBS } from "../menu";
import { respond } from "./answer";
import { GUIDE, guideEntries, guideFor } from "./app-guide";
import { chatEnv, eventsFrom } from "./env";

const NOW = Date.UTC(2026, 9, 20, 12);
const TODAY = Math.floor(NOW / 86_400_000);
const env = chatEnv(eventsFrom(TODAY - 400, TODAY + 400), undefined, NOW);

describe("the app's guide", () => {
  it("covers every menu item and every hub tab", () => {
    const ids = new Set(GUIDE.map((g) => g.id));
    for (const item of GROUPS.flatMap((g) => g.items)) expect(ids, item.view).toContain(item.view);
    for (const tab of Object.values(HUBS).flatMap((h) => h.tabs)) expect(ids, tab.type).toContain(tab.type);
  });

  it("finds the menu a question names, the longer name before the one inside it", () => {
    expect(guideEntries("fungsi menu market participant apa")[0].id).toBe("participants");
    expect(guideEntries("cara baca cot")[0].id).toBe("cot");
    expect(guideEntries("harga emas hari ini")).toEqual([]);
  });

  it("answers offline what a menu shows and how to read it", () => {
    const cot = respond("cara baca COT gimana?", env);
    expect(cot.text).toMatch(/Positioning \(COT\)/);
    expect(cot.text).toMatch(/Cara membaca/);
    expect(respond("apa fungsi menu ETF?", env).text).toMatch(/peta rotasi sektor/i);
    expect(respond("menu apa saja yang ada?", env).text).toMatch(/Macro Regime[\s\S]*Astro Calendar/);
  });

  it("answers about the page open now", () => {
    expect(respond("halaman ini apa?", { ...env, view: "fiscal" }).text).toMatch(/Fiscal Policy/);
    expect(respond("cara bacanya gimana? halaman ini", { ...env, view: "regime" }).text).toMatch(/Macro Regime/);
  });

  it("leaves the other questions to the rest of the chat", () => {
    expect(respond("apa itu support?", env).text).not.toMatch(/Cara membaca:/);
    expect(respond("harga emas 12 mei 2024", env).text).not.toMatch(/Cara membaca:/);
  });

  it("goes online with the index, and the open page and the ones asked about in full", () => {
    const g = guideFor("cara baca COT", "etf");
    expect(g).toMatch(/Halaman yang dibuka pengguna: ETF/);
    expect(g).toMatch(/\*\*ETF\*\* \(Flow & Participants → ETF\)\n/);
    expect(g).toMatch(/\*\*Positioning \(COT\)\*\* \(Market Participant/);
    expect(g.length).toBeLessThan(14_000);
  });
});
