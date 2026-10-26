// The Astro Calendar's chat (offline, no AI): a question read (text.ts), answered from the app's
// own data and calculations (the planets' positions, retrogrades, eclipses, the daily closes of
// gold, bitcoin and the dollar index, the quant forecasts) or from what it knows (knowledge.ts).
// It keeps the conversation's thread (the asset, the planet, the topic, the last kind of answer), so
// "kalau BTC?", "tahun 2022?", "kenapa?" carry on from it; a view stated ("saya rasa Merkurius
// retrograde bikin emas turun") is tested against the data and answered, with a question back.

import type { AstroEvent } from "../astro-calendar/events";
import { GLYPH, position, SIGNS } from "../astro-calendar/events";
import { WALK_FORWARD, type Asset, type Series } from "../astro-calendar/impact";
import type { RetroPeriod, RetroPlanet, SunIngress } from "../astro-calendar/retrograde";
import type { QuantForecast } from "../quant";
import { ASKS_GUIDE, ASKS_MENU_LIST, ASKS_THIS_PAGE, guideById, guideEntries, guideIndex, guideText, type GuideEntry } from "./app-guide";
import { findTopic, topicById, TOPICS } from "./knowledge";
import { afterStudy, allTimeHigh, closeOn, correlation, extremeDays, maxDrawdown, performance, seasonality, spanStudy, streaks, type Study } from "./stats";
import { parse, type Metric, type Parsed, type Planet, type SkyEvent, type Span } from "./text";

export type Env = {
  /** Today, as a UTC day number. */
  today: number;
  series: (a: Asset) => Series;
  /** The calendar's events (null while it's still being worked out). */
  events: AstroEvent[] | null;
  retro: (planet: RetroPlanet, from: number, to: number) => RetroPeriod[];
  sun: (year: number) => SunIngress[];
  /** Apparent geocentric longitude of a planet at unix ms. */
  longitude: (planet: Planet, ms: number) => number;
  forecast?: QuantForecast;
  /** The page open in the app (store/terminal View), for "halaman ini apa?". */
  view?: string | null;
};

export type Intent = "timing" | "impact" | "position" | "stats" | "price" | "forecast" | "topic" | "discuss" | "sun";
export type Context = {
  intent?: Intent;
  assets?: Asset[];
  planet?: Planet | null;
  event?: SkyEvent | null;
  span?: Span | null;
  day?: number | null;
  metric?: Metric | null;
  topic?: string | null;
  /** How many times "kenapa?" has gone deeper on the same thing. */
  depth?: number;
};
export type Reply = { text: string; suggestions: string[]; ctx: Context };

const DAY_MS = 86_400_000;
const NAME: Record<Asset, string> = { GOLD: "Emas (XAU/USD)", BTC: "Bitcoin", DXY: "Indeks dolar (DXY)" };
const SHORT: Record<Asset, string> = { GOLD: "emas", BTC: "BTC", DXY: "DXY" };
const PLANET_ID: Record<Planet, string> = {
  Mercury: "Merkurius", Venus: "Venus", Mars: "Mars", Jupiter: "Jupiter", Saturn: "Saturnus", Uranus: "Uranus", Neptune: "Neptunus", Pluto: "Pluto", Sun: "Matahari", Moon: "Bulan",
};
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const fmtDay = (day: number) => new Date(day * DAY_MS).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtMs = (ms: number) => new Date(Math.round(ms / 60_000) * 60_000).toLocaleString("id-ID", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const num = (v: number, d = 2) => v.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number, d = 2) => `${v > 0 ? "+" : ""}${num(v, d)}%`;
const price = (a: Asset, v: number) => (a === "DXY" ? num(v, 2) : `$${num(v, a === "BTC" ? 0 : 2)}`);
const dayOfMs = (ms: number) => Math.floor(ms / DAY_MS);

// ---------------------------------------------------------------- help and small talk

const EXAMPLES = [
  "Kapan Merkurius retrograde berikutnya?",
  "Bagaimana emas selama Merkurius retrograde?",
  "Saya rasa gerhana bikin bitcoin turun",
  "Kinerja BTC tahun 2024",
  "Drawdown terbesar emas sepanjang masa",
  "Pola musiman emas",
  "Korelasi emas dan DXY 5 tahun terakhir",
  "Posisi Mars sekarang",
  "Apa itu support dan resistance?",
  "Menurutmu astrologi berpengaruh ke harga?",
];

function help(): Reply {
  return {
    text:
      "Saya asisten offline Astro Calendar: menjawab dari data dan hitungan aplikasi ini sendiri, tanpa AI berbayar dan tanpa internet. Yang bisa ditanyakan:\n" +
      "• **Langit**: kapan retrograde/gerhana/purnama/bulan baru berikutnya atau terakhir, posisi planet hari ini atau pada tanggal tertentu, kapan Matahari masuk suatu zodiak.\n" +
      "• **Pengaruh ke harga**: emas, BTC, atau DXY selama retrograde, sesudah gerhana, purnama, bulan baru, aspek planet, dibandingkan dengan hari-hari biasa.\n" +
      "• **Data historis**: harga pada tanggal tertentu, kinerja suatu bulan/tahun/periode, volatilitas, drawdown, kenaikan/penurunan beruntun, hari terbaik/terburuk, pola musiman, korelasi, rekor tertinggi.\n" +
      "• **Price action dan makro**: support/resistance, tren, breakout, candlestick, manajemen risiko, FOMC, CPI, DXY, halving, dan lainnya.\n" +
      "• **Diskusi**: sampaikan pendapat atau klaim Anda, saya uji dengan data. Tanyakan \"kenapa?\" untuk penjelasan lebih dalam, atau \"kalau BTC?\" untuk melanjutkan topik yang sama.",
    suggestions: EXAMPLES.slice(0, 6),
    ctx: {},
  };
}

