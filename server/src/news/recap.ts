// The news recap: every headline the news wire has seen in a day or a week, under the news tab's
// categories (markets, economic, geopolitics, tech…), summed up on this machine with fixed rules
// (no AI service, no network).
//
// 1. Categories: each headline is recapped under its category in the news tab, so a category's
//    recap covers what the news tab lists under it.
// 2. Tone: a finance word list scores each headline positive or negative ("rate cut" and "job
//    cuts" are read as phrases first; "not", "fails to"… flip what follows).
// 3. Stories: headlines about the same thing (sharing most of their words) are grouped, and a
//    story told by more outlets, better ones and with a stronger tone ranks higher.
// 4. Topics: the words and pairs of words a category's stories share far more than the rest.
// 5. The conclusion: a sentence from all that, compared with the period before.

export type RecapInput = {
  id: string;
  title: string;
  link: string;
  summary: string;
  publisher: string;
  feedId: string;
  category: string;
  region: string;
  tier: number;
  publishedAt: string;
};

export type RecapItem = Omit<RecapInput, "feedId" | "tier"> & { tone: -1 | 0 | 1 };
export type RecapStory = { id: string; headline: RecapItem; related: RecapItem[]; publishers: number; tone: number };
export type RecapSector = {
  id: string;
  name: string;
  count: number;
  publishers: number;
  tone: number;
  toneLabel: string;
  positive: number;
  negative: number;
  neutral: number;
  previous: { count: number; tone: number } | null;
  topics: string[];
  conclusion: string;
  stories: RecapStory[];
};
export type NewsRecap = { from: string; to: string; kind: "day" | "week"; total: number; publishers: number; summary: string; sectors: RecapSector[] };

// ---------------------------------------------------------------- words

/** Lower-case words, possessives dropped; `raw` keeps each word as written. */
export function words(text: string): { raw: string[]; low: string[] } {
  const raw = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/gi, "")
    .split(/[^\p{L}\p{N}&]+/u)
    .filter(Boolean);
  return { raw, low: raw.map((w) => w.toLowerCase()) };
}

type Entry = { tokens: string[]; prefix: boolean; tag: string; weight: number };
type Match = { tag: string; weight: number; start: number; len: number };

/** Phrases to find in a list of words; a trailing * matches any ending of the last word. */
class Lexicon {
  private byFirst = new Map<string, Entry[]>();
  private stems: Entry[] = [];

  constructor(lists: Record<string, Array<string | [string, number]>>) {
    for (const [tag, list] of Object.entries(lists)) {
      for (const item of list) {
        const [phrase, weight] = typeof item === "string" ? [item, 1] : item;
        const prefix = phrase.endsWith("*");
        const tokens = words(prefix ? phrase.slice(0, -1) : phrase).low;
        if (tokens.length === 0) continue;
        const entry = { tokens, prefix, tag, weight };
        if (prefix && tokens.length === 1) this.stems.push(entry);
        else this.byFirst.set(tokens[0], [...(this.byFirst.get(tokens[0]) ?? []), entry]);
      }
    }
  }

  /** Every match, longest first where they overlap. */
  find(low: string[]): Match[] {
    const all: Match[] = [];
    for (let i = 0; i < low.length; i++) {
      for (const e of this.byFirst.get(low[i]) ?? []) {
        const n = e.tokens.length;
        if (i + n > low.length) continue;
        let ok = true;
        for (let k = 1; k < n && ok; k++) ok = e.prefix && k === n - 1 ? low[i + k].startsWith(e.tokens[k]) : low[i + k] === e.tokens[k];
        if (ok) all.push({ tag: e.tag, weight: e.weight, start: i, len: n });
      }
      for (const e of this.stems) if (low[i].startsWith(e.tokens[0])) all.push({ tag: e.tag, weight: e.weight, start: i, len: 1 });
    }
    all.sort((a, b) => b.len - a.len || a.start - b.start);
    const used = new Set<number>();
    const out: Match[] = [];
    for (const m of all) {
      let free = true;
      for (let k = m.start; k < m.start + m.len && free; k++) free = !used.has(k);
      if (!free) continue;
      for (let k = m.start; k < m.start + m.len; k++) used.add(k);
      out.push(m);
    }
    return out;
  }
}

