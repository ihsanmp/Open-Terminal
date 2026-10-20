// Reading a question for the Astro Calendar's chat (offline, no AI): what it's about (an asset, a
// planet, a kind of sky event, a time, a measure) in Indonesian or English, loosely written.

import type { Asset } from "../astro-calendar/impact";
import type { RetroPlanet } from "../astro-calendar/retrograde";

export type Planet = RetroPlanet | "Sun" | "Moon";
export type SkyEvent = "retrograde" | "direct" | "eclipse" | "solar-eclipse" | "lunar-eclipse" | "full-moon" | "new-moon" | "ingress" | "aspect" | "season";
export type Metric = "price" | "performance" | "volatility" | "drawdown" | "streak" | "best-days" | "seasonality" | "correlation" | "ath";
/** A span of days (UTC day numbers, both ends included). */
export type Span = { from: number; to: number; label: string };

export type Parsed = {
  raw: string;
  /** Lower case, accents and punctuation folded. */
  text: string;
  words: string[];
  assets: Asset[];
  planets: Planet[];
  event: SkyEvent | null;
  sign: number | null;
  aspect: "conj" | "square" | "opposition" | "trine" | "sextile" | null;
  metric: Metric | null;
  /** A single day asked about ("12 Mei 2024"), or a span ("Mei 2024", "2022", "30 hari terakhir"). */
  day: number | null;
  span: Span | null;
  when: "next" | "last" | "now" | null;
  /** Up or down claimed or asked about ("turun", "naik"). */
  direction: "up" | "down" | null;
  asksWhen: boolean;
  asksWhy: boolean;
  asksOpinion: boolean;
  /** States a view of the user's own ("saya rasa…", "katanya…"). */
  claims: boolean;
  asksForecast: boolean;
  asksPosition: boolean;
  asksImpact: boolean;
  greeting: boolean;
  thanks: boolean;
  help: boolean;
};

const DAY_MS = 86_400_000;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9%./\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

const ASSET_WORDS: Array<[Asset, RegExp]> = [
  ["GOLD", /\b(emas|gold|xau|xauusd|logam mulia)\b/],
  ["BTC", /\b(btc|bitcoin|bitkoin|kripto|crypto)\b/],
  ["DXY", /\b(dxy|dolar|dollar|usd index|indeks dolar|greenback)\b/],
];
const PLANET_WORDS: Array<[Planet, RegExp]> = [
  ["Mercury", /\b(merkurius|mercury|merkuri)\b/],
  ["Venus", /\bvenus\b/],
  ["Mars", /\bmars\b/],
  ["Jupiter", /\b(jupiter|yupiter)\b/],
  ["Saturn", /\b(saturnus|saturn)\b/],
  ["Uranus", /\buranus\b/],
  ["Neptune", /\b(neptunus|neptune)\b/],
  ["Pluto", /\bpluto\b/],
  ["Sun", /\b(matahari|sun|surya)\b/],
  ["Moon", /\b(bulan purnama|bulan baru|moon)\b/],
];
const SIGN_WORDS: RegExp[] = [
  /\b(aries)\b/, /\b(taurus)\b/, /\b(gemini)\b/, /\b(cancer|kanser)\b/, /\b(leo)\b/, /\b(virgo)\b/,
  /\b(libra)\b/, /\b(scorpio|skorpio)\b/, /\b(sagittarius|sagitarius)\b/, /\b(capricorn|kaprikornus|capricornus)\b/,
  /\b(aquarius|akuarius)\b/, /\b(pisces)\b/,
];
const MONTH_WORDS: RegExp[] = [
  /^(januari|january|jan)$/, /^(februari|february|feb|pebruari)$/, /^(maret|march|mar)$/, /^(april|apr)$/, /^(mei|may)$/, /^(juni|june|jun)$/,
  /^(juli|july|jul)$/, /^(agustus|august|aug|agu|ags)$/, /^(september|sept|sep)$/, /^(oktober|october|oct|okt)$/, /^(november|nov|nop)$/,
  /^(desember|december|dec|des)$/,
];
const monthOf = (w: string) => MONTH_WORDS.findIndex((re) => re.test(w));

const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / DAY_MS);
const spanOf = (y: number, m: number | null, label: string): Span =>
  m === null ? { from: dayNum(y, 0, 1), to: dayNum(y, 11, 31), label } : { from: dayNum(y, m, 1), to: dayNum(y, m + 1, 0), label };