// ---------------------------------------------------------------- the sky

const isRetro = (p: Planet | null | undefined): p is RetroPlanet => !!p && p !== "Sun" && p !== "Moon";

function timing(q: Parsed, env: Env, ctx: Context): Reply {
  const now = env.today * DAY_MS;
  const event = q.event ?? ctx.event ?? "retrograde";
  const planet = q.planets[0] ?? (event === "retrograde" || event === "direct" ? ctx.planet ?? "Mercury" : ctx.planet ?? null);
  const next: Context = { intent: "timing", event, planet, assets: ctx.assets };

  if ((event === "retrograde" || event === "direct") && isRetro(planet)) {
    // A year asked: its periods; otherwise the one running, the next, and the last.
    if (q.span && q.span.to - q.span.from >= 300) {
      const y = new Date(q.span.from * DAY_MS).getUTCFullYear();
      const list = env.retro(planet, Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1));
      return {
        text: list.length
          ? `**${PLANET_ID[planet]} retrograde ${y}** (waktu lokal):\n${list.map((p, k) => `${k + 1}. ${fmtMs(p.start.time)} (${position(p.start.lon)}) → ${fmtMs(p.end.time)} (${position(p.end.lon)}), ${Math.round((p.end.time - p.start.time) / DAY_MS)} hari`).join("\n")}`
          : `${PLANET_ID[planet]} tidak retrograde sepanjang ${y}.`,
        suggestions: [`Bagaimana emas selama ${PLANET_ID[planet]} retrograde?`, "Apa itu periode shadow?", `${PLANET_ID[planet]} retrograde ${y + 1}`],
        ctx: next,
      };
    }
    const list = env.retro(planet, now - 400 * DAY_MS, now + 900 * DAY_MS);
    const running = list.find((p) => p.start.time <= Date.now() && p.end.time >= Date.now());
    const upcoming = list.find((p) => p.start.time > Date.now());
    const past = [...list].reverse().find((p) => p.end.time < Date.now());
    const lines: string[] = [];
    if (running) lines.push(`**Sedang retrograde** sejak ${fmtMs(running.start.time)} di ${position(running.start.lon)}, kembali direct ${fmtMs(running.end.time)} di ${position(running.end.lon)} (sisa ${Math.ceil((running.end.time - Date.now()) / DAY_MS)} hari).`);
    if (upcoming && q.when !== "last") lines.push(`**Berikutnya**: ${fmtMs(upcoming.start.time)} di ${position(upcoming.start.lon)} → direct ${fmtMs(upcoming.end.time)} di ${position(upcoming.end.lon)}, ${Math.round((upcoming.end.time - upcoming.start.time) / DAY_MS)} hari (${Math.ceil((upcoming.start.time - Date.now()) / DAY_MS)} hari lagi).${upcoming.shadowStart ? ` Pre-shadow mulai ${fmtMs(upcoming.shadowStart)}.` : ""}`);
    if (past && (q.when === "last" || !upcoming || lines.length < 2)) lines.push(`**Terakhir**: ${fmtMs(past.start.time)} → ${fmtMs(past.end.time)} (${position(past.start.lon)} → ${position(past.end.lon)}).`);
    if (!lines.length) lines.push(`Tidak ada retrograde ${PLANET_ID[planet]} dalam rentang dua tahun dari sekarang.`);
    return {
      text: `${GLYPH[planet] ?? ""} ${PLANET_ID[planet]} retrograde (waktu lokal):\n${lines.join("\n")}`,
      suggestions: [`Bagaimana emas selama ${PLANET_ID[planet]} retrograde?`, `Bagaimana BTC selama ${PLANET_ID[planet]} retrograde?`, "Apa itu retrograde?"],
      ctx: next,
    };
  }

  // Eclipses, lunations, ingresses, aspects: from the calendar's events.
  if (!env.events) return { text: "Posisi planet masih dihitung, coba lagi sebentar lagi.", suggestions: [], ctx: next };
  const match = eventFilter(event, planet, q);
  const nowSec = Date.now() / 1000;
  const list = env.events.filter(match);
  const after = list.filter((e) => e.time > nowSec);
  const before = list.filter((e) => e.time <= nowSec);
  // Nothing ahead within the calendar's reach (±500 days): the last ones, said so.
  const lastOnes = q.when === "last" || !after.length;
  const show = lastOnes ? before.slice(-3).reverse() : after.slice(0, 3);
  if (!show.length) return { text: `Tidak ada kejadian seperti itu dalam data kalender (1990 sampai ±500 hari ke depan).`, suggestions: EXAMPLES.slice(0, 3), ctx: next };
  return {
    text: `${q.when !== "last" && !after.length ? "Tidak ada dalam ±500 hari ke depan (batas kalender). " : ""}${lastOnes ? "Yang terakhir" : "Berikutnya"}:\n${show.map((e) => `• ${e.glyph} **${e.title}**, ${fmtMs(e.time * 1000)}: ${e.detail}`).join("\n")}`,
    suggestions: [`Bagaimana emas sesudah ${eventWord(event)}?`, `Bagaimana BTC sesudah ${eventWord(event)}?`, `Apa itu ${eventWord(event)}?`],
    ctx: next,
  };
}

const eventWord = (e: SkyEvent) =>
  ({ retrograde: "retrograde", direct: "direct", eclipse: "gerhana", "solar-eclipse": "gerhana matahari", "lunar-eclipse": "gerhana bulan", "full-moon": "purnama", "new-moon": "bulan baru", ingress: "ingress", aspect: "aspek planet", season: "pergantian musim" })[e];