// ---------------------------------------------------------------- categories

/** The news tab's categories, in its order: each headline is recapped under its own. */
export const CATEGORIES = ["MARKETS", "ECONOMIC", "REGULATORY", "GEOPOLITICS", "CRYPTO", "ENERGY", "TECH"];

// ---------------------------------------------------------------- tone

const TONE = new Lexicon({
  pos: [
    "surge*", "soar*", "jump*", "rally", "rallies", "rallied", "gain", "gains", "gained", "rise", "rises", "rising", "rose", "climb*", "rebound*",
    "recover*", "boost*", "beat", "beats", "record high*", "all time high*", "upgrade*", "outperform*", "strong", "stronger", "strength*", "robust",
    "growth", "grow", "grows", "growing", "expand*", "profit", "profits", "profitable", "optimis*", "bullish", "approve*", "approval", "wins", "win",
    "breakthrough", "eases", "easing", "cools", "cooling", "rate cut*", "beats estimates", "upbeat", "tops", "top estimates", ["higher", 0.5], "positive",
    "accelerat*", "improv*", "hits record*", "hit record*", "cuts rates", "cut rates", "cuts interest rates", "rescue*", "agreement", "deal", "truce", "ceasefire", "peace", "naik", "menguat", "melonjak", "meroket", "untung", "laba",
    "tumbuh", "positif", "rekor", "optimistis", "surplus", "upside", "buyback*", "raises guidance", "raises forecast",
  ],
  neg: [
    "plunge*", "plummet*", "slump*", "tumbl*", "sink*", "sank", "fall", "falls", "falling", "fell", "drop", "drops", "dropped", "dropping", "declin*",
    "slide", "slides", "slid", "lose", "loses", "losing", "loss", "losses", "miss", "misses", "missed", "downgrade*", "warn*", "weak*", "slow*",
    "recession*", "crisis", "crash*", "fear*", "worr*", "concern*", ["risk", 0.5], ["risks", 0.5], "volatil*", "sell off", "selloff", "bearish",
    "layoff*", "job cuts", "lawsuit*", "sue", "sues", "sued", "probe*", "investigat*", "fraud*", "scandal*", "bankrupt*", "default*", ["tariff*", 0.5],
    ["sanction*", 0.5], "war", "attack*", "kill*", "dead", "death*", ["strike", 0.5], ["strikes", 0.5], "shutdown*", "halt*", "delay*", "recall*",
    "fined", "penalty", "rate hike*", "turmoil", "uncertain*", ["lower", 0.5], "negative",
    "inflation rise*", "inflation rose", "inflation jump*", "inflation surge*", "inflation accelerat*", "inflation climb*", "unemployment rise*",
    "unemployment rose", "jobless claims rise*", "prices soar*", "costs soar*", "cuts", "cut", "slash*", "shortage*", "deficit", "inflation fears",
    "profit warning", "turun", "melemah", "anjlok", "merosot", "rugi", "krisis", "resesi", "khawatir", "gagal", "downside", "tension*", "threat*",
    "collapse*", "struggl*", "hacked", "stolen", "theft", "exploit*", "breach*", "outage*", "hit", "hits", "hurt*", "damage*", "disrupt*",
  ],
});
const NEGATORS = new Set(["not", "no", "never", "without", "fails", "failed", "fail", "unlikely", "despite", "tidak", "bukan", "belum", "tak"]);

/** The tone of a text: what its tone words add up to, each flipped after "not" and the like. */
function toneOf(text: string): number {
  const { low } = words(text);
  let s = 0;
  for (const m of TONE.find(low)) {
    const flipped = low.slice(Math.max(0, m.start - 3), m.start).some((w) => NEGATORS.has(w));
    s += (m.tag === "pos" ? 1 : -1) * m.weight * (flipped ? -1 : 1);
  }
  return s;
}

/** -1, 0 or 1: the title's tone counts double the summary's. */
export function toneOfItem(item: Pick<RecapInput, "title" | "summary">): -1 | 0 | 1 {
  const s = 2 * toneOf(item.title) + toneOf(item.summary);
  return s >= 1 ? 1 : s <= -1 ? -1 : 0;
}

