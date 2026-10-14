// How hawkish or dovish a Fed speaker sounds, from what they say. A phrase lexicon, read offline:
// a hawkish phrase (inflation still too high, rates held higher or raised, a strong labor market)
// counts +1, a dovish one (rate cuts, a cooling labor market, inflation coming down) −1, and a
// negation just before ("not", "no", "fewer", "less", "unlikely to") turns it round. The index is
// (hawkish − dovish) / (hawkish + dovish + 3): 0 with nothing said yet, near ±1 only when the
// phrases all lean one way and there are many of them.

export type Side = 1 | -1;
export type Hit = { phrase: string; side: Side; /** Offset in the text read. */ at: number };

const RATES = "(?:the )?(?:policy |interest |federal funds |funds |benchmark )?rates?";

/** [pattern, side]: the patterns are matched on lower-case text with ’ made '. */
const LEXICON: Array<[string, Side]> = [
  // Inflation too high, or at risk of going higher.
  ["inflation (?:remains|is still|is|still|has remained|has been|stays) (?:somewhat |quite |very |too )?(?:elevated|high|too high|sticky|stubborn|persistent)", 1],
  ["(?:elevated|persistent|sticky|stubborn|high) inflation", 1],
  ["upside risks? (?:to|on|for) (?:inflation|prices)", 1],
  ["inflation(?:ary)? (?:pressures?|risks?)", 1],
  ["inflation expectations (?:have )?(?:risen|rising|moved up|moving up|drifting up|unanchored)", 1],
  ["(?:prices|inflation) (?:have |has )?(?:picked up|moved up|reaccelerated|risen|rising|firming)", 1],
  ["reaccelerat\\w*", 1],
  ["overheat\\w*", 1],
  ["tariffs? (?:could|will|may|would|are|have) (?:\\w+ )?(?:raise|raising|push up|pushing up|boost|boosting|add to) (?:prices|inflation)", 1],
  ["not (?:yet )?(?:confident|convinced|there yet)", 1],
  // Rates up or held higher, policy tight.
  [`(?:raise|raising|hike|hiking|increase|increasing|lift|lifting) ${RATES}`, 1],
  ["rate (?:hikes?|increases?)", 1],
  ["(?:one more|another|an additional|additional|further) (?:rate |interest rate )?(?:hikes?|increases?)", 1],
  ["further (?:tightening|firming|policy firming|increases)", 1],
  ["tighten(?:ing)? (?:of )?(?:policy|monetary policy|financial conditions)", 1],
  ["(?:sufficiently |appropriately |modestly |somewhat |still |quite )?restrictive", 1],
  ["higher for longer", 1],
  ["(?:hold|holding|keep|keeping|maintain|maintaining|leave|leaving) (?:policy|rates|the policy rate|the federal funds rate|our policy rate)(?: \\w+)? (?:steady|unchanged|where (?:it|they) (?:is|are)|on hold|higher|elevated)", 1],
  ["premature to (?:cut|ease|lower|declare)", 1],
  ["(?:in )?no (?:hurry|rush)", 1],
  ["well positioned to wait", 1],
  ["(?:wait|waiting) (?:and see|to see|for more data)", 1],
  ["(?:strong|solid|robust|tight|resilient|healthy) labor market", 1],
  ["labor market (?:remains|is|has been|has remained) (?:strong|solid|robust|tight|resilient|healthy)", 1],
  ["(?:strong|solid|robust|resilient) (?:economy|growth|demand|consumer spending|spending|activity)", 1],
  ["wage (?:growth|pressures?|inflation)", 1],
  ["(?:shrink|shrinking|reduce|reducing) (?:the |our )?balance sheet", 1],
  ["quantitative tightening", 1],
  ["vigilan\\w*", 1],
  // Rates down, policy eased.
  [`(?:cut|cutting|lower|lowering|reduce|reducing|ease|easing|trim|trimming) ${RATES}`, -1],
  ["rate (?:cuts?|reductions?)", -1],
  ["(?:one more|another|an additional|additional|further) (?:rate |interest rate )?(?:cuts?|reductions?)", -1],
  ["(?:further |policy |monetary )?easing", -1],
  ["(?:move|moving|moved) (?:policy |rates )?(?:toward|towards|closer to) (?:a )?neutral", -1],
  ["recalibrat\\w*", -1],
  ["accommodat(?:ive|ion)", -1],
  ["(?:soft|softening|softer|cooling|weaker|weakening|slowing|deteriorating|loosening) labor market", -1],
  ["labor market (?:has )?(?:softened|cooled|weakened|loosened|deteriorated|is softening|is cooling|is weakening|is loosening)", -1],
  ["(?:rising|higher) unemployment", -1],
  ["unemployment (?:rate )?(?:has )?(?:risen|rising|moved up|increased|ticked up|climbing)", -1],
  ["downside risks? (?:to|for) (?:employment|the labor market|growth|the economy|activity)", -1],
  ["(?:job|payroll) (?:losses|growth has slowed|gains have slowed)", -1],
  ["layoffs?", -1],
  ["disinflation\\w*", -1],
  // "Transitory" (inflation that will pass) against "persistent" (above); "not transitory" turns hawkish.
  ["(?:transitory|temporary|one-off|one-time) (?:inflation|price increases?|effects?|shocks?|bump)", -1],
  ["transitory", -1],
  ["inflation (?:has |is |continues to )?(?:come|coming|moved|moving|comes|move|continued to move) (?:down|lower)", -1],
  ["inflation (?:is |has been )?(?:easing|cooling|moderating|declining|falling|slowing|eased|cooled|moderated|declined|fell|slowed)", -1],
  ["inflation (?:will|would|should|to|could) (?:continue to )?(?:slow|ease|cool|moderate|decline|fall|come down|move down)", -1],
  ["progress (?:on|toward|towards) (?:our )?(?:2 percent|two percent|inflation|price stability)", -1],
  ["(?:slowing|slower|weaker|weakening|softer|softening) (?:growth|economy|demand|activity|spending)", -1],
  ["recession\\w*", -1],
  ["support (?:the )?(?:economy|labor market|employment|maximum employment|growth)", -1],
  ["(?:end|ending|stop|stopping|slow|slowing|conclude|concluding) (?:the )?(?:balance sheet runoff|runoff|quantitative tightening|balance sheet reduction)", -1],
];