function eventFilter(event: SkyEvent, planet: Planet | null | undefined, q: Parsed): (e: AstroEvent) => boolean {
  return (e) => {
    switch (event) {
      case "solar-eclipse":
        return e.kind === "eclipse" && /solar/i.test(e.title);
      case "lunar-eclipse":
        return e.kind === "eclipse" && /lunar/i.test(e.title);
      case "eclipse":
        return e.kind === "eclipse";
      case "full-moon":
        return e.kind === "lunation" && /full/i.test(e.title);
      case "new-moon":
        return e.kind === "lunation" && /new/i.test(e.title);
      case "retrograde":
      case "direct":
        return e.kind === "station" && (event === "retrograde" ? /Retrograde/.test(e.title) : /Direct/.test(e.title)) && (!planet || e.bodies.includes(planet));
      case "ingress":
      case "season":
        // By its keys: the Sun's cardinal ingresses are titled by the season ("Ekuinoks Maret").
        return e.kind === "ingress" && (!planet || e.bodies.includes(planet)) && (q.sign === null || e.keys.some((k) => k.endsWith(`:${SIGNS[q.sign!]}`)));
      case "aspect": {
        const name = { conj: "Conjunction", square: "Square", opposition: "Opposition", trine: "Trine", sextile: "Sextile" }[q.aspect ?? "conj"];
        return e.kind === "aspect" && (!q.aspect || e.title.includes(name)) && q.planets.filter((p) => p !== "Moon").every((p) => e.bodies.includes(p));
      }
    }
  };
}

