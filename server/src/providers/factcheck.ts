// Fact-checking what's said on a broadcast against the official data, as it's said: a speaker's
// numbers about the US economy and markets read from the live transcript and set beside the figures
// themselves, with the series and the period each was checked against, so a reader sees where a
// verdict comes from instead of taking it on trust. All of it from data the app already reads, free:
//
//   - the releases as first published (TradingView's calendar, the macro engine's copy since 2013):
//     CPI and PCE month on month, PPI, retail sales, payrolls, the unemployment rate, jobless claims,
//     ISM, JOLTS, ADP, Michigan sentiment — what a speaker quotes, before any revision;
//   - FRED (BLS, BEA, the Fed): inflation over twelve months, payrolls' three-month average, GDP,
//     wages, mortgage rates, the Fed's balance sheet and the funds rate's range and its moves;
//   - TradingView's prices for the markets named: yields, the dollar, the S&P 500, oil, gold, bitcoin.
//
// Only statements of fact are checked: a projection, an expectation, a goal ("our 2 percent
// objective") or a hypothetical isn't. A claim whose measure can't be told ("prices rose 3 percent"
// with no index named) is checked against every inflation measure and says which it matches.

import * as fred from "./fred.js";

export type Indicator =
  | "pce"
  | "core_pce"
  | "cpi"
  | "core_cpi"
  | "inflation"
  | "cpi_mom"
  | "core_cpi_mom"
  | "pce_mom"
  | "core_pce_mom"
  | "ppi_mom"
  | "retail_sales"
  | "unemployment"
  | "payrolls"
  | "payrolls_avg"
  | "jobless_claims"
  | "continuing_claims"
  | "adp"
  | "job_openings"
  | "ism_mfg"
  | "ism_services"
  | "michigan"
  | "wages"
  | "gdp"
  | "mortgage"
  | "balance_sheet"
  | "fed_funds"
  | "rate_change"
  | "yield_2y"
  | "yield_10y"
  | "yield_30y"
  | "dxy"
  | "spx"
  | "oil"
  | "gold"
  | "bitcoin";
export type Verdict = "match" | "close" | "differs" | "unverifiable";

export type Claim = {
  indicator: Indicator;
  /**
   * The figure said, in the unit its measure is kept in: %, thousands (jobs, claims), millions
   * (job openings), trillions of dollars (the balance sheet), index points, dollars, or percentage
   * points (a move of the funds rate); the funds rate's range as low and high.
   */
  value: number;
  high?: number;
  /** The month the claim is about (YYYY-MM), when it names one; else the latest data. */
  month: string | null;
  /** Said as an approximation ("about 2 percent", "nearly 180,000"): checked with more room. */
  approx?: boolean;
  /** The words it was read from. */
  phrase: string;
  /** Where its figure is in the text as `prepare` leaves it. */
  at: number;
};

export type Check = Claim & {
  verdict: Verdict;
  /** The official figure it was set against, the period, and where it's from. */
  official: number | null;
  officialHigh?: number;
  period: string | null;
  series: string | null;
  source: string | null;
  url: string | null;
  note: string | null;
};

export const LABEL: Record<Indicator, string> = {
  pce: "Inflasi PCE (tahunan)",
  core_pce: "Inflasi PCE inti (tahunan)",
  cpi: "Inflasi CPI (tahunan)",
  core_cpi: "Inflasi CPI inti (tahunan)",
  inflation: "Inflasi (PCE atau CPI, tahunan)",
  cpi_mom: "CPI bulanan",
  core_cpi_mom: "CPI inti bulanan",
  pce_mom: "PCE bulanan",
  core_pce_mom: "PCE inti bulanan",
  ppi_mom: "PPI bulanan",
  retail_sales: "Penjualan ritel bulanan",
  unemployment: "Tingkat pengangguran",
  payrolls: "Tambahan lapangan kerja (payroll) sebulan",
  payrolls_avg: "Rata-rata tambahan payroll 3 bulan",
  jobless_claims: "Klaim pengangguran awal (mingguan)",
  continuing_claims: "Klaim pengangguran lanjutan",
  adp: "Lapangan kerja swasta (ADP)",
  job_openings: "Lowongan kerja (JOLTS)",
  ism_mfg: "ISM manufaktur",
  ism_services: "ISM jasa",
  michigan: "Sentimen konsumen Michigan",
  wages: "Kenaikan upah per jam (tahunan)",
  gdp: "Pertumbuhan GDP riil (tahunan, kuartal)",
  mortgage: "Bunga KPR 30 tahun",
  balance_sheet: "Neraca The Fed",
  fed_funds: "Kisaran suku bunga acuan Fed",
  rate_change: "Total perubahan suku bunga Fed",
  yield_2y: "Yield Treasury 2 tahun",
  yield_10y: "Yield Treasury 10 tahun",
  yield_30y: "Yield Treasury 30 tahun",
  dxy: "Indeks dolar (DXY)",
  spx: "S&P 500",
  oil: "Minyak WTI",
  gold: "Emas",
  bitcoin: "Bitcoin",
};

/** The unit a measure's figures are in, for display: "%", "rb" (thousands), "jt" (millions), "T$", "poin", "$", "pp". */
export const UNIT: Record<Indicator, string> = Object.fromEntries(
  (Object.keys(LABEL) as Indicator[]).map((k) => [
    k,
    ["payrolls", "payrolls_avg", "jobless_claims", "continuing_claims", "adp"].includes(k)
      ? "rb"
      : k === "job_openings"
        ? "jt"
        : k === "balance_sheet"
          ? "T$"
          : ["ism_mfg", "ism_services", "michigan", "dxy", "spx"].includes(k)
            ? "poin"
            : ["oil", "gold", "bitcoin"].includes(k)
              ? "$"
              : k === "rate_change"
                ? "pp"
                : "%",
  ]),
) as Record<Indicator, string>;