// ---------------------------------------------------------------- stories and topics

const STOP = new Set(
  (
    "a an the and or but if of to in on at by for with from into onto over under as is are was were be been being it its this that these those " +
    "he she they we you i his her their our your them him us than then so such not no nor too very can could will would shall should may might must " +
    "do does did done has have had having up down out off about after before amid amidst against between during while since until via per vs " +
    "says said say saying told tells report reports reported reporting according new news update updates live latest today week weeks year years " +
    "day days month months what why how who when where which more most less least first last next just also still now here there all any some " +
    "one two three four five back get gets got make makes made take takes took see sees seen set sets over amid us u s uk eu" +
    " yang dan di ke dari untuk dengan pada ini itu akan dalam tidak juga atau karena oleh sebagai bisa sudah masih lebih hari minggu tahun"
  ).split(/\s+/)
);
/** Words too common in market news to name a topic. */
const GENERIC = new Set(
  ("market markets stock stocks shares share price prices investor investors trading trader traders company companies firm firms business " +
    "global world percent pct billion million trillion points index post posts plan plans set sets hit hits see sees eye eyes look looks warn " +
    "warns call calls urge urges face faces ahead near seek seeks want wants go goes come comes keep keeps put puts show shows reveal reveals " +
    "expect expects expected likely level levels time big top high low major key weekly daily linked amid people man woman men women latest " +
    "could week's analysis opinion video watch podcast exclusive breaking using use uses cost costs")
    .split(" ")
);

const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const keyWords = (title: string) => new Set(words(title).low.filter((w) => !STOP.has(w) && w.length > 1).map(stem));

function similar(a: Set<string>, b: Set<string>): boolean {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both >= 2 && both / (a.size + b.size - both) >= 0.34;
}

type Scored = RecapInput & { tone: -1 | 0 | 1; keys: Set<string> };

const TIER_WEIGHT: Record<number, number> = { 1: 3, 2: 1.5, 3: 0.5, 4: 0 };