function position_(q: Parsed, env: Env, ctx: Context): Reply {
  const planets = q.planets.length ? q.planets : ctx.planet ? [ctx.planet] : (["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as Planet[]);
  const ms = q.day !== null ? q.day * DAY_MS + 12 * 3_600_000 : Date.now();
  const lines = planets.map((p) => {
    const lon = env.longitude(p, ms);
    const back = env.longitude(p, ms - 3_600_000 * 12);
    const rx = p !== "Sun" && p !== "Moon" && ((lon - back + 540) % 360) - 180 < 0;
    return `• ${GLYPH[p] ?? ""} **${PLANET_ID[p]}**: ${position(lon)}${rx ? " (retrograde)" : ""}`;
  });
  return {
    text: `Posisi ${q.day !== null ? `pada ${fmtDay(q.day)}` : "saat ini"} (zodiak tropis, geosentris):\n${lines.join("\n")}`,
    suggestions: ["Apa beda zodiak tropis dan sideris?", "Kapan Merkurius retrograde berikutnya?", "Zodiak Matahari sekarang"],
    ctx: { ...ctx, intent: "position", planet: planets.length === 1 ? planets[0] : ctx.planet },
  };
}

function sun(q: Parsed, env: Env, ctx: Context): Reply {
  const y = q.span ? new Date(q.span.from * DAY_MS).getUTCFullYear() : new Date(env.today * DAY_MS).getUTCFullYear();
  const list = [...env.sun(y - 1), ...env.sun(y), ...env.sun(y + 1)];
  const now = Date.now();
  if (q.sign !== null) {
    const hits = list.filter((x) => x.sign === q.sign);
    const next = hits.find((x) => x.time > now) ?? hits.at(-1)!;
    return {
      text: `☉ Matahari masuk **${SIGNS[q.sign]}**: ${fmtMs(next.time)} (waktu lokal)${next.season ? `, ${{ spring: "ekuinoks Maret", summer: "solstis Juni", autumn: "ekuinoks September", winter: "solstis Desember" }[next.season]}` : ""}.`,
      suggestions: ["Pola musiman emas", "Apa itu efek musim (Sell in May)?", "Zodiak Matahari sekarang"],
      ctx: { ...ctx, intent: "sun" },
    };
  }
  const cur = [...list].reverse().find((x) => x.time <= now)!;
  const nxt = list.find((x) => x.time > now)!;
  return {
    text: `☉ Matahari sekarang di **${SIGNS[cur.sign]}** (sejak ${fmtMs(cur.time)}), masuk **${SIGNS[nxt.sign]}** pada ${fmtMs(nxt.time)}, ${Math.ceil((nxt.time - now) / DAY_MS)} hari lagi.`,
    suggestions: ["Pola musiman emas", "Apa itu efek musim (Sell in May)?", "Kapan Matahari masuk Capricorn?"],
    ctx: { ...ctx, intent: "sun" },
  };
}

// ---------------------------------------------------------------- the sky against prices

const verdictOfT = (t: number) => (t >= 2 ? "lebih tinggi daripada hari biasa, cukup kuat secara statistik" : t >= 1 ? "sedikit lebih tinggi daripada hari biasa, tapi masih dalam batas kebetulan" : t <= -2 ? "lebih rendah daripada hari biasa, cukup kuat secara statistik" : t <= -1 ? "sedikit lebih rendah daripada hari biasa, tapi masih dalam batas kebetulan" : "tidak berbeda dari hari biasa");

/** How an asset moved during a planet's retrogrades, or after events of a kind, against ordinary days. */
function studyFor(asset: Asset, event: SkyEvent, planet: Planet | null | undefined, q: Parsed, env: Env): { study: Study; label: string } | null {
  const s = env.series(asset);
  const firstMs = s.days[0] * DAY_MS;
  if ((event === "retrograde" || event === "direct") && isRetro(planet)) {
    const periods = env.retro(planet, firstMs, env.today * DAY_MS);
    const spans = periods.filter((p) => p.end.time < Date.now()).map((p) => ({ from: dayOfMs(p.start.time), to: dayOfMs(p.end.time) }));
    const st = spanStudy(s, spans);
    return st ? { study: st, label: `selama ${PLANET_ID[planet]} retrograde (dari hari mulai sampai kembali direct)` } : null;
  }
  if (!env.events) return null;
  const nowSec = Date.now() / 1000;
  const times = env.events.filter(eventFilter(event, planet, q)).filter((e) => e.time < nowSec - 20 * 86_400).map((e) => e.time);
  const st = afterStudy(s, times, 10);
  return st ? { study: st, label: `10 hari bursa sesudah ${eventWord(event)}${planet && event !== "eclipse" && event !== "full-moon" && event !== "new-moon" ? ` (${PLANET_ID[planet]})` : ""}` } : null;
}

function describeStudy(asset: Asset, st: Study, label: string, s: Series): string {
  const since = new Date(Math.max(s.days[0], Math.floor(st.windows[0].from)) * DAY_MS).getUTCFullYear();
  const best = [...st.windows].sort((a, b) => b.pct - a.pct)[0];
  const worst = [...st.windows].sort((a, b) => a.pct - b.pct)[0];
  return (
    `**${NAME[asset]}** ${label}, ${st.n} kejadian sejak ${since}:\n` +
    `• Rata-rata ${pct(st.meanPct)}, median ${pct(st.medianPct)}; naik di ${num(st.upPct, 0)}% kejadian.\n` +
    `• Hari biasa dengan panjang sama: rata-rata ${pct(st.baseMeanPct)}, naik ${num(st.baseUpPct, 0)}%.\n` +
    `• Selisihnya ${verdictOfT(st.t)} (t = ${num(st.t, 2)}).\n` +
    `• Terbaik ${pct(best.pct)} (${fmtDay(best.from)}), terburuk ${pct(worst.pct)} (${fmtDay(worst.from)}).`
  );
}

const HONEST =
  "Catatan: dengan banyak jenis kejadian langit yang diuji, sebagian akan tampak \"signifikan\" karena kebetulan. Vonis astrologi Astro Calendar yang diuji walk-forward 2018–2026 benar " +
  `${num((WALK_FORWARD.GOLD.right / WALK_FORWARD.GOLD.calls) * 100, 0)}% untuk emas, ${num((WALK_FORWARD.BTC.right / WALK_FORWARD.BTC.calls) * 100, 0)}% untuk BTC, ${num((WALK_FORWARD.DXY.right / WALK_FORWARD.DXY.calls) * 100, 0)}% untuk DXY: setara lempar koin.`;

function impact(q: Parsed, env: Env, ctx: Context): Reply {
  const event = q.event ?? ctx.event ?? "retrograde";
  const planet = q.planets[0] ?? ctx.planet ?? (event === "retrograde" ? "Mercury" : null);
  const assets = q.assets.length ? q.assets : ctx.assets?.length ? ctx.assets : (["GOLD", "BTC", "DXY"] as Asset[]);
  const parts: string[] = [];
  for (const a of assets) {
    const r = studyFor(a, event, planet, q, env);
    parts.push(r ? describeStudy(a, r.study, r.label, env.series(a)) : `**${NAME[a]}**: belum cukup kejadian dengan data harga untuk diuji.`);
  }
  const other = assets.length === 1 ? (["GOLD", "BTC", "DXY"] as Asset[]).find((x) => x !== assets[0])! : null;
  return {
    text: `${parts.join("\n\n")}\n\n${HONEST}`,
    suggestions: [other ? `Kalau ${SHORT[other]}?` : "Kenapa hasilnya seperti itu?", "Kenapa?", `Kapan ${eventWord(event)} berikutnya?`, "Bagaimana cara menguji klaim astrologi?"],
    ctx: { intent: "impact", event, planet, assets, topic: event === "retrograde" ? "retrograde" : event.includes("eclipse") ? "eclipses" : event.includes("moon") ? "lunar-cycle" : "financial-astrology", depth: 0 },
  };
}

/** A view stated, tested against the data: agreed with, or not, and a question back. */
function discuss(q: Parsed, env: Env, ctx: Context): Reply {
  const event = q.event ?? ctx.event;
  const planet = q.planets[0] ?? ctx.planet ?? (event === "retrograde" ? "Mercury" : null);
  const asset = q.assets[0] ?? ctx.assets?.[0];
  if (!event || !asset) return opinion(q, ctx);
  const r = studyFor(asset, event, planet, q, env);
  if (!r) return { text: `Saya ingin menguji pendapat itu, tapi data ${NAME[asset]} belum cukup untuk kejadian tersebut.`, suggestions: EXAMPLES.slice(0, 3), ctx };
  const st = r.study;
  const claimed = q.direction ?? (st.meanPct >= 0 ? "up" : "down");
  const diff = st.meanPct - st.baseMeanPct;
  const supports = claimed === "down" ? diff < 0 && st.upPct < st.baseUpPct : diff > 0 && st.upPct > st.baseUpPct;
  const strong = Math.abs(st.t) >= 2;
  const verdict = supports
    ? strong
      ? "Data mendukung arah yang Anda sebut, dan cukup kuat secara statistik. Tapi hati-hati: dari puluhan jenis kejadian langit, satu-dua akan tampak kuat karena kebetulan."
      : "Arahnya sesuai dengan yang Anda sebut, tapi selisihnya kecil dan masih dalam batas kebetulan. Saya belum bisa menyebutnya terbukti."
    : "Data tidak mendukung pendapat itu: di masa lalu, " + `${SHORT[asset]} justru ${diff >= 0 ? "tidak lebih lemah" : "tidak lebih kuat"} daripada hari biasa pada kejadian-kejadian itu.`;
  const ask = supports
    ? `Menurut Anda, apa alasan ekonomi yang bisa menjelaskan ${SHORT[asset]} ${claimed === "down" ? "melemah" : "menguat"} saat itu, di luar kebetulan? Kalau tidak ada, saya cenderung menganggapnya pola kebetulan.`
    : "Dari mana pendapat itu biasanya berasal: pengalaman trading Anda sendiri, atau kata orang? Pengalaman pribadi sering mengingat kejadian yang cocok dan melupakan yang tidak (bias konfirmasi).";
  return {
    text: `Mari kita uji: "${q.raw.trim()}".\n\n${describeStudy(asset, st, r.label, env.series(asset))}\n\n**Pendapat saya**: ${verdict}\n\n${ask}`,
    suggestions: ["Bagaimana cara menguji klaim astrologi?", `Kalau ${SHORT[asset === "BTC" ? "GOLD" : "BTC"]}?`, "Kenapa?"],
    ctx: { intent: "discuss", event, planet, assets: [asset], topic: "testing-astro", depth: 0 },
  };
}

function opinion(q: Parsed, ctx: Context): Reply {
  const t = findTopic(q.text);
  const astro = !t || ["financial-astrology", "retrograde", "aspects", "eclipses", "lunar-cycle", "testing-astro", "shadow", "zodiac-systems"].includes(t.id);
  if (!astro && t) return topic(t.id, ctx, `${t.body}\n\n${t.deeper}`);
  return {
    text:
      "**Pendapat saya, berdasarkan data aplikasi ini**: posisi planet belum terbukti menggerakkan harga emas, BTC, atau dolar.\n" +
      `• Vonis astrologi Astro Calendar, diuji walk-forward 2018–2026: emas ${num((WALK_FORWARD.GOLD.right / WALK_FORWARD.GOLD.calls) * 100, 0)}%, BTC ${num((WALK_FORWARD.BTC.right / WALK_FORWARD.BTC.calls) * 100, 0)}%, DXY ${num((WALK_FORWARD.DXY.right / WALK_FORWARD.DXY.calls) * 100, 0)}% benar.\n` +
      "• Fitur retrograde, fase bulan, gerhana, dan aspek tidak menambah akurasi model quant; hanya musim (posisi Matahari) yang dipertahankan.\n" +
      "• Yang punya dukungan akademik hanya efek kalender yang kecil: musim (\"Sell in May\") dan, lebih lemah, fase bulan pada saham.\n\n" +
      "Tapi astrologi bisa berpengaruh **tidak langsung**: kalau cukup banyak trader percaya Merkurius retrograde itu buruk, perilaku mereka sendiri bisa sedikit menggerakkan pasar, walau datanya belum menunjukkan itu untuk emas, BTC, dan DXY.\n\n" +
      "Anda sendiri melihat pola tertentu? Sebutkan kejadian dan asetnya, misalnya \"saya rasa purnama bikin BTC naik\", nanti saya uji dengan data.",
    suggestions: ["Saya rasa Merkurius retrograde bikin emas turun", "Bagaimana cara menguji klaim astrologi?", "Apa itu efek musim (Sell in May)?"],
    ctx: { ...ctx, intent: "discuss", topic: "testing-astro", depth: 0 },
  };
}

// ---------------------------------------------------------------- prices and statistics

function defaultSpan(env: Env, metric: Metric | null): Span {
  const days = metric === "volatility" ? 30 : metric === "correlation" ? 365 : metric === "drawdown" || metric === "streak" || metric === "best-days" ? 365 : 365;
  return { from: env.today - days, to: env.today, label: metric === "volatility" ? "30 hari terakhir" : "1 tahun terakhir" };
}

function stats(q: Parsed, env: Env, ctx: Context): Reply {
  const assets = q.assets.length ? q.assets : ctx.assets?.length ? ctx.assets : (["GOLD"] as Asset[]);
  const metric = q.metric ?? ctx.metric ?? "performance";
  const span = q.span ?? (q.day === null ? ctx.span : null) ?? defaultSpan(env, metric);
  const next: Context = { intent: "stats", assets, metric, span, topic: metric === "volatility" ? "volatility" : metric === "drawdown" ? "drawdown" : metric === "seasonality" ? "seasonality" : null, depth: 0 };
  const parts: string[] = [];

  if (metric === "correlation") {
    const [a, b] = assets.length >= 2 ? assets : [assets[0], assets[0] === "DXY" ? "GOLD" : "DXY"];
    const c = correlation(env.series(a as Asset), env.series(b as Asset), span.from, span.to);
    const longer = correlation(env.series(a as Asset), env.series(b as Asset), env.today - 365 * 5, env.today);
    const word = (r: number) => (Math.abs(r) < 0.1 ? "hampir tidak berhubungan" : `${r > 0 ? "searah" : "berlawanan"}, ${Math.abs(r) >= 0.5 ? "kuat" : Math.abs(r) >= 0.3 ? "sedang" : "lemah"}`);
    return {
      text: `Korelasi return harian **${NAME[a as Asset]}** dan **${NAME[b as Asset]}**, ${span.label}: r = ${num(c.r, 2)} (${word(c.r)}, ${c.n} hari).${Math.abs(span.to - span.from - Math.round(365.25 * 5)) < 10 ? "" : `\n5 tahun terakhir: r = ${num(longer.r, 2)} (${word(longer.r)}).`}\n\nKorelasi berubah dari waktu ke waktu; nilai di atas 0,5 atau di bawah −0,5 baru disebut kuat.`,
      suggestions: ["Apa yang menggerakkan emas?", "Korelasi emas dan BTC tahun 2024", "Apa itu DXY?"],
      ctx: { ...next, assets: [a as Asset, b as Asset] },
    };
  }
  for (const a of assets) {
    const s = env.series(a);
    if (metric === "seasonality") {
      const fromYear = q.span ? new Date(q.span.from * DAY_MS).getUTCFullYear() : new Date(s.days[0] * DAY_MS).getUTCFullYear();
      const ms = seasonality(s, fromYear, env.today).filter((m) => m.years > 0);
      const sorted = [...ms].sort((x, y) => y.meanPct - x.meanPct);
      parts.push(
        `**Pola musiman ${NAME[a]}** (${fromYear}–sekarang, return per bulan kalender):\n` +
          ms.map((m) => `• ${MONTHS[m.month].padEnd(9)} rata-rata ${pct(m.meanPct)}, naik di ${num(m.upYearsPct, 0)}% tahun (${m.years} tahun)`).join("\n") +
          `\nTerkuat: ${MONTHS[sorted[0].month]}; terlemah: ${MONTHS[sorted[sorted.length - 1].month]}.`,
      );
      continue;
    }
    if (metric === "ath") {
      const h = allTimeHigh(s);
      parts.push(`**${NAME[a]}**: rekor penutupan tertinggi ${price(a, h.close)} pada ${fmtDay(h.day)}; harga terakhir ${pct(h.fromHighPct)} dari rekor itu.`);
      continue;
    }
    if (metric === "drawdown") {
      const all = q.span ?? (q.text.includes("sepanjang") ? { from: -1e6, to: env.today, label: "seluruh data" } : span);
      const d = maxDrawdown(s, all.from, all.to);
      parts.push(
        d
          ? `**Drawdown terbesar ${NAME[a]}**, ${all.label}: ${pct(d.pct)} dari ${price(a, d.peak)} (${fmtDay(d.peakDay)}) ke ${price(a, d.trough)} (${fmtDay(d.troughDay)}). ${d.recoveredDay ? `Pulih ke puncak itu pada ${fmtDay(d.recoveredDay)}.` : "Belum kembali ke puncak itu."}`
          : `Data ${NAME[a]} tidak mencakup ${all.label}.`,
      );
      continue;
    }
    if (metric === "streak") {
      const st = streaks(s, span.from, span.to);
      parts.push(
        `**${NAME[a]}**, ${span.label}:\n` +
          (st.up ? `• Naik beruntun terpanjang: ${st.up.length} hari (${fmtDay(st.up.fromDay)} – ${fmtDay(st.up.toDay)}, ${pct(st.up.movePct)}).\n` : "") +
          (st.down ? `• Turun beruntun terpanjang: ${st.down.length} hari (${fmtDay(st.down.fromDay)} – ${fmtDay(st.down.toDay)}, ${pct(st.down.movePct)}).` : ""),
      );
      continue;
    }
    if (metric === "best-days") {
      const e = extremeDays(s, span.from, span.to);
      parts.push(`**${NAME[a]}**, ${span.label}:\n• Hari terbaik: ${e.best.map((x) => `${fmtDay(x.day)} ${pct(x.pct)}`).join("; ")}\n• Hari terburuk: ${e.worst.map((x) => `${fmtDay(x.day)} ${pct(x.pct)}`).join("; ")}`);
      continue;
    }
    const p = performance(s, span.from, span.to);
    if (!p) {
      parts.push(`Data ${NAME[a]} tidak mencakup ${span.label} (tersedia sejak ${fmtDay(s.days[0])}).`);
      continue;
    }
    if (metric === "volatility") {
      parts.push(`**Volatilitas ${NAME[a]}**, ${span.label}: ${num(p.volPct, 1)}% per tahun (simpangan baku return harian disetahunkan), atau rata-rata gerak harian sekitar ${num(p.volPct / Math.sqrt(a === "BTC" ? 365 : 252), 2)}%.`);
      continue;
    }
    parts.push(
      `**${NAME[a]}**, ${span.label}:\n` +
        `• ${price(a, p.startClose)} (${fmtDay(p.fromDay)}) → ${price(a, p.endClose)} (${fmtDay(p.toDay)}): **${pct(p.retPct)}**\n` +
        `• Tertinggi ${price(a, p.high.close)} (${fmtDay(p.high.day)}), terendah ${price(a, p.low.close)} (${fmtDay(p.low.day)})\n` +
        `• Drawdown terbesar ${pct(p.maxDrawdownPct)}, volatilitas ${num(p.volPct, 1)}%/tahun, hari naik ${num(p.upDaysPct, 0)}%`,
    );
  }
  const other = (["GOLD", "BTC", "DXY"] as Asset[]).find((x) => !assets.includes(x))!;
  return {
    text: parts.join("\n\n"),
    suggestions: [`Kalau ${SHORT[other]}?`, metric === "performance" ? `Drawdown terbesar ${SHORT[assets[0]]} ${span.label}` : `Kinerja ${SHORT[assets[0]]} ${span.label}`, `Pola musiman ${SHORT[assets[0]]}`],
    ctx: next,
  };
}

function priceOn(q: Parsed, env: Env, ctx: Context): Reply {
  const assets = q.assets.length ? q.assets : ctx.assets?.length ? ctx.assets : (["GOLD"] as Asset[]);
  const day = q.day ?? env.today;
  const lines = assets.map((a) => {
    const c = closeOn(env.series(a), day);
    if (!c) return `${NAME[a]}: belum ada data pada ${fmtDay(day)} (tersedia sejak ${fmtDay(env.series(a).days[0])}).`;
    const chg = c.prev ? ` (${pct((c.close / c.prev.close - 1) * 100)} dari hari sebelumnya)` : "";
    return `• **${NAME[a]}**: ${price(a, c.close)} pada penutupan ${fmtDay(c.day)}${c.day !== day ? " (hari bursa terakhir sebelum tanggal itu)" : ""}${chg}`;
  });
  return {
    text: `${lines.join("\n")}\n\nHarga penutupan harian dari data Astro Calendar (emas dan DXY sejak 1990, BTC sejak 2011).`,
    suggestions: [`Kinerja ${SHORT[assets[0]]} bulan itu`, "Posisi planet pada tanggal itu", `Kinerja ${SHORT[assets[0]]} tahun ini`],
    ctx: { intent: "price", assets, day, span: { from: dayOfMonthStart(day), to: dayOfMonthEnd(day), label: `${MONTHS[new Date(day * DAY_MS).getUTCMonth()]} ${new Date(day * DAY_MS).getUTCFullYear()}` } },
  };
}
const dayOfMonthStart = (day: number) => {
  const d = new Date(day * DAY_MS);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS);
};
const dayOfMonthEnd = (day: number) => {
  const d = new Date(day * DAY_MS);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / DAY_MS);
};

