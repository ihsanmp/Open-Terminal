import { describe, expect, it } from "vitest";
import { respond, type Context } from "./answer";
import { chatEnv, eventsFrom } from "./env";
import { TOPICS, findTopic } from "./knowledge";
import { parse, timeOf } from "./text";
import { correlation, maxDrawdown, performance, spanStudy } from "./stats";

const NOW = Date.UTC(2026, 9, 20, 12);
const TODAY = Math.floor(NOW / 86_400_000);
const day = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
const env = chatEnv(eventsFrom(day(1990, 1, 1), TODAY + 500), undefined, NOW);

describe("reading a question", () => {
  it("finds the asset, planet, event, time and measure, in Indonesian or English", () => {
    const q = parse("Bagaimana emas selama Merkurius retrograde tahun 2024?", TODAY);
    expect(q).toMatchObject({ assets: ["GOLD"], planets: ["Mercury"], event: "retrograde", asksImpact: true });
    expect(q.span).toMatchObject({ from: day(2024, 1, 1), to: day(2024, 12, 31) });
    expect(parse("harga bitcoin 12 mei 2024", TODAY)).toMatchObject({ assets: ["BTC"], day: day(2024, 5, 12), metric: "price" });
    expect(parse("next full moon", TODAY)).toMatchObject({ event: "full-moon", when: "next" });
    expect(parse("korelasi emas dan dxy", TODAY)).toMatchObject({ assets: ["GOLD", "DXY"], metric: "correlation" });
    expect(parse("saya rasa gerhana bikin btc turun", TODAY)).toMatchObject({ claims: true, event: "eclipse", direction: "down" });
  });

  it("reads days and spans, written out or relative", () => {
    expect(timeOf("2024-05-12", TODAY).day).toBe(day(2024, 5, 12));
    expect(timeOf("12/05/2024", TODAY).day).toBe(day(2024, 5, 12));
    expect(timeOf("mei 2024", TODAY).span).toMatchObject({ from: day(2024, 5, 1), to: day(2024, 5, 31) });
    expect(timeOf("antara 2020 dan 2022", TODAY).span).toMatchObject({ from: day(2020, 1, 1), to: day(2022, 12, 31) });
    expect(timeOf("30 hari terakhir", TODAY).span).toMatchObject({ from: TODAY - 30, to: TODAY });
    expect(timeOf("tahun ini", TODAY).span).toMatchObject({ from: day(2026, 1, 1), to: TODAY });
  });

  it("knows its topics by the words used", () => {
    expect(findTopic(parse("apa itu support dan resistance", TODAY).text)?.id).toBe("support-resistance");
    expect(findTopic(parse("jelaskan halving bitcoin", TODAY).text)?.id).toBe("btc-halving");
    expect(findTopic(parse("apa itu periode shadow", TODAY).text)?.id).toBe("shadow");
    expect(TOPICS.every((t) => t.body && t.deeper && t.related.every((r) => TOPICS.some((x) => x.id === r)))).toBe(true);
  });
});

describe("the numbers", () => {
  const gold = env.series("GOLD");
  it("dates gold by the day its session closes, so it lines up with the dollar", () => {
    // Gold's bars are stamped the evening before; a Sunday stamp is Monday's session.
    expect([...gold.days.slice(-200)].some((d) => new Date(d * 86_400_000).getUTCDay() === 0)).toBe(false);
    expect(correlation(gold, env.series("DXY"), TODAY - 5 * 365, TODAY).r).toBeLessThan(-0.25);
  });

  it("finds gold's 2011–2015 fall and a year's performance", () => {
    const dd = maxDrawdown(gold, day(2011, 1, 1), day(2016, 12, 31))!;
    expect(dd.pct).toBeLessThan(-40);
    expect(new Date(dd.peakDay * 86_400_000).getUTCFullYear()).toBe(2011);
    const p = performance(env.series("BTC"), day(2022, 1, 1), day(2022, 12, 31))!;
    expect(p.retPct).toBeLessThan(-55);
  });

  it("compares spans with ordinary windows of the same length", () => {
    const s = spanStudy(gold, [2000, 2004, 2008, 2012, 2016, 2020].map((y) => ({ from: day(y, 3, 1), to: day(y, 3, 21) })))!;
    expect(s.n).toBe(6);
    expect(s.windows).toHaveLength(6);
    expect(Number.isFinite(s.t)).toBe(true);
  });
});

describe("answering", () => {
  it("answers when the next Mercury retrograde is, to the minute", () => {
    const r = respond("Kapan Merkurius retrograde berikutnya?", env);
    expect(r.text).toMatch(/24 Oktober 2026/);
    expect(r.text).toMatch(/Scorpio 20°5\d′/);
    expect(r.ctx).toMatchObject({ intent: "timing", planet: "Mercury" });
  });

  it("tests a stated view against the data and asks back", () => {
    const r = respond("saya rasa gerhana bikin bitcoin turun", env);
    expect(r.text).toMatch(/Mari kita uji/);
    expect(r.text).toMatch(/Pendapat saya/);
    expect(r.text).toMatch(/\?/);
    expect(r.ctx.intent).toBe("discuss");
  });

  it("carries on only when replied to: a reply continues the thread, a new message starts afresh", () => {
    const first = respond("Bagaimana emas selama Merkurius retrograde?", env);
    expect(first.text).toMatch(/Emas \(XAU\/USD\)\*\* selama Merkurius retrograde/);
    // Replied to: "kalau BTC?" is about Bitcoin during Mercury retrogrades.
    const replied = respond("kalau BTC?", env, first.ctx);
    expect(replied.text).toMatch(/Bitcoin\*\* selama Merkurius retrograde/);
    // Not replied to (a fresh context): the same words are a new question about Bitcoin.
    const fresh = respond("kalau BTC?", env, {});
    expect(fresh.text).not.toMatch(/retrograde/);
    // "Kenapa?" goes deeper only on what it replies to.
    const why = respond("kenapa?", env, first.ctx as Context);
    expect(why.text).toMatch(/lebih dalam|Cara menguji/);
    expect(respond("kenapa?", env, {}).text).toMatch(/belum menangkap|Halo|bisa ditanyakan/);
  });

  it("gives a close on a date, a year's performance, and what it knows", () => {
    expect(respond("harga emas 12 mei 2024", env).text).toMatch(/2\.3\d\d,\d\d pada penutupan 10 Mei 2024/);
    expect(respond("kinerja btc tahun 2024", env).text).toMatch(/\+1\d\d,\d\d%/);
    expect(respond("apa itu fomc", env).text).toMatch(/FOMC/);
    expect(respond("menurutmu astrologi berpengaruh ke harga?", env).text).toMatch(/Pendapat saya/);
  });
});