const COMPILED = LEXICON.map(([p, side]) => ({ re: new RegExp(`\\b${p}\\b`, "g"), side }));
const NEGATION = /\b(?:not|no|never|without|nor|fewer|less|unlikely to|don't|doesn't|didn't|won't|wouldn't|isn't|aren't|can't|cannot)\b/;

/** Lower case, curly quotes straight, "2%" as "2 percent", one space between words. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/(\d)\s*%/g, "$1 percent").replace(/\s+/g, " ");
}

/**
 * The lexicon's phrases in a (normalized) text, longest first where they overlap, each turned
 * round by a negation in the three words before it.
 */
export function findHits(text: string): Hit[] {
  const found: Array<Hit & { end: number }> = [];
  for (const { re, side } of COMPILED) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) found.push({ phrase: m[0], side, at: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.at - b.at || b.end - a.end);
  const out: Hit[] = [];
  let reach = -1;
  for (const h of found) {
    if (h.at < reach) continue;
    reach = h.end;
    const before = text.slice(0, h.at).split(" ").slice(-4).join(" ");
    // A negation inside the phrase ("not yet confident") is the phrase's own.
    const flip = !/^not\b/.test(h.phrase) && NEGATION.test(before);
    out.push({ phrase: h.phrase, side: (flip ? -h.side : h.side) as Side, at: h.at });
  }
  return out;
}

/** −1 (all dovish) .. +1 (all hawkish), damped toward 0 when only a few phrases have been heard. */
export function indexOf(hawkish: number, dovish: number): number {
  return Math.round(((hawkish - dovish) / (hawkish + dovish + 3)) * 1000) / 1000;
}

export type Stance = "hawkish" | "dovish" | "neutral";
export const stanceOf = (index: number): Stance => (index >= 0.2 ? "hawkish" : index <= -0.2 ? "dovish" : "neutral");