const MONTH_LABEL = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Days and spans written in the question; `today` is a UTC day number. */
export function timeOf(text: string, today: number): { day: number | null; span: Span | null } {
  const w = text.split(" ");
  const ty = new Date(today * DAY_MS).getUTCFullYear();
  const tm = new Date(today * DAY_MS).getUTCMonth();
  // 2024-05-12, 12/05/2024, 12-5-2024
  let m = /\b(19|20)(\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (m) return { day: dayNum(Number(m[1] + m[2]), Number(m[3]) - 1, Number(m[4])), span: null };
  m = /\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d{2})\b/.exec(text);
  if (m) return { day: dayNum(Number(m[3]), Number(m[2]) - 1, Number(m[1])), span: null };
  // "12 mei 2024", "mei 12 2024", "mei 2024", "2024"
  for (let i = 0; i < w.length; i++) {
    const mo = monthOf(w[i]);
    if (mo < 0) continue;
    const before = Number(w[i - 1]);
    const after = Number(w[i + 1]);
    const yearAfter = /^(19|20)\d{2}$/.test(w[i + 1] ?? "") ? Number(w[i + 1]) : /^(19|20)\d{2}$/.test(w[i + 2] ?? "") ? Number(w[i + 2]) : null;
    const y = yearAfter ?? (mo <= tm ? ty : ty - 1);
    if (Number.isInteger(before) && before >= 1 && before <= 31) return { day: dayNum(y, mo, before), span: null };
    if (Number.isInteger(after) && after >= 1 && after <= 31 && !/^(19|20)\d{2}$/.test(w[i + 1])) return { day: dayNum(y, mo, after), span: null };
    return { day: null, span: spanOf(y, mo, `${MONTH_LABEL[mo]} ${y}`) };
  }
  // "antara 2020 dan 2022", "2020-2022", "dari 2019 sampai 2021"
  m = /\b((?:19|20)\d{2})\s*(?:-|sampai|hingga|s\/d|sd|to|dan|and|until)\s*((?:19|20)\d{2})\b/.exec(text);
  if (m) {
    const a = Math.min(Number(m[1]), Number(m[2]));
    const b = Math.max(Number(m[1]), Number(m[2]));
    return { day: null, span: { from: dayNum(a, 0, 1), to: dayNum(b, 11, 31), label: `${a}–${b}` } };
  }
  m = /\b(?:tahun\s+)?((?:19|20)\d{2})\b/.exec(text);
  if (m) return { day: null, span: spanOf(Number(m[1]), null, m[1]) };
  // Relative.
  if (has(text, /\b(hari ini|today|sekarang)\b/) && !has(text, /\b(minggu|bulan|tahun)\b/)) return { day: today, span: null };
  if (has(text, /\b(kemarin|yesterday)\b/)) return { day: today - 1, span: null };
  m = /\b(\d{1,3})\s*(hari|minggu|pekan|bulan|tahun|day|days|week|weeks|month|months|year|years)\s*(terakhir|belakangan|lalu|ke belakang|last|past)?\b/.exec(text);
  if (m && (m[3] || has(text, /\b(terakhir|last|past|belakangan)\b/))) {
    const n = Number(m[1]);
    const unit = m[2];
    const days = /hari|day/.test(unit) ? n : /minggu|pekan|week/.test(unit) ? n * 7 : /bulan|month/.test(unit) ? Math.round(n * 30.44) : Math.round(n * 365.25);
    return { day: null, span: { from: today - days, to: today, label: `${n} ${unit.replace(/s$/, "")} terakhir` } };
  }
  if (has(text, /\b(minggu ini|pekan ini|this week)\b/)) return { day: null, span: { from: today - ((new Date(today * DAY_MS).getUTCDay() + 6) % 7), to: today, label: "minggu ini" } };
  if (has(text, /\b(minggu lalu|pekan lalu|last week)\b/)) return { day: null, span: { from: today - 7, to: today, label: "7 hari terakhir" } };
  if (has(text, /\b(bulan ini|this month)\b/)) return { day: null, span: { from: dayNum(ty, tm, 1), to: today, label: "bulan ini" } };
  if (has(text, /\b(bulan lalu|last month)\b/)) return { day: null, span: spanOf(tm === 0 ? ty - 1 : ty, (tm + 11) % 12, "bulan lalu") };
  if (has(text, /\b(tahun ini|ytd|year to date|this year)\b/)) return { day: null, span: { from: dayNum(ty, 0, 1), to: today, label: `tahun ini (${ty})` } };
  if (has(text, /\b(tahun lalu|last year)\b/)) return { day: null, span: spanOf(ty - 1, null, `${ty - 1}`) };
  if (has(text, /\b(sepanjang masa|all time|sepanjang sejarah|semua data)\b/)) return { day: null, span: { from: -1e6, to: today, label: "seluruh data" } };
  return { day: null, span: null };
}

