// Evidence for what's said on a broadcast that isn't a figure: an event a speaker states ("the
// president waived the new sanctions on Russia", "tariffs on Chinese steel were raised") looked for
// in the news the app has already kept (the News tab's archive: the wires, the papers, the official
// releases, the last seven days), with the same matching the Insider tab uses to tell whether an
// outlet has reported what an account posted (socialfeed.ts: shared words weighed by how rare they
// are among the headlines, enough of them, and of the right kind).
//
// It finds reports, it doesn't judge them: a statement with matching headlines shows them, with
// their links, so the reader can see what was reported; one without is "not found in the archive",
// which isn't "false" (the archive may not have the story, or the speaker may say it first).

import { headlines, isFigure, keywords, sameStory, type Confirmation, type Headline } from "./socialfeed.js";

export type Statement = { text: string; line: number; lastLine: number };
export type Evidence = Statement & { sources: Confirmation[] };

/** A statement of an event, in the past or now: what a report could confirm. */
const EVENT =
  /\b(?:\w{2,}ed|said|says|told|grew|rose|fell|became|began|won|lost|struck|hit|beat|cut|went|came|took|made|gave|held|met|left|ran|kept|brought|sent|built|broke|chose|drove|fought|flew|spoke|threw|wrote|sank|shot|sought|stood|sold|bought|led|paid|laid|shut|spent|set|put|quit|split|spread|swept|won|lay off|is \w+ing|are \w+ing|(?:has|have|had) \w+)\b/;
/** Words in -ed that tell how things are, not what happened ("expectations remain well anchored"). */
const STATE_ED =
  /\b(?:anchored|elevated|expected|needed|concerned|committed|focused|prepared|interested|limited|balanced|measured|determined|pleased|surprised|worried|used|supposed|based|related|projected|tied|skewed|attuned|positioned|restricted|restrictive|well-anchored|advanced economies)\b/g;
/** A view, a guess, a hope: the speaker's own, not a report to look for. */
const OPINION = /\b(?:i think|i believe|in my view|we think|we believe|i would say|i'd say|my sense|it seems|probably|perhaps|maybe|i feel|i guess|i hope|we hope|in my opinion|i suspect|i'm not sure)\b/;
/**
 * The speaker's own plans and forecasts ("we will…", "i expect…", "if…"): not a report to look for.
 * Others' are ("netflix will lay off", "rubio said the president would…"): that's what reports tell of.
 */
const OWN_PLAN =
  /\b(?:we|i)(?:'ll| will| would| shall| expect| anticipate| project| plan| intend| want| aim| need| should| could| might| may| continue)\b|\b(?:our|my) (?:expectation|projection|forecast|plan|outlook)s?\b|\bif\b/;
const MAX_WORDS = 32;
const RUN_WORDS = 18;
const WINDOW_BEFORE = 7 * 86_400_000;
const WINDOW_AFTER = 2 * 3_600_000;

/**
 * A transcript's lines as statements: its sentences where the captions punctuate them, else
 * overlapping stretches of eighteen words, each with the lines it runs over.
 */
export function statements(lines: string[]): Statement[] {
  const starts: number[] = [];
  let text = "";
  for (const l of lines) {
    starts.push(text.length);
    text += `${l.replace(/\s+/g, " ").trim()} `;
  }
  const lineAt = (pos: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= pos) k++;
    return k;
  };
  const out: Statement[] = [];
  for (const m of text.matchAll(/(?:[^.?!]|[.?!](?![\s]|$))+[.?!]*/g)) {
    const words = [...m[0].matchAll(/\S+/g)];
    // An unpunctuated run (automatic captions): windows of a headline's length and a half,
    // overlapping by half, so that each story said is whole in one and not mixed with the next.
    const size = words.length > MAX_WORDS ? RUN_WORDS : MAX_WORDS;
    for (let k = 0; k < words.length; k += size === MAX_WORDS ? size : RUN_WORDS / 2) {
      const part = words.slice(k, k + size);
      if (part.length < 6) break;
      const from = (m.index ?? 0) + part[0].index!;
      const to = (m.index ?? 0) + part.at(-1)!.index! + part.at(-1)![0].length;
      out.push({ text: text.slice(from, to).trim(), line: lineAt(from), lastLine: lineAt(to - 1) });
      if (k + size >= words.length) break;
    }
  }
  return out;
}