// ---------------------------------------------------------------- reading the claims

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WORD_NUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const FRACTION: Record<string, number> = { "1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "a quarter": 0.25, "a half": 0.5, "three quarters": 0.75 };

/**
 * A said number: "2.7", "4,250", "2-1/2", "4 1/4", "4 and a quarter", "two point seven", "three".
 * Returns the value, how many characters it took, and whether it was written with thousands' commas.
 */
export function readNumber(s: string): { value: number; length: number; commas?: boolean } | null {
  let m = /^(\d{1,3}(?:,\d{3})+)(\.\d+)?/.exec(s);
  if (m) return { value: Number(m[1].replace(/,/g, "") + (m[2] ?? "")), length: m[0].length, commas: true };
  m = /^(\d+(?:\.\d+)?)(?:(?:-| | and )(1\/4|1\/2|3\/4|a quarter|a half|three quarters))?/.exec(s);
  if (m) return { value: Number(m[1]) + (m[2] ? FRACTION[m[2]] : 0), length: m[0].length };
  m = /^(zero|one|two|three|four|five|six|seven|eight|nine|ten)(?: point (zero|one|two|three|four|five|six|seven|eight|nine))?(?: and (a quarter|a half|three quarters))?\b/.exec(s);
  if (m) return { value: WORD_NUM[m[1]] + (m[2] ? WORD_NUM[m[2]] / 10 : 0) + (m[3] ? FRACTION[m[3]] : 0), length: m[0].length };
  return null;
}

/** Words that make a statement not one of fact: forecasts, goals, hypotheticals. */
const NOT_FACT =
  /\b(expect\w*|project\w*|forecast\w*|anticipat\w*|will|would|could|should|might|may be|if|goal|objective|target(?! range)\w*|median|longer[- ]run|next year|by the end of|outlook|scenario|assum\w*|estimate[sd]? (?:that|to)|think|believe|range of (?:possible|outcomes)|neutral|want\w*|reach\w*|achiev\w*|return\w*|bring\w*|get(?:ting)? (?:it|inflation)|keep(?:ing)? (?:it|inflation)|rais\w* inflation|until|aim\w*|seek\w*|commit\w*|consistent with|toward|u-?6|hypothetical\w*|by 20\d\d|consensus|economists|predict\w*|survey of)\b/;
/** Another economy's figures ("lots of countries … inflation of 10 percent"). */
const ABROAD = /\b(?:countries|europe|euro area|eurozone|britain|united kingdom|japan|china|canada|abroad|around the world|globally|emerging markets)\b/;
/** A reading of another time than now: "last december", "in 2010", "at its peak". */
const PAST = /\b(?:last (?:year|summer|spring|fall|autumn|winter|quarter|time|cycle|january|february|march|april|may|june|july|august|september|october|november|december)|in (?:19|20)\d\d|peak\w*|height|before the pandemic|pre-pandemic|back (?:in|then)|at the time|a year ago|years ago|historically|at the start|when (?:it|we|the|\w+ (?:was|were|hit|peaked))|during the|of (?:19|20)\d\d|a time when|for (?:19|20)\d\d|all[- ]time|record|(?:\d+|five|ten|twenty)[- ]year average|long[- ](?:run|term) average|historical average)\b/;
/** A figure on another basis than the twelve months' (a three-month annualized pace, a month's change). */
const OTHER_BASIS = /\b(?:three|six|3|6)[- ]month|annuali[sz]ed|month-over-month|monthly|basis|between \S+ and\s*$/;
/** Twelve months' change. */
const YEARLY = /\b(?:12|twelve)[- ]months?\b|\bover the (?:past |last )?year\b|\bfrom a year (?:earlier|ago)\b|\byear[- ]over[- ]year\b|\bon the year\b|\bannual\b|\bfrom last year\b/;
/** One month's change. */
const MONTHLY = /\bmonth[- ](?:over|on)[- ]month\b|\bmonthly\b|\blast month\b|\bon the month\b|\bfor the month\b|\bin (?:january|february|march|april|may|june|july|august|september|october|november|december)\b/;

/** The month a claim names ("12 months ending in august", "in september", "through july"). */
function monthIn(s: string): number | null {
  const m = /\b(?:ending in|ended in|through|in|for|as of)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(s);
  return m ? MONTHS.indexOf(m[1]) : null;
}

/** The year-month a named month means, said on `asOf`: the latest such month before it. */
export function monthOf(month: number, asOf: Date): string {
  const y = month < asOf.getUTCMonth() ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
  return `${y}-${String(month + 1).padStart(2, "0")}`;
}

/** The measures a percent figure can be of, as speakers name them (the more specific first). */
const MEASURES: Array<[Indicator, RegExp]> = [
  ["core_pce", /\bcore pce(?: prices?| inflation| price index)?\b|\bcore (?:personal consumption|prices)\b|\bpce (?:prices )?excluding food and energy/g],
  // PCE as prices ("pce prices", "the price index for personal consumption expenditures"), not spending.
  ["pce", /\b(?:total|headline) pce\b|\bpce (?:prices?|inflation|price index)\b|price index for personal consumption expenditures|personal consumption expenditures (?:price|inflation)/g],
  ["core_cpi", /\bcore cpi\b|\bcore consumer price/g],
  ["cpi", /\bcpi\b|consumer price index|\bconsumer prices\b/g],
  ["ppi_mom", /\bppi\b|producer price|wholesale (?:prices|inflation)/g],
  ["retail_sales", /\bretail sales\b/g],
  ["wages", /\baverage hourly earnings\b|\bwage growth\b|\bwages? (?:grew|rose|increased|are up|were up|up)\b|\bhourly (?:pay|earnings)\b/g],
  ["mortgage", /\bmortgage rates?\b/g],
  ["yield_2y", /\b(?:2|two)[- ]year (?:treasury|note|yields?)\b|\bthe (?:2|two)[- ]year\b(?! period| average| term)/g],
  ["yield_10y", /\b(?:10|ten)[- ]year (?:treasury|note|yields?)\b|\bthe (?:10|ten)[- ]year\b(?! period| average| term| breakeven)/g],
  ["yield_30y", /\b(?:30|thirty)[- ]year (?:treasury|bond|yields?)\b(?! mortgage)/g],
  ["unemployment", /\bunemployment(?: rate)?\b|\bjobless rate\b/g],
  ["gdp", /\bgdp\b|\bgross domestic product\b|\breal (?:economic )?output\b/g],
  ["fed_funds", /\b(?:federal funds rate|fed funds rate|policy rate|target range)\b/g],
  ["inflation", /\binflation\b/g],
];

/** The measures a figure in another unit can be of: jobs and claims, openings, indexes, prices. */
const OTHER_MEASURES: Array<[Indicator, RegExp]> = [
  ["jobless_claims", /\b(?:initial (?:jobless )?claims|jobless claims|claims for unemployment(?: insurance| benefits)?|first-time (?:jobless )?claims)\b/g],
  ["continuing_claims", /\bcontinuing (?:jobless )?claims\b/g],
  ["adp", /\badp\b/g],
  ["job_openings", /\bjob openings\b|\bjolts\b|\bopen positions\b/g],
  ["ism_mfg", /\bism manufacturing\b|\bmanufacturing (?:pmi|index|survey)\b|\bism(?:'s)? (?:index|pmi)\b/g],
  ["ism_services", /\bism services\b|\bservices (?:pmi|index|survey)\b|\bnon-?manufacturing (?:pmi|index)\b/g],
  ["michigan", /\bconsumer sentiment\b|\bmichigan\b/g],
  ["balance_sheet", /\bbalance sheet\b|\bsecurities holdings\b/g],
  ["dxy", /\bdollar index\b|\bdxy\b/g],
  ["spx", /\bs ?& ?p(?: 500)?\b|\bs and p(?: 500)?\b|\bthe s&p\b/g],
  ["oil", /\b(?:crude|oil|wti)\b/g],
  ["gold", /\bgold\b/g],
  ["bitcoin", /\bbitcoin\b|\bbtc\b/g],
];

/** The measure named nearest before a figure (a sentence may name several). */
function nearest(before: string, measures: Array<[Indicator, RegExp]>): Indicator | null {
  let best: { ind: Indicator; end: number } | null = null;
  for (const [ind, re] of measures) {
    re.lastIndex = 0;
    for (let m = re.exec(before); m; m = re.exec(before)) {
      const end = m.index + m[0].length;
      // "core pce" also reads as "pce" and as "inflation": the more specific, found first, stays.
      if (!best || end > best.end + 1) best = { ind, end };
    }
  }
  return best?.ind ?? null;
}

/** Just before a figure: a comparison or a starting point, not the level itself ("below 2 percent", "from 10 percent"). */
const COMPARED = /\b(?:below|under|above|over|toward|towards|than|exceed\w*|from|short of|beneath|beyond|within|between|percent to|going to)\s*$/;
/** Just after it: a goal, a forecast's year, another period than the latest, or another measure. */
const AFTER_NOT_FACT =
  /^\s*percent\b[^.;]{0,40}?\b(?:objective|goal|target|longer[- ]run|over time|on a symmetric|on track|this year|next year|in 20\d\d|by 20\d\d|by the end|over the next|in the next|at the height|if you|if we|last (?:year|summer|spring|fall|autumn|winter|quarter|january|february|march|april|may|june|july|august|september|october|november|december)|a year ago|at (?:the|its) peak|before the pandemic)\b|^\s*percent\s+(?:unemployment|inflation|productivity|growth|wage|gdp|core|rate|range|or|and \d|of|to)\b/;
const APPROX = /\b(?:about|around|roughly|nearly|almost|close to|approximately|some|near|just under|just over|a little (?:over|under))\s*$/;
/** "rose 0.3 percent", "fell by", "is up": a change, as month-on-month figures are said. */
const CHANGE_VERB = /\b(?:rose|rise[sn]?|rising|increased|increase[sd]?|grew|growth|gain(?:ed|s)?|fell|fall(?:en|s)?|declined?|dropped|climbed|jumped|slipped|advanced|up|down)\b[^.]{0,30}$/;

/** Lower case, "¾" as 0.75, "%" as " percent", one space between words (and the same again). */
export function prepare(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d*)\s?([¼½¾])/g, (_m, whole: string, f: string) => String((whole ? Number(whole) : 0) + ({ "¼": 0.25, "½": 0.5, "¾": 0.75 } as Record<string, number>)[f]))
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\s+/g, " ");
}