export function parse(raw: string, today: number): Parsed {
  const text = normalize(raw);
  const words = text.split(" ").filter(Boolean);
  const assets = ASSET_WORDS.filter(([, re]) => re.test(text)).map(([a]) => a);
  const planets = PLANET_WORDS.filter(([, re]) => re.test(text)).map(([p]) => p);
  const signIdx = SIGN_WORDS.findIndex((re) => re.test(text));
  const event: SkyEvent | null = has(text, /\bgerhana matahari|solar eclipse\b/)
    ? "solar-eclipse"
    : has(text, /\bgerhana bulan|lunar eclipse\b/)
      ? "lunar-eclipse"
      : has(text, /\b(gerhana|eclipse)\b/)
        ? "eclipse"
        : has(text, /\b(retrograde|retrogade|retro|mundur|rx)\b/)
          ? "retrograde"
          : has(text, /\b(direct|kembali maju|stasioner direct)\b/)
            ? "direct"
            : has(text, /\b(purnama|full moon|bulan penuh)\b/)
              ? "full-moon"
              : has(text, /\b(bulan baru|new moon|bulan mati)\b/)
                ? "new-moon"
                : has(text, /\b(konjungsi|conjunction|square|kuadrat|oposisi|opposition|trine|sextile|aspek|aspect)\b/)
                  ? "aspect"
                  : has(text, /\b(ekuinoks|equinox|solstis|solstice|musim)\b/)
                    ? "season"
                    : has(text, /\b(masuk|ingress|pindah zodiak|pindah tanda|memasuki)\b/) && (planets.length > 0 || signIdx >= 0)
                      ? "ingress"
                      : null;
  const aspect = has(text, /\b(konjungsi|conjunction)\b/)
    ? "conj"
    : has(text, /\b(square|kuadrat)\b/)
      ? "square"
      : has(text, /\b(oposisi|opposition)\b/)
        ? "opposition"
        : has(text, /\btrine\b/)
          ? "trine"
          : has(text, /\bsextile\b/)
            ? "sextile"
            : null;
  const metric: Metric | null = has(text, /\b(korelasi|correlation|hubungan antara|bergerak bersama)\b/)
    ? "correlation"
    : has(text, /\b(volatil|volatility|volatilitas|fluktuasi|gejolak)\w*/)
      ? "volatility"
      : has(text, /\b(drawdown|penurunan terbesar|koreksi terbesar|jatuh terdalam|crash terbesar)\b/)
        ? "drawdown"
        : has(text, /\b(berturut|beruntun|streak)\w*/)
          ? "streak"
          : has(text, /\b(hari terbaik|hari terburuk|best day|worst day|kenaikan harian terbesar|penurunan harian terbesar)\b/)
            ? "best-days"
            : has(text, /\b(musiman|seasonal\w*|bulan terbaik|bulan terburuk|pola bulanan|sell in may)\b/)
              ? "seasonality"
              : has(text, /\b(ath|all time high|tertinggi sepanjang|rekor tertinggi)\b/)
                ? "ath"
                : has(text, /\b(kinerja|performa|performance|return|imbal hasil|naik berapa|turun berapa|berapa persen|untung|rugi|perubahan)\b/)
                  ? "performance"
                  : has(text, /\b(harga|price|nilai|ditutup|close|penutupan)\b/)
                    ? "price"
                    : null;
  const { day, span } = timeOf(text, today);
  const when = has(text, /\b(berikutnya|selanjutnya|next|mendatang|akan datang|kedepan|ke depan|nanti)\b/)
    ? "next"
    : has(text, /\b(terakhir|sebelumnya|last|kemarin|lalu|yang lewat)\b/)
      ? "last"
      : has(text, /\b(sekarang|saat ini|sedang|now|currently|lagi)\b/)
        ? "now"
        : null;
  const direction = has(text, /\b(turun|anjlok|jatuh|melemah|bearish|merosot|drop|down|koreksi)\b/) ? "down" : has(text, /\b(naik|menguat|bullish|melonjak|reli|rally|up|terbang)\b/) ? "up" : null;
  return {
    raw,
    text,
    words,
    assets,
    planets,
    event,
    sign: signIdx >= 0 ? signIdx : null,
    aspect,
    metric,
    day,
    span,
    when,
    direction,
    asksWhen: has(text, /\b(kapan|when|jadwal|tanggal berapa|daftar|list)\b/),
    asksWhy: has(text, /\b(kenapa|mengapa|why|alasan|maksudnya|jelaskan lebih|lebih detail|lebih dalam|bagaimana bisa|kok bisa)\b/),
    asksOpinion: has(text, /\b(menurutmu|menurut kamu|menurut anda|pendapat|pendapatmu|percaya|valid|benarkah|apakah benar|beneran|terbukti|ilmiah|setuju|diskusi|masuk akal|mitos)\b/),
    claims: has(text, /\b(saya rasa|saya pikir|aku rasa|aku pikir|katanya|kata orang|saya yakin|aku yakin|biasanya|selalu|menurut saya|menurutku)\b/),
    asksForecast: has(text, /\b(prakiraan|prediksi|forecast|ramalan|proyeksi|akan naik|akan turun|bakal naik|bakal turun|outlook|target|minggu depan|bulan depan)\b/),
    asksPosition: has(text, /\b(posisi|di mana|dimana|zodiak apa|tanda apa|berada di|derajat)\b/),
    asksImpact: has(text, /\b(pengaruh|dampak|efek|effect|impact|saat|selama|ketika|waktu|sewaktu|bagaimana|gimana|reaksi|berpengaruh)\b/),
    greeting: has(text, /^(hai|halo|hello|hi|hey|pagi|siang|sore|malam|selamat|assalamualaikum)\b/),
    thanks: has(text, /\b(terima kasih|makasih|thanks|thank you|thx|mantap|oke sip)\b/),
    help: has(text, /\b(bantuan|help|bisa apa|apa saja|contoh pertanyaan|cara pakai|fitur)\b/),
  };
}
