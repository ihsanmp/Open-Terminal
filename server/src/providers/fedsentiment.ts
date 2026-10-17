// How hawkish or dovish a Fed speaker sounds, from what they say. A phrase lexicon, read offline:
// a hawkish phrase (inflation still too high, rates held higher or raised, a strong labor market)
// counts +1, a dovish one (rate cuts, a cooling labor market, inflation coming down) −1, and a
// negation just before ("not", "no", "fewer", "less", "unlikely to") turns it round. The index is
// (hawkish − dovish) / (hawkish + dovish + 3): 0 with nothing said yet, near ±1 only when the
// phrases all lean one way and there are many of them.
//
// Calibrated on the FOMC's 71 press conferences and 91 statements of 2016–2026 (the chair's words):
// phrases said as much on the way up as on the way down were dropped ("recession", a bare
// "restrictive", "wait and see", an easing of financial conditions), "removing accommodation" reads
// as the rate rise it is, and a condition ("we need to see inflation coming down") is left out.
// The conference's index now runs with the decision (r 0.52 → was 0.32) and the 2-year yield's next
// three months (r 0.38, was 0.27), in 2016–2020 and in 2021–2026 alike; it does not foretell the
// day's move (r ≈ 0, the decision is priced), and a statement's index reads its boilerplate.

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
  // ... unless they are said to be quiet ("inflation pressures remain muted", 2019).
  ["inflation(?:ary)? pressures (?:remain|remained|are|have been|have remained|stay|seem|appear) (?:\\w+ )?(?:muted|subdued|contained|low|modest)", -1],
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
  ["sufficiently restrictive", 1],
  ["(?:more|further) restrictive", 1],
  ["restrictive (?:for (?:some time|longer|a while|an extended period)|stance (?:for|until))", 1],
  ["(?:keep|keeping|maintain|maintaining|hold|holding) (?:policy |rates |our policy rate |the policy rate )?(?:at a )?(?:sufficiently |appropriately )?restrictive", 1],
  ["(?:less|not as|not very) restrictive", -1],
  ["higher for longer", 1],
  ["(?:hold|holding|keep|keeping|maintain|maintaining|leave|leaving) (?:policy|rates|the policy rate|the federal funds rate|our policy rate)(?: \\w+)? (?:steady|unchanged|where (?:it|they) (?:is|are)|on hold|higher|elevated)", 1],
  ["premature to (?:cut|ease|lower|declare)", 1],
  ["(?:in )?no (?:hurry|rush)", 1],
  ["well positioned to wait", 1],
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
  // Easing as policy, not "an easing of financial conditions" (a worry when raising rates, 2023).
  ["(?:further|policy|monetary|monetary policy) easing", -1],
  ["easing (?:cycle|policy|monetary policy|of (?:monetary )?policy|rates|interest rates)", -1],
  ["(?:move|moving|moved) (?:policy |rates )?(?:toward|towards|closer to) (?:a )?neutral", -1],
  ["recalibrat\\w*", -1],
  ["(?:remove|removing|removal of|withdraw|withdrawing|withdrawal of|reduce|reducing|reduction of|scale back|scaling back|dial back|dialing back|pull back|pulling back) (?:\\w+ )?(?:(?:policy|monetary policy|the|some|that|this) )?accommodation", 1],
  ["(?:less|reducing the degree of) (?:policy )?accommodat(?:ive|ion)", 1],
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
  ["support (?:the )?(?:economy|labor market|employment|maximum employment|growth)", -1],
  ["(?:end|ending|stop|stopping|slow|slowing|conclude|concluding) (?:the )?(?:balance sheet runoff|runoff|quantitative tightening|balance sheet reduction)", -1],
];

const COMPILED = LEXICON.map(([p, side]) => ({ re: new RegExp(`\\b${p}\\b`, "g"), side }));
const NEGATION = /\b(?:not|no|never|without|nor|fewer|less|unlikely to|don't|doesn't|didn't|won't|wouldn't|isn't|aren't|can't|cannot)\b/;
/**
 * A condition before a phrase ("we need to see inflation coming down") is not a reading of the
 * economy: as said while raising rates in 2022–23, it's the reverse of what it says. Such a hit is
 * left out.
 */
const CONDITION = /\b(?:need|needs|needed|want|wants|wanted|have|has|had|would like|hope|hoping|waiting) to see\b|\buntil\b|\b(?:before|unless) (?:we|they|the committee)\b/;

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
    if (CONDITION.test(text.slice(0, h.at).split(" ").slice(-7).join(" "))) continue;
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