function forecast(q: Parsed, env: Env, ctx: Context): Reply {
  const assets = q.assets.length ? q.assets : ctx.assets?.length ? ctx.assets : (["GOLD", "BTC", "DXY"] as Asset[]);
  const key: Record<Asset, string> = { GOLD: "xau", BTC: "btc", DXY: "dxy" };
  if (!env.forecast) return { text: "Prakiraan quant belum termuat (butuh server aplikasi). Coba lagi sebentar, atau buka Live TV → Prakiraan.", suggestions: ["Bagaimana cara kerja model quant?"], ctx };
  const lines = assets.map((a) => {
    const f = env.forecast!.assets.find((x) => x.key === key[a]);
    if (!f) return `• ${NAME[a]}: tidak ada prakiraan.`;
    const h = f.horizons;
    return `• **${NAME[a]}**: peluang naik 5 hari ${num(h[5].pUp * 100, 0)}% (biasanya ${num(h[5].baseRate * 100, 0)}%), 10 hari ${num(h[10].pUp * 100, 0)}%, 20 hari ${num(h[20].pUp * 100, 0)}%. Rentang wajar 10 hari: ${pct(h[10].band.p10, 1)} sampai ${pct(h[10].band.p90, 1)}. Vonis: **${h[10].verdict}**.`;
  });
  return {
    text: `Prakiraan model quant (gradient-boosted trees, data sampai ${fmtDay(env.forecast.asOfDay)}):\n${lines.join("\n")}\n\nJujurnya: belum ada aset dan horizon yang terbukti bisa ditebak arahnya lebih baik dari tebakan dasar, jadi semua vonis Netral. Angka peluang di atas sudah dekat dengan rata-rata historisnya; rentang wajar (P10–P90) yang lebih berguna untuk mengukur risiko.`,
    suggestions: ["Bagaimana cara kerja model quant?", "Apa itu volatilitas?", "Kenapa tidak bisa ditebak?"],
    ctx: { intent: "forecast", assets, topic: "quant-model", depth: 0 },
  };
}