/** Whether a statement tells of an event a report could confirm (not a view, a plan or a question). */
export function isEventClaim(text: string): boolean {
  return eventPart(text) !== null;
}

/**
 * What of a statement tells of an event, to look up: all of it, or what comes before a view or a
 * plan begins (a stretch of unpunctuated captions runs on into the next sentence: "…attacked by
 * Israeli settlers in the West Bank, Belgium said. Meanwhile I think…"). Null when none does.
 */
export function eventPart(text: string): string | null {
  const src = text.trim();
  const t = src.toLowerCase();
  if (t.endsWith("?")) return null;
  const view = [OPINION.exec(t), OWN_PLAN.exec(t)].filter((m) => m !== null).sort((a, b) => a.index - b.index)[0];
  const part = view ? src.slice(0, view.index).trim() : src;
  const p = part.toLowerCase();
  if (!EVENT.test(p.replace(STATE_ED, " ")) || keywords(p).size < 5) return null;
  return part;
}

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };

/** Numbers as captions spell them ("sixty days", "one thousand employees") in figures, as headlines write them. */
export function spokenNumbers(text: string): string {
  return text.replace(
    /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[\s-]+|\b)){1,6}/gi,
    (m) => {
      const words = m.toLowerCase().trim().split(/[\s-]+/);
      // "one" alone is a word, not a figure ("one of the…").
      if (words.length === 1 && UNITS[words[0]] !== undefined && UNITS[words[0]] < 10) return m;
      let total = 0;
      let part = 0;
      for (const w of words) {
        if (UNITS[w] !== undefined) part += UNITS[w];
        else if (TENS[w] !== undefined) part += TENS[w];
        else if (w === "hundred") part = (part || 1) * 100;
        else if (SCALES[w]) { total += (part || 1) * SCALES[w]; part = 0; }
      }
      return `${total + part}${/\s$/.test(m) ? " " : ""}`;
    },
  );
}

/** The headlines and how rare each word is among them, for a window of the archive. */
export type NewsIndex = { list: Headline[]; stems: Array<Set<string>>; names: Array<Set<string>>; allNames: Set<string>; df: Map<string, number>; rareDf: number };

/** Said and written forms as one ("waived" and "waives", "grew" and "grows"): headlines speak in the present. */
const IRREGULAR: Record<string, string> = {
  grew: "grow", rose: "rise", fell: "fall", became: "become", began: "begin", won: "win", struck: "strike",
  hit: "hit", hits: "hit", beat: "beat", beats: "beat", said: "say", says: "say", told: "tell", cut: "cut", cuts: "cut",
  lost: "lose", sold: "sell", bought: "buy", led: "lead", paid: "pay", laid: "lay", shut: "shut", spent: "spend",
};
export function stem(word: string): string {
  let w = word;
  w = IRREGULAR[w] ?? w;
  if (/^\d/.test(w) || w.length <= 4) return w;
  return w.replace(/ies$/, "y").replace(/(?:ing|ed|es|e)$/, "");
}
const stems = (words: Iterable<string>) => new Set([...words].map(stem));

export function indexNews(list: Headline[]): NewsIndex {
  const df = new Map<string, number>();
  const all = list.map((h) => stems(h.words));
  for (const set of all) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const rareDf = Math.max(3, Math.ceil(list.length * 0.002));
  // Words the headlines write in lower case somewhere ("heavy rain"): a common word, not a name.
  const lower = new Set<string>();
  for (const h of list) for (const m of h.title.matchAll(/(?<=\s)[a-z][\w'’]*/g)) lower.add(stem(m[0].replace(/['’]s$/, "")));
  const named = (w: string) => !lower.has(w);
  const names = list.map((h, k) => namesIn(h.title, all[k], named));
  // The places and people the headlines name, to tell a statement's own.
  const allNames = new Set<string>();
  for (const set of names) for (const w of set) if (named(w)) allNames.add(w);
  return { list, stems: all, names, allNames, df, rareDf };
}

/**
 * The names in a headline written in sentence case ("Heavy rain and flooding in Istanbul forces…"):
 * its capitalised words after the first, and the first when no headline writes it in lower case
 * ("Victoria", not "Heavy"). Title case ("Dollar Advances to Highest…") tells none.
 */