/** The usual range of a measure's level, so a stray number nearby isn't read as one. */
const PLAUSIBLE: Partial<Record<Indicator, [number, number]>> = {
  jobless_claims: [100, 1500],
  continuing_claims: [500, 30000],
  adp: [-2000, 2000],
  job_openings: [2, 20],
  ism_mfg: [25, 80],
  ism_services: [25, 80],
  michigan: [30, 120],
  balance_sheet: [0.5, 15],
  dxy: [60, 140],
  spx: [1000, 20000],
  oil: [5, 300],
  gold: [200, 20000],
  bitcoin: [1000, 1_000_000],
};

/**
 * The factual claims about the US data and markets in a stretch of transcript: each figure with the
 * measure the words before it name, in that measure's unit.
 */
export function extractClaims(text: string, asOf = new Date()): Claim[] {
  const out: Claim[] = [];
  const t = prepare(text);
  // Sentence by sentence where the captions punctuate; a window of words where they don't.
  for (const part of t.matchAll(/(?:[^.?!]|[.?!](?![\s]|$))+[.?!]*/g)) {
    const sentence = part[0];
    const base = part.index ?? 0;
    if (sentence.trim().endsWith("?")) continue;
    const re = /\b(\d+(?:[.,]\d+)*|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g;
    for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
      const at = m.index;
      const num = readNumber(sentence.slice(at));
      if (!num) continue;
      re.lastIndex = at + num.length;
      const rest = sentence.slice(at + num.length);
      const before = sentence.slice(Math.max(0, at - 140), at);
      const words = before.split(" ").slice(-16).join(" ");
      const last12 = words.trim().split(" ").slice(-12).join(" ");
      const said = sentence.slice(at, at + num.length);
      const push = (c: Omit<Claim, "at" | "phrase"> & { tail?: string }) => {
        const { tail, ...claim } = c;
        out.push({ ...claim, at: base + at, phrase: `${words} ${said}${tail ?? ""}`.trim() });
      };
      const bare = words.replace(/\$\s*$/, "");
      const notFact = NOT_FACT.test(words) || COMPARED.test(bare) || PAST.test(last12) || ABROAD.test(words);
      // A change ("declined by $2 trillion", "rose by 50,000") isn't the level.
      const byChange = /\bby (?:more than |nearly |almost |about |roughly |some |over |less than )?$/.test(bare);

      // The funds rate's range: "a range of 4 to 4-1/4 percent".
      const range = /^\s*to\s+/.exec(rest);
      if (range && /\b(?:federal funds rate|fed funds rate|policy rate|target range)\b/.test(words)) {
        const hi = readNumber(rest.slice(range[0].length));
        const after = rest.slice(range[0].length + (hi?.length ?? 0));
        if (hi && /^\s*percent\b/.test(after) && !NOT_FACT.test(words) && !AFTER_NOT_FACT.test(after) && !COMPARED.test(words)) {
          push({ indicator: "fed_funds", value: num.value, high: hi.value, month: null, tail: `${range[0]}${rest.slice(range[0].length, range[0].length + hi.length)} percent` });
          re.lastIndex = at + num.length + range[0].length + hi.length;
        }
        continue;
      }

      // The funds rate moved, in all, since a month: "we have lowered our policy rate by 1 percentage point since september".
      const moved = /^\s*(percentage points?|basis points?)\b/.exec(rest);
      if (moved && /\b(?:lowered|reduced|cut|raised|increased|eased|tightened)\b[^.]{0,60}\b(?:policy rate|rates|interest rates|federal funds rate|fed funds rate|it)\b[^.]{0,30}\bby (?:a (?:total|cumulative) of )?(?:about )?$/.test(before)) {
        const since = /^[^.;]{0,50}?\bsince (?:last )?(january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(rest.slice(moved[0].length));
        if (since && !NOT_FACT.test(words)) {
          const pp = moved[1].startsWith("basis") ? num.value / 100 : num.value;
          const down = /\b(?:lowered|reduced|cut|eased)\b/.test(before);
          push({ indicator: "rate_change", value: down ? -pp : pp, month: monthOf(MONTHS.indexOf(since[1]), asOf), tail: ` ${moved[1]}${since[0]}` });
        }
        continue;
      }

      // Thousands (jobs, claims), millions (openings), trillions (the balance sheet), dollars, index points.
      const thousandWord = /^\s*(?:thousand|k)\b/.exec(rest);
      const million = /^\s*million\b/.exec(rest);
      const trillion = /^\s*trillion\b/.exec(rest);
      const dollar = /\$\s*$/.test(before) || /^\s*(?:dollars?|bucks)\b/.test(rest);
      const jobsNear = `${last12} ${rest.slice(0, 40)}`;
      // Payroll gains: "job gains averaged 29,000 per month", "added 150 thousand jobs".
      if ((num.commas || thousandWord) && /\b(?:payroll|job gains|jobs|employers added|added)\b/.test(jobsNear) && !/\b(?:adp|claims|openings)\b/.test(jobsNear)) {
        if (notFact || /^[^.;]{0,40}\b(?:this year|next year|last year|in 20\d\d|a year ago)\b/.test(rest)) continue;
        const thousands = num.commas ? num.value / 1000 : num.value;
        // "averaged" without a span is the last three months', as the Fed's statements give it; so is
        // "a pace of … per month over the last three months".
        const near = `${words.trim().split(" ").slice(-8).join(" ")} ${rest.slice(0, 70)}`;
        const avg = /\baverag\w*\b/.test(near) || (/\b(?:per|a) month\b/.test(near) && /\b(?:three|3) months\b/.test(near));
        // The month only from the words about this figure, not an earlier clause's.
        const named = monthIn(near);
        push({ indicator: avg ? "payrolls_avg" : "payrolls", value: thousands, approx: APPROX.test(words), month: named === null ? null : monthOf(named, asOf), tail: thousandWord?.[0] ?? "" });
        continue;
      }
      if (!/^\s*percent\b/.test(rest)) {
        const ind = nearest(words, OTHER_MEASURES);
        if (!ind || notFact || byChange || /\b(?:more|less|fewer) than\s*$/.test(bare)) continue;
        let value = num.value;
        if (ind === "jobless_claims" || ind === "continuing_claims" || ind === "adp") {
          if (num.commas) value = num.value / 1000;
          else if (million) value = num.value * 1000;
          else if (!thousandWord) continue;
        } else if (ind === "job_openings") {
          if (million) value = num.value;
          else if (num.commas && num.value > 100_000) value = num.value / 1e6;
          else continue;
        } else if (ind === "balance_sheet") {
          if (trillion) value = num.value;
          else if (/^\s*billion\b/.test(rest)) value = num.value / 1000;
          else continue;
        } else if (ind === "oil" || ind === "gold" || ind === "bitcoin") {
          if (!dollar && !/^\s*(?:an? |per )(?:barrel|ounce|coin)\b/.test(rest)) continue;
        } else if (thousandWord || million || trillion || dollar) continue;
        const [lo, hi] = PLAUSIBLE[ind] ?? [-Infinity, Infinity];
        if (value < lo || value > hi) continue;
        // Weekly claims are the latest week's (a month named nearby is another figure's); markets are now.
        const weekly = ind === "jobless_claims" || ind === "continuing_claims" || MARKET[ind] !== undefined;
        const named = weekly ? null : monthIn(`${last12} ${rest.slice(0, 50)}`);
        push({ indicator: ind, value, approx: APPROX.test(bare), month: named === null ? null : monthOf(named, asOf), tail: (thousandWord ?? million ?? trillion)?.[0] ?? "" });
        continue;
      }

      let indicator = nearest(words, MEASURES);
      if (!indicator) continue;
      // "Core inflation" in a sentence about PCE is core PCE (the Fed's measure); "total" is PCE.
      if (indicator === "inflation" && /\bpce\b|personal consumption/.test(sentence)) indicator = /\bcore\s+(?:pce\s+)?inflation\b[^.]*$/.test(words) ? "core_pce" : /\b(?:total|headline)\b[^.]*$/.test(words) ? "pce" : indicator;
      // Expectations of inflation, a projection, a goal, a comparison, another period: not a fact to check.
      if (NOT_FACT.test(words) || /\bexpectations\b/.test(words) || COMPARED.test(words) || AFTER_NOT_FACT.test(rest)) continue;
      if (PAST.test(last12) || PAST.test(rest.slice(0, 60)) || ABROAD.test(words)) continue;
      const after = rest.slice(0, 70);
      const around = `${last12} ${after}`;
      // A month's change of the price indexes ("cpi rose 0.3 percent in september") against twelve months'.
      const priceIndex = indicator === "cpi" || indicator === "core_cpi" || indicator === "pce" || indicator === "core_pce";
      if (priceIndex && !YEARLY.test(around) && (MONTHLY.test(around) || num.value < 1) && CHANGE_VERB.test(words)) indicator = `${indicator}_mom` as Indicator;
      else if (indicator !== "unemployment" && indicator !== "fed_funds" && !indicator.endsWith("_mom") && indicator !== "ppi_mom" && indicator !== "retail_sales" && OTHER_BASIS.test(last12)) continue;
      // PPI and retail sales are read as the month's change; their twelve months' isn't kept.
      if ((indicator === "ppi_mom" || indicator === "retail_sales") && YEARLY.test(around)) continue;
      // "Inflation … 2 percent" with no measure named is the Fed's aim almost every time it's said.
      if (indicator === "inflation" && num.value === 2) continue;
      // GDP only for a quarter it names (a half, a year or a forecast can't be set beside one figure).
      const quarter = /\b(first|second|third|fourth) quarter\b/.exec(`${words} ${rest.slice(0, 60)}`);
      if (indicator === "gdp" && !quarter) continue;
      // A sum since a start ("from 10 percent to 4") or a change of a level ("the yield rose 0.3 percent") isn't a level.
      if (/\b(?:by|percentage points?)\s*$/.test(words) || /^\s*percent\s+(?:to|from)\b/.test(rest)) continue;
      if ((indicator.startsWith("yield_") || indicator === "mortgage" || indicator === "unemployment") && /\b(?:by|up|down)\s*$/.test(words)) continue;
      const named = monthIn(`${words} ${after}`);
      const month = indicator === "gdp" && quarter ? ["first", "second", "third", "fourth"].indexOf(quarter[1]) * 3 : named;
      // "Excluding food and energy, core PCE prices rose 2.9 percent": the period of the total just said.
      const total = out.at(-1);
      const pairs: Record<string, string> = { core_pce: "pce", core_cpi: "cpi", core_pce_mom: "pce_mom", core_cpi_mom: "cpi_mom" };
      const inherited = month === null && total && total.month && base + at - total.at < 260 && pairs[indicator] === total.indicator ? total.month : null;
      push({ indicator, value: num.value, approx: APPROX.test(words), month: inherited ?? (month === null ? null : monthOf(month, asOf)), tail: ` percent${after.replace(/^\s*percent/, "").split(/[,.;]/)[0]}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------- checking them

type Series = Array<{ date: string; value: number }>;
const SERIES: Record<string, { id: string; source: string }> = {
  pce: { id: "PCEPI", source: "BEA (via FRED)" },
  core_pce: { id: "PCEPILFE", source: "BEA (via FRED)" },
  cpi: { id: "CPIAUCSL", source: "BLS (via FRED)" },
  core_cpi: { id: "CPILFESL", source: "BLS (via FRED)" },
  unemployment: { id: "UNRATE", source: "BLS (via FRED)" },
  payrolls: { id: "PAYEMS", source: "BLS (via FRED)" },
  gdp: { id: "A191RL1Q225SBEA", source: "BEA (via FRED)" },
  wages: { id: "CES0500000003", source: "BLS (via FRED)" },
  mortgage: { id: "MORTGAGE30US", source: "Freddie Mac (via FRED)" },
  balance_sheet: { id: "WALCL", source: "Federal Reserve H.4.1 (via FRED)" },
  fed_low: { id: "DFEDTARL", source: "Federal Reserve (via FRED)" },
  fed_high: { id: "DFEDTARU", source: "Federal Reserve (via FRED)" },
};

/** The releases as first published, by the calendar's title (macroengine.ts keeps them). */
const RELEASE: Partial<Record<Indicator, string>> = {
  cpi_mom: "Inflation Rate MoM",
  core_cpi_mom: "Core Inflation Rate MoM",
  pce_mom: "PCE Price Index MoM",
  core_pce_mom: "Core PCE Price Index MoM",
  ppi_mom: "PPI MoM",
  retail_sales: "Retail Sales MoM",
  unemployment: "Unemployment Rate",
  payrolls: "Non Farm Payrolls",
  jobless_claims: "Initial Jobless Claims",
  continuing_claims: "Continuing Jobless Claims",
  adp: "ADP Employment Change",
  job_openings: "JOLTs Job Openings",
  ism_mfg: "ISM Manufacturing PMI",
  ism_services: "ISM Services PMI",
  michigan: "Michigan Consumer Sentiment Prel",
  gdp: "GDP Growth Rate QoQ Adv",
};

/** The markets' TradingView tickers. */
const MARKET: Partial<Record<Indicator, string>> = {
  yield_2y: "TVC:US02Y",
  yield_10y: "TVC:US10Y",
  yield_30y: "TVC:US30Y",
  dxy: "TVC:DXY",
  spx: "SP:SPX",
  oil: "TVC:USOIL",
  gold: "OANDA:XAUUSD",
  bitcoin: "BITSTAMP:BTCUSD",
};

const cache = new Map<string, { at: number; points: Series }>();
const TTL = 6 * 3_600_000;

/** A FRED series, kept six hours (new data comes out monthly). */
export async function seriesOf(key: keyof typeof SERIES, get = fred.series): Promise<Series> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.points;
  const points = await get(SERIES[key].id, 20_000);
  cache.set(key, { at: Date.now(), points });
  return points;
}

const month = (d: string) => d.slice(0, 7);
const prevYear = (ym: string) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;

/** Year-over-year % of an index for each month it has a year-earlier value. */
export function yoy(points: Series): Map<string, number> {
  const byMonth = new Map(points.map((p) => [month(p.date), p.value]));
  const out = new Map<string, number>();
  for (const [m, v] of byMonth) {
    const was = byMonth.get(prevYear(m));
    if (was) out.set(m, (v / was - 1) * 100);
  }
  return out;
}

/** How near a said figure must be to the official one, by measure: a rounding is a match, a revision close. */
export function tolerance(ind: Indicator, approx = false): { match: number; close: number; relative?: boolean } {
  if (["payrolls", "payrolls_avg", "adp"].includes(ind)) return { match: approx ? 15 : 5, close: 35 };
  if (ind === "jobless_claims") return { match: approx ? 6 : 2, close: 12 };
  if (ind === "continuing_claims") return { match: approx ? 30 : 10, close: 60 };
  if (ind === "job_openings") return { match: approx ? 0.15 : 0.05, close: 0.3 };
  if (["ism_mfg", "ism_services", "michigan"].includes(ind)) return { match: approx ? 0.6 : 0.15, close: 1.5 };
  if (ind === "balance_sheet") return { match: approx ? 0.15 : 0.05, close: 0.3 };
  if (["dxy", "spx", "oil", "gold", "bitcoin"].includes(ind)) return { match: approx ? 0.02 : 0.01, close: 0.04, relative: true };
  if (ind.startsWith("yield_") || ind === "mortgage") return { match: approx ? 0.1 : 0.06, close: 0.2 };
  if (ind === "rate_change") return { match: 0.01, close: 0.25 };
  return { match: approx ? 0.15 : 0.05, close: approx ? 0.35 : 0.2 };
}

/** How a said figure compares with the official one: a rounding, a revision, or a different figure. */
export function verdictOf(said: number, official: number, unit: "pct" | "jobs" | Indicator, approx = false): Verdict {
  const tol = unit === "pct" ? tolerance("cpi", approx) : unit === "jobs" ? tolerance("payrolls", approx) : tolerance(unit, approx);
  const gap = tol.relative ? Math.abs(said / official - 1) : Math.abs(said - official);
  return gap <= tol.match + 1e-9 ? "match" : gap <= tol.close + 1e-9 ? "close" : "differs";
}

const fredUrl = (id: string) => `https://fred.stlouisfed.org/series/${id}`;
const ORDER: Verdict[] = ["match", "close", "differs", "unverifiable"];
type Try = { m: string; v: number; verdict: Verdict; k: number; series: string; source: string; url: string; note?: string };
const best = (tries: Try[]) => tries.sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.k - b.k)[0];

/** The releases as first published (the macro engine's copy of TradingView's calendar). */
type ReleaseRow = { title: string; date: string; ref: string; actual: number | null; previous: number | null };
let releasesOf = async (): Promise<ReleaseRow[]> => (await import("./macroengine.js")).usReleases();
export const setReleases = (f: () => Promise<ReleaseRow[]>) => (releasesOf = f);
/** The markets' prices (TradingView's bars), injectable for tests. */
type BarsFn = (symbols: string[], resolution: string, count: number) => Promise<Record<string, Array<{ time: number; close: number }> | null>>;
let barsOf: BarsFn = async (s, r, n) => (await import("./tvchart.js")).bars(s, r, n);
export const setBars = (f: BarsFn) => (barsOf = f);

/** A release's first print for the month named, or the latest two out by then. */
async function releaseTries(c: Claim, asOf: Date): Promise<Try[]> {
  const title = RELEASE[c.indicator];
  if (!title) return [];
  const rows = (await releasesOf())
    .filter((r) => r.title === title && r.actual !== null && Date.parse(r.date) <= asOf.getTime())
    .sort((a, b) => a.date.localeCompare(b.date));
  const ofMonth = c.month ? rows.filter((r) => r.ref.slice(0, 7) === c.month) : rows.slice(-2).reverse();
  const source = "rilis resmi, angka pertama (kalender TradingView)";
  const url = "https://www.tradingview.com/economic-calendar/";
  const tries: Try[] = ofMonth.map((r, k) => ({ m: c.indicator === "jobless_claims" || c.indicator === "continuing_claims" ? r.ref : r.ref.slice(0, 7), v: r.actual!, verdict: verdictOf(c.value, r.actual!, c.indicator, c.approx), k, series: title, source, url }));
  // The month before as revised since (the release's "previous").
  if (!c.month && rows.length) {
    const lastRow = rows.at(-1)!;
    if (lastRow.previous !== null && rows.length > 1) tries.push({ m: rows.at(-2)!.ref.slice(0, 7), v: lastRow.previous, verdict: verdictOf(c.value, lastRow.previous, c.indicator, c.approx), k: 1, series: title, source, url, note: "angka bulan sebelumnya setelah direvisi" });
  }
  return tries;
}

/** A market's price when it was said (the minute's close, or the day's for an older broadcast). */
async function marketTry(c: Claim, asOf: Date): Promise<Try[]> {
  const sym = MARKET[c.indicator]!;
  const recent = Date.now() - asOf.getTime() < 2 * 86_400_000;
  const series = (await barsOf([sym], recent ? "1" : "1D", recent ? 3000 : 400))[sym] ?? [];
  const bar = series.filter((b) => b.time * 1000 <= asOf.getTime()).at(-1);
  if (!bar) return [];
  const url = `https://www.tradingview.com/symbols/${sym.replace(":", "-")}/`;
  return [{ m: new Date(bar.time * 1000).toISOString().slice(0, 16).replace("T", " "), v: bar.close, verdict: verdictOf(c.value, bar.close, c.indicator, c.approx), k: 0, series: sym, source: "harga TradingView saat diucapkan", url }];
}

/**
 * Checks a claim against the data out by `asOf`: the month it names, or else the latest data
 * (and the month before, since a speaker may still quote the previous release).
 */
export async function check(c: Claim, asOf = new Date(), get = fred.series): Promise<Check> {
  const none = (note: string): Check => ({ ...c, verdict: "unverifiable", official: null, period: null, series: null, source: null, url: null, note });
  const done = (t: Try | undefined, note: string | null = null): Check =>
    t
      ? { ...c, verdict: t.verdict, official: Math.round(t.v * 1000) / 1000, period: t.m, series: t.series, source: t.source, url: t.url, note: [t.note, note].filter(Boolean).join("; ") || null }
      : none("periode itu belum ada datanya");
  try {
    const known = (s: Series) => s.filter((p) => Date.parse(p.date) <= asOf.getTime() - 20 * 86_400_000);
    const fredTry = (key: keyof typeof SERIES, m: string, v: number, k: number, note?: string): Try => ({
      m,
      v,
      verdict: verdictOf(c.value, v, c.indicator, c.approx),
      k,
      series: SERIES[key].id,
      source: SERIES[key].source,
      url: fredUrl(SERIES[key].id),
      note,
    });

    if (MARKET[c.indicator]) return done(best(await marketTry(c, asOf)));

    if (c.indicator === "fed_funds") {
      const [lows, highs] = [await seriesOf("fed_low", get), await seriesOf("fed_high", get)];
      const day = (s: Series, t: number) => s.filter((p) => Date.parse(p.date) <= t).at(-1);
      const fits = (lo: { value: number }, hi: { value: number }) =>
        c.high !== undefined ? Math.abs(c.value - lo.value) < 0.01 && Math.abs(c.high - hi.value) < 0.01 : c.value >= lo.value - 0.01 && c.value <= hi.value + 0.01;
      const now = { lo: day(lows, asOf.getTime()), hi: day(highs, asOf.getTime()) };
      // On a decision day the range just announced is in the data from the next day on.
      const next = { lo: day(lows, asOf.getTime() + 86_400_000), hi: day(highs, asOf.getTime() + 86_400_000) };
      const pick = next.lo && next.hi && fits(next.lo, next.hi) ? next : now;
      const [lo, hi] = [pick.lo, pick.hi];
      if (!lo || !hi) return none("data tidak tersedia");
      const ok = fits(lo, hi);
      if (!ok && Date.now() - asOf.getTime() < 2 * 86_400_000)
        return { ...none("bisa jadi kisaran baru yang diputuskan hari ini: data resmi mencatatnya mulai besok"), official: lo.value, officialHigh: hi.value, period: lo.date };
      return { ...c, verdict: ok ? "match" : "differs", official: lo.value, officialHigh: hi.value, period: lo.date, series: "DFEDTARL/DFEDTARU", source: SERIES.fed_low.source, url: fredUrl("DFEDTARU"), note: null };
    }

    if (c.indicator === "rate_change") {
      // The top of the range now against just before the month named began.
      const highs = await seriesOf("fed_high", get);
      const at = (t: number) => highs.filter((p) => Date.parse(p.date) <= t).at(-1);
      const [nowHigh, tomorrow] = [at(asOf.getTime()), at(asOf.getTime() + 86_400_000)];
      if (!nowHigh) return none("data tidak tersedia");
      // A month said without its year ("since march"): this year's, or the year before's.
      const tries: Try[] = [];
      for (const [k, ym] of [c.month!, prevYear(c.month!)].entries()) {
        const was = at(Date.parse(`${ym}-01T00:00:00Z`) - 86_400_000);
        if (was) [nowHigh, tomorrow].forEach((p) => p && tries.push(fredTry("fed_high", `${ym} → ${p.date}`, p.value - was.value, k)));
      }
      if (!tries.length) return none("data tidak tersedia");
      const t = best(tries);
      if (t.verdict !== "match" && Date.now() - asOf.getTime() < 2 * 86_400_000) return { ...none("bisa jadi termasuk keputusan hari ini: data resmi mencatatnya mulai besok"), official: t.v, period: t.m };
      return done(t);
    }

    if (c.indicator === "payrolls_avg") {
      const pts = known(await seriesOf("payrolls", get));
      const change = pts.slice(1).map((p, k) => ({ m: month(p.date), v: p.value - pts[k].value }));
      const at = c.month ? change.findIndex((x) => x.m === c.month) : change.length - 1;
      if (at < 2) return none("periode itu belum ada datanya");
      const tries = [at, at - 1]
        .filter((k) => k >= 2)
        .slice(0, c.month ? 1 : 2)
        .map((k, j) => fredTry("payrolls", change[k].m, (change[k].v + change[k - 1].v + change[k - 2].v) / 3, j));
      return done(best(tries), "data payroll sering direvisi");
    }

    // The releases as first published, and FRED's revised figures where it has them.
    const tries: Try[] = [...(await releaseTries(c, asOf))];
    if (c.indicator === "unemployment" || c.indicator === "gdp") {
      const pts = known(await seriesOf(c.indicator, get));
      const cands = c.month ? pts.filter((p) => month(p.date) === c.month) : pts.slice(-2).reverse();
      cands.forEach((p, k) => tries.push(fredTry(c.indicator as keyof typeof SERIES, month(p.date), p.value, k, "angka setelah revisi")));
    }
    if (c.indicator === "payrolls") {
      const pts = known(await seriesOf("payrolls", get));
      const change = pts.slice(1).map((p, k) => ({ m: month(p.date), v: p.value - pts[k].value }));
      const cands = c.month ? change.filter((x) => x.m === c.month) : change.slice(-2).reverse();
      cands.forEach((x, k) => tries.push(fredTry("payrolls", x.m, x.v, k, "angka setelah revisi")));
    }
    if (c.indicator === "balance_sheet" || c.indicator === "mortgage") {
      const pts = (await seriesOf(c.indicator, get)).filter((p) => Date.parse(p.date) <= asOf.getTime());
      const scale = c.indicator === "balance_sheet" ? 1e-6 : 1; // WALCL is in millions of dollars
      pts.slice(-2).reverse().forEach((p, k) => tries.push(fredTry(c.indicator as keyof typeof SERIES, p.date, p.value * scale, k)));
    }
    const yearly: Partial<Record<Indicator, Array<keyof typeof SERIES>>> = {
      inflation: ["pce", "cpi", "core_pce", "core_cpi"],
      pce: ["pce"],
      core_pce: ["core_pce"],
      cpi: ["cpi"],
      core_cpi: ["core_cpi"],
      wages: ["wages"],
    };
    for (const key of yearly[c.indicator] ?? []) {
      const rates = yoy(known(await seriesOf(key, get)));
      const months = [...rates.keys()].sort();
      const cands = c.month ? [c.month] : months.slice(-2).reverse();
      cands.forEach((m, k) => {
        const v = rates.get(m);
        if (v !== undefined) tries.push(fredTry(key, m, v, k, c.indicator === "inflation" ? `ukuran tidak disebut: paling cocok dengan ${LABEL[key as Indicator]}` : undefined));
      });
    }
    const t = best(tries);
    return done(t, t && t.k > 0 && !t.note ? "cocok dengan rilis sebelumnya" : null);
  } catch (err) {
    return none(`data resmi gagal dibaca: ${err instanceof Error ? err.message : err}`);
  }
}

export const VERDICT_LABEL: Record<Verdict, string> = { match: "sesuai data", close: "mendekati", differs: "berbeda", unverifiable: "tak bisa diverifikasi" };

/**
 * The claims in a transcript's lines, each with the line its figure was said in. Captions cut a
 * sentence across lines, so the lines are read together.
 */
export function claimsInLines(lines: string[], asOf = new Date()): Array<Claim & { line: number }> {
  const starts: number[] = [];
  let text = "";
  for (const l of lines) {
    starts.push(text.length);
    text += `${prepare(l).trim()} `;
  }
  return extractClaims(text, asOf).map((c) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= c.at) line++;
    return { ...c, line };
  });
}