// ---------------------------------------------------------------- knowledge

function topic(id: string, ctx: Context, text?: string): Reply {
  const t = topicById(id)!;
  return {
    text: text ?? `**${t.title}**\n${t.body}`,
    suggestions: ["Kenapa? Jelaskan lebih dalam", ...t.related.slice(0, 2).map((r) => topicById(r)!.title)],
    ctx: { ...ctx, intent: "topic", topic: id, depth: text ? 1 : 0 },
  };
}

function deeper(ctx: Context): Reply | null {
  const t = ctx.topic ? topicById(ctx.topic) : null;
  if (!t) return null;
  if ((ctx.depth ?? 0) === 0) return { text: `**${t.title}: lebih dalam**\n${t.deeper}`, suggestions: t.related.map((r) => topicById(r)!.title).slice(0, 3), ctx: { ...ctx, depth: 1 } };
  const rel = topicById(t.related[0]);
  return rel
    ? { text: `Itu sudah inti penjelasan saya soal ${t.title.toLowerCase()}. Topik yang paling dekat: **${rel.title}**.\n${rel.body}`, suggestions: ["Kenapa?", ...rel.related.slice(0, 2).map((r) => topicById(r)!.title)], ctx: { ...ctx, topic: rel.id, depth: 0 } }
    : null;
}