function clusters(items: Scored[]): Scored[][] {
  const groups: Scored[][] = [];
  const sorted = [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  for (const item of sorted) {
    const home = groups.find((g) => g.slice(0, 6).some((m) => similar(m.keys, item.keys)));
    if (home) home.push(item);
    else groups.push([item]);
  }
  return groups;
}

const out = (i: Scored): RecapItem => ({
  id: i.id,
  title: i.title,
  link: i.link,
  summary: i.summary,
  publisher: i.publisher,
  category: i.category,
  region: i.region,
  publishedAt: i.publishedAt,
  tone: i.tone,
});

function story(group: Scored[], from: number, to: number): RecapStory & { score: number } {
  const best = [...group].sort((a, b) => a.tier - b.tier || a.publishedAt.localeCompare(b.publishedAt))[0];
  const publishers = new Set(group.map((g) => g.publisher.toLowerCase())).size;
  const tone = group.reduce((s, g) => s + g.tone, 0) / group.length;
  const latest = Math.max(...group.map((g) => Date.parse(g.publishedAt)));
  const recency = to > from ? Math.min(1, Math.max(0, (latest - from) / (to - from))) : 0;
  const score = 1.5 * publishers + 0.5 * group.length + Math.max(...group.map((g) => TIER_WEIGHT[g.tier] ?? 0)) + 0.5 * Math.abs(tone) + 0.5 * recency;
  const related = group
    .filter((g) => g !== best)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map(out);
  return { id: best.id, headline: out(best), related, publishers, tone, score };
}

/**
 * The words and pairs of words a category's stories use much more than all stories do. A story
 * (however many outlets carried it) counts once, so a topic is one several stories share.
 */
function topics(sector: Scored[][], all: Scored[][], max = 5): string[] {
  const surface = new Map<string, Map<string, number>>();
  const termsOf = (story: Scored[], keepForms: boolean) => {
    const terms = new Set<string>();
    for (const item of story) {
      const { raw, low } = words(item.title);
      const ok = (w: string | undefined) => w !== undefined && !STOP.has(w) && !GENERIC.has(w) && w.length > 1 && !/^\d+$/.test(w);
      for (let i = 0; i < low.length; i++) {
        if (!ok(low[i])) continue;
        const found: Array<[string, string]> = [[stem(low[i]), raw[i]]];
        if (ok(low[i + 1])) found.push([`${stem(low[i])} ${stem(low[i + 1])}`, `${raw[i]} ${raw[i + 1]}`]);
        for (const [key, shown] of found) {
          terms.add(key);
          if (!keepForms) continue;
          const forms = surface.get(key) ?? new Map<string, number>();
          forms.set(shown, (forms.get(shown) ?? 0) + 1);
          surface.set(key, forms);
        }
      }
    }
    return terms;
  };
  const count = (stories: Scored[][], keepForms: boolean) => {
    const df = new Map<string, number>();
    for (const story of stories) for (const t of termsOf(story, keepForms)) df.set(t, (df.get(t) ?? 0) + 1);
    return df;
  };
  const mine = count(sector, true);
  const every = count(all, false);
  const n = Math.max(all.length, 1);
  const ranked = [...mine.entries()]
    .filter(([key, c]) => c >= 2 && key.length > 2)
    .map(([key, c]) => ({ key, score: c * Math.log(n / (every.get(key) ?? c)) * (key.includes(" ") ? 1.3 : 1) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);
  const chosen: string[] = [];
  for (const t of ranked) {
    if (chosen.length >= max) break;
    // A word inside a chosen pair (or a pair around a chosen word) says nothing new.
    if (chosen.some((c) => c.split(" ").includes(t.key) || t.key.split(" ").includes(c))) continue;
    chosen.push(t.key);
  }
  return chosen.map((key) => {
    const forms = [...surface.get(key)!.entries()].sort((a, b) => b[1] - a[1]);
    // Title Case headlines capitalise every word; the plainest form usually reads best.
    const plain = forms.find(([f]) => f !== f.toUpperCase() || f.length <= 4);
    return (plain ?? forms[0])[0];
  });
}

// ---------------------------------------------------------------- conclusions

function toneLabel(tone: number, pos: number, neg: number, count: number): string {
  if (tone >= 0.25) return "positif";
  if (tone >= 0.08) return "cenderung positif";
  if (tone <= -0.25) return "negatif";
  if (tone <= -0.08) return "cenderung negatif";
  return pos >= 0.2 * count && neg >= 0.2 * count ? "campuran" : "netral";
}

const quote = (s: string) => `“${s.length > 110 ? s.slice(0, 107).replace(/\s+\S*$/, "") + "…" : s}”`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} dan ${xs[xs.length - 1]}`);

function conclusion(s: Omit<RecapSector, "conclusion">, kind: "day" | "week"): string {
  const before = kind === "day" ? "kemarin" : "minggu lalu";
  const parts: string[] = [];
  parts.push(`${s.count} berita dari ${s.publishers} sumber, bernada ${s.toneLabel} (${s.positive} positif, ${s.negative} negatif).`);
  if (s.previous && s.previous.count > 0) {
    const change = (s.count - s.previous.count) / s.previous.count;
    const shift = s.tone - s.previous.tone;
    const bits: string[] = [];
    if (change >= 0.3) bits.push(`pemberitaan lebih ramai (+${Math.round(change * 100)}%)`);
    else if (change <= -0.3) bits.push(`pemberitaan lebih sepi (${Math.round(change * 100)}%)`);
    if (shift >= 0.15) bits.push("nadanya membaik");
    else if (shift <= -0.15) bits.push("nadanya memburuk");
    if (bits.length) parts.push(`Dibanding ${before}, ${list(bits)}.`);
  }
  const top = s.stories.slice(0, 2);
  if (top.length) {
    parts.push(
      `Sorotan: ${top
        .map((t) => `${quote(t.headline.title)}${t.publishers > 1 ? ` (${t.publishers} sumber)` : ""}`)
        .join("; ")}.`
    );
  }
  if (s.topics.length) parts.push(`Topik dominan: ${list(s.topics)}.`);
  return parts.join(" ");
}

function overall(sectors: RecapSector[], total: number, publishers: number, kind: "day" | "week"): string {
  if (total === 0) return `Belum ada berita yang terekam untuk ${kind === "day" ? "hari" : "minggu"} ini.`;
  const named = [...sectors].sort((a, b) => b.count - a.count);
  const parts = [`${total} berita dari ${publishers} sumber ${kind === "day" ? "hari" : "minggu"} ini.`];
  const busiest = named.slice(0, 3).map((s) => `${s.name} (${s.count})`);
  if (busiest.length) parts.push(`Paling ramai: ${list(busiest)}.`);
  const enough = named.filter((s) => s.count >= 5);
  const best = [...enough].sort((a, b) => b.tone - a.tone)[0];
  const worst = [...enough].sort((a, b) => a.tone - b.tone)[0];
  if (best && best.tone >= 0.08) parts.push(`Nada paling positif di ${best.name}.`);
  if (worst && worst.tone <= -0.08) parts.push(`Nada paling negatif di ${worst.name}.`);
  const biggest = named.flatMap((s) => s.stories).sort((a, b) => b.publishers - a.publishers)[0];
  if (biggest && biggest.publishers > 1) parts.push(`Berita terbesar: ${quote(biggest.headline.title)} (${biggest.publishers} sumber).`);
  return parts.join(" ");
}

// ---------------------------------------------------------------- the recap

type Classified = { tone: -1 | 0 | 1; keys: Set<string> };
/** Headlines don't change, so each is read once. */
const memo = new Map<string, Classified>();
function classify(item: RecapInput): Classified {
  let c = memo.get(item.id);
  if (!c) {
    c = { tone: toneOfItem(item), keys: keyWords(item.title) };
    if (memo.size > 50_000) memo.clear();
    memo.set(item.id, c);
  }
  return c;
}

function bySector(items: RecapInput[]): Map<string, Scored[]> {
  const out = new Map<string, Scored[]>();
  // The same headline from two feeds (or twice in one) is one item.
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.publisher.toLowerCase()}|${item.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classify(item);
    const list = out.get(item.category) ?? [];
    list.push({ ...item, tone: c.tone, keys: c.keys });
    out.set(item.category, list);
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * The recap of the headlines published from `from` to `to`; `previous` are those of the period
 * before, to compare with (null when that period wasn't recorded in full).
 */
export function buildRecap(items: RecapInput[], previous: RecapInput[] | null, from: number, to: number, kind: "day" | "week", storiesPer = kind === "day" ? 6 : 10): NewsRecap {
  const inside = items.filter((i) => {
    const t = Date.parse(i.publishedAt);
    return t >= from && t < to;
  });
  const now = bySector(inside);
  const before = previous ? bySector(previous) : null;
  const grouped = new Map([...now].map(([id, list]) => [id, clusters(list)]));
  const allStories = [...grouped.values()].flat();

  const sectors: RecapSector[] = [];
  for (const [id, list] of now) {
    const groups = grouped.get(id)!;
    const stories = groups
      .map((g) => story(g, from, to))
      .sort((a, b) => b.score - a.score)
      .slice(0, storiesPer)
      .map(({ score: _score, ...s }) => s);
    const positive = list.filter((i) => i.tone > 0).length;
    const negative = list.filter((i) => i.tone < 0).length;
    const tone = mean(list.map((i) => i.tone));
    const prev = before?.get(id);
    const base = {
      id,
      name: id,
      count: list.length,
      publishers: new Set(list.map((i) => i.publisher.toLowerCase())).size,
      tone,
      toneLabel: toneLabel(tone, positive, negative, list.length),
      positive,
      negative,
      neutral: list.length - positive - negative,
      previous: !before ? null : { count: prev?.length ?? 0, tone: prev ? mean(prev.map((i) => i.tone)) : 0 },
      topics: topics(groups, allStories),
      stories,
    };
    sectors.push({ ...base, conclusion: conclusion(base, kind) });
  }
  const order = (id: string) => (CATEGORIES.includes(id) ? CATEGORIES.indexOf(id) : CATEGORIES.length);
  sectors.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));

  const total = new Set(inside.map((i) => `${i.publisher.toLowerCase()}|${i.title.toLowerCase()}`)).size;
  const publishers = new Set(inside.map((i) => i.publisher.toLowerCase())).size;
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    kind,
    total,
    publishers,
    summary: overall(sectors, total, publishers, kind),
    sectors,
  };
}