export function namesIn(title: string, words: Set<string>, named: (w: string) => boolean = () => false): Set<string> {
  const out = new Set<string>();
  // Not a newsletter's name after the headline ("… | First Thing").
  const all = [...title.split(" | ")[0].matchAll(/[A-Za-z][\w'’]*/g)].map((m) => m[0]);
  const caps = all.slice(1).filter((w) => /^[A-Z]/.test(w));
  if (all.length < 2 || caps.length * 2 >= all.length - 1) return out;
  const key = (w: string) => stem(w.toLowerCase().replace(/['’]s$/, ""));
  for (const w of caps) if (words.has(key(w))) out.add(key(w));
  if (words.has(key(all[0])) && named(key(all[0]))) out.add(key(all[0]));
  return out;
}

let cached: { at: number; from: number; index: NewsIndex } | null = null;

/** The archive's last week before `time` (read again every ten minutes). */
function newsAround(time: number): NewsIndex {
  const from = time - WINDOW_BEFORE;
  if (cached && Date.now() - cached.at < 10 * 60_000 && Math.abs(cached.from - from) < 3_600_000) return cached.index;
  const index = indexNews(headlines(from).filter((h) => h.time <= time + WINDOW_AFTER));
  cached = { at: Date.now(), from, index };
  return index;
}

/**
 * The outlets that reported what a statement says, from the week before it was said: headlines
 * that share enough of its rarer words, at most three outlets, the best match first.
 */
export function findReports(text: string, time: number, index = newsAround(time)): Confirmation[] {
  const { list, df, rareDf } = index;
  if (!list.length) return [];
  const idf = (w: string) => Math.log((list.length + 1) / ((df.get(w) ?? 0) + 1));
  const words = stems(keywords(spokenNumbers(text)));
  if (words.size < 4) return [];
  let statementScore = 0;
  for (const w of words) statementScore += idf(w);
  const found: Array<Confirmation & { score: number; shared: string[]; covers: number }> = [];
  for (const [k, h] of list.entries()) {
    if (h.time < time - WINDOW_BEFORE || h.time > time + WINDOW_AFTER) continue;
    const shared: string[] = [];
    let score = 0;
    let headlineScore = 0;
    for (const w of index.stems[k]) {
      const x = idf(w);
      headlineScore += x;
      if (!words.has(w)) continue;
      shared.push(w);
      score += x;
    }
    // Who or where the story is about must be said ("flooding closed schools in Italy" isn't Istanbul's).
    const names = index.names[k];
    if (names.size && !shared.some((w) => names.has(w))) continue;
    // Nor another on each side ("…homes across southern Greece" isn't California's).
    if ([...names].some((w) => !words.has(w)) && [...words].some((w) => index.allNames.has(w) && !index.stems[k].has(w))) continue;
    // A statement is longer than a post's headline: the headline must be mostly covered by it.
    if (!sameStory(shared, score, headlineScore, statementScore, shared.filter((w) => (df.get(w) ?? 0) <= rareDf).length)) continue;
    if (headlineScore > 0 && score / headlineScore < 0.35 && !shared.some(isFigure)) continue;
    found.push({ publisher: h.publisher, title: h.title, link: h.link, time: h.time, score, shared, covers: score / headlineScore + score / statementScore });
  }
  found.sort((a, b) => b.score - a.score);
  // The best must be the story itself: most of the headline said, and most of what was said in it
  // (not "Taiwan plans to buy liquefied natural gas" for "India agreed to buy liquefied natural gas").
  if (!found.length || found[0].covers < 1) return [];
  // Other outlets on the same words as the best one, one each.
  const lead = new Set(found[0]?.shared ?? []);
  const seen = new Set<string>();
  return found
    .filter((f, i) => i === 0 || (f.score >= 0.6 * found[0].score && f.shared.filter((w) => lead.has(w)).length * 2 >= f.shared.length))
    .filter((f) => !seen.has(f.publisher) && seen.add(f.publisher))
    .slice(0, 3)
    .map(({ score: _s, shared: _w, covers: _c, ...c }) => ({ ...c, link: c.link.replace(/&amp;/g, "&") }));
}