// ---------------------------------------------------------------- the app itself

/** What a menu or tab is for and how to read it (app-guide.ts); null when the question isn't about one. */
function guide(text: string, view: string | null, ctx: Context): Reply | null {
  const reply = (g: GuideEntry): Reply => ({
    text: guideText(g),
    suggestions: ["Menu apa saja yang ada?", ...guideEntries(g.read.join(" ")).filter((o) => o.id !== g.id).slice(0, 2).map((o) => `Cara baca ${o.title}`)],
    ctx: { ...ctx, intent: "topic", topic: null, depth: 0 },
  });
  if (ASKS_MENU_LIST.test(text))
    return {
      text: `Menu di aplikasi ini:
${guideIndex()}

Tanya "cara baca [nama menu]" atau "halaman ini apa" untuk penjelasan lengkapnya.`,
      suggestions: ["Cara baca Macro Regime", "Cara baca COT", "Halaman ini apa?"],
      ctx: { ...ctx, intent: "topic", topic: null, depth: 0 },
    };
  const named = guideEntries(text);
  if (ASKS_THIS_PAGE.test(text) && !named.length && view) {
    const g = guideById(view);
    if (g) return reply(g);
  }
  if (named.length && (ASKS_GUIDE.test(text) || ASKS_THIS_PAGE.test(text))) return reply(named[0]);
  return null;
}

// ---------------------------------------------------------------- choosing the answer

const DEFINE = /\b(apa itu|apa maksud|apakah itu|pengertian|definisi|arti|what is|what are|jelaskan tentang|jelaskan apa)\b/;

export function respond(input: string, env: Env, ctx: Context = {}): Reply {
  const q = parse(input, env.today);
  if (!q.text) return help();
  const entities = q.assets.length + q.planets.length + (q.event ? 1 : 0) + (q.span || q.day !== null ? 1 : 0) + (q.metric ? 1 : 0);

  // The app itself: a menu or a tab, what it shows and how to read it.
  const g = guide(q.text, env.view ?? null, ctx);
  if (g) return g;

  if (q.help) return help();
  if ((q.greeting || q.thanks) && entities === 0 && q.words.length <= 4)
    return { text: q.thanks ? "Sama-sama. Ada lagi yang ingin dibahas?" : "Halo! Mau bahas apa: jadwal langit, pengaruhnya ke harga, data historis, atau price action?", suggestions: EXAMPLES.slice(0, 4), ctx };

  // "Kenapa?" on its own: deeper on what was being discussed.
  if (q.asksWhy && entities === 0 && !DEFINE.test(q.text)) {
    const d = deeper(ctx);
    if (d) return d;
    if (ctx.intent === "impact" || ctx.intent === "discuss") return topic("testing-astro", ctx, `**${topicById("testing-astro")!.title}**\n${topicById("testing-astro")!.deeper}`);
    if (ctx.intent === "forecast") return topic("quant-model", ctx, topicById("quant-model")!.deeper);
  }

  // "Apa itu …": what it is, before any numbers.
  if (DEFINE.test(q.text)) {
    const t = findTopic(q.text);
    if (t) return topic(t.id, ctx);
  }

  // A view stated or asked about: tested, or answered with what the tests found.
  if ((q.claims || q.asksOpinion) && (q.event || ctx.event) && (q.assets.length || ctx.assets?.length)) return discuss(q, env, ctx);
  if (q.asksOpinion && (!q.metric || q.metric === "price")) return opinion(q, ctx);
  if (q.claims && q.event && !q.assets.length) return discuss({ ...q, assets: ["GOLD"] }, env, ctx);

  if (q.asksForecast && (q.assets.length || /\b(prakiraan|prediksi|forecast)\b/.test(q.text))) return forecast(q, env, ctx);

  if (q.event && q.event !== "season" && q.assets.length && (q.asksImpact || !q.asksWhen)) return impact(q, env, ctx);
  if (q.event === "season" || (q.planets.includes("Sun") && (q.event === "ingress" || q.sign !== null || /zodiak/.test(q.text)) && !q.asksPosition)) return sun(q, env, ctx);
  if (q.asksPosition && (q.planets.length || /\bplanet\b/.test(q.text))) return position_(q, env, ctx);
  if (q.event && (q.asksWhen || q.when || !q.assets.length)) return timing(q, env, ctx);

  if (q.assets.length && (q.day !== null || (q.metric === "price" && !q.span)) && (!q.metric || q.metric === "price")) return priceOn(q, env, ctx);
  if (q.assets.length && (q.metric || q.span)) return stats(q, env, ctx);
  if (q.metric === "correlation") return stats({ ...q, assets: ["GOLD", "DXY"] }, env, ctx);

  // Knowledge before guessing at a follow-up: a question about a concept names it.
  const t = findTopic(q.text);
  if (t && (entities === 0 || !ctx.intent || q.words.length > 4)) return topic(t.id, ctx);

  // A follow-up ("kalau BTC?", "tahun 2022?", "purnama?"): the last answer again with what changed.
  if (ctx.intent && entities > 0) {
    const merged: Parsed = { ...q, assets: q.assets.length ? q.assets : ctx.assets ?? [], event: q.event ?? ctx.event ?? null, planets: q.planets.length ? q.planets : ctx.planet ? [ctx.planet] : [] };
    const c = { ...ctx, assets: merged.assets };
    switch (ctx.intent) {
      case "impact":
      case "discuss":
        if (merged.event && merged.assets.length) return impact(merged, env, c);
        break;
      case "timing":
        return timing(merged, env, c);
      case "position":
        return position_(merged, env, c);
      case "stats":
        return stats({ ...merged, metric: q.metric ?? ctx.metric ?? null, span: q.span ?? (q.day === null ? ctx.span ?? null : null) }, env, c);
      case "price":
        return q.span ? stats(merged, env, c) : priceOn({ ...merged, day: q.day ?? ctx.day ?? null }, env, c);
      case "forecast":
        return forecast(merged, env, c);
      default:
        break;
    }
  }
  if (q.assets.length) return stats(q, env, ctx);
  if (q.planets.length) return position_(q, env, ctx);
  if (t) return topic(t.id, ctx);

  return {
    text: "Maaf, saya belum menangkap maksudnya. Saya bekerja offline dengan pola pertanyaan tertentu; coba sebut asetnya (emas, BTC, DXY), kejadian langitnya (retrograde, gerhana, purnama…), waktunya (tanggal, bulan, tahun), atau topiknya (support, tren, FOMC…). Contoh:",
    suggestions: EXAMPLES.slice(0, 6),
    ctx,
  };
}

/** Every topic's title, for the chat's list of what it knows. */
export const topicTitles = () => TOPICS.map((t) => t.title);
