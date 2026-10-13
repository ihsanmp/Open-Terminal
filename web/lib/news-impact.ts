// Which headlines move markets, read off the headline's words alone (no AI, nothing sent
// anywhere): a central bank deciding on rates, an inflation or jobs report, a currency
// intervention or a record low, tariffs, a war; for crypto an ETF ruling, the SEC acting, a hack,
// a wave of liquidations, a ban; for stocks the indices plunging or soaring, a megacap's earnings,
// a multi-billion takeover, a bankruptcy. Each topic names the markets it moves and how much;
// words of size or surprise ("plunges", "record", "unexpectedly") make it bigger, and routine or
// speculative headlines ("stocks to watch", "could") smaller. 3 or more is a big one, 2 notable.

export type Market = "crypto" | "stocks" | "forex";
export type NewsImpact = { level: "high" | "medium"; score: number; markets: Market[]; reasons: string[] } | null;

type Topic = { re: RegExp; and?: RegExp; markets: Market[]; score: number; reason: string };

const ALL: Market[] = ["crypto", "stocks", "forex"];

const CENTRAL_BANK = /\b(fed|fomc|federal reserve|ecb|european central bank|boj|bank of japan|boe|bank of england|pboc|people'?s bank of china|snb|swiss national bank|rba|reserve bank|rbnz|bank of canada|bank indonesia|central bank)\b/i;
const CRYPTO = /\b(bitcoin|btc|ethereum|ether|crypto(currenc(y|ies))?|stablecoins?|tether|usdt|usdc|solana|xrp|binance|coinbase|defi)\b/i;
const INDICES = /\b(s&p\s?500|s&p|nasdaq|dow( jones)?|wall street|stock markets?|global (stocks|markets|equities)|world stocks|nikkei|hang seng|kospi|sensex|nifty|ftse|dax|ihsg|jakarta composite|stoxx)\b/i;
const MEGACAPS = /\b(nvidia|apple|microsoft|amazon|alphabet|google|meta|tesla|broadcom|jpmorgan|berkshire|netflix|tsmc|samsung)\b/i;
const FX = /\b(dollar|greenback|yen|euro|sterling|pound|yuan|renminbi|rupiah|rupee|swiss franc|currenc(y|ies)|dxy)\b/i;

/** Words of size or surprise: a move or a decision out of the ordinary. */
const INTENSITY = /\b(plunges?|plunged|plummets?|crash(es|ed)?|tumbles?|tumbled|sinks?|sank|soars?|soared|surges?|surged|skyrockets?|rout|sell-?off|meltdown|record|all-time high|worst|best day|unexpected(ly)?|surprise|shock|emergency|historic|freefall|spikes?|spiked|panic|turmoil|slump(s|ed)?)\b/i;
const BIG_MONEY = /\$\s?\d+(\.\d+)?\s?(trillion|tn|billion|bn)\b|\b\d+(\.\d+)?\s?(trillion|billion)\b/i;
const BIG_PERCENT = /\b(\d{2,}|[5-9])(\.\d+)?\s?%/;
/** Routine and speculative headlines: lists of movers, previews, explainers, "could" and "might". */
const ROUTINE = /\b(biggest (moves|analyst calls)|movers|to watch|things to know|what to know|what to expect|explained|explainer|preview|opinion|podcast|how to|stocks to buy|could|might|price prediction|top \d+|live updates?)\b|\?$|\s[–-]\s?(ing|mufg|commerzbank|uob|bbh|rabobank|scotiabank|ocbc|danske|socgen|nomura|ubs|bofa|citi|goldman sachs|morgan stanley|hsbc|natwest|dbs|maybank)\s*$/i;

const TOPICS: Topic[] = [
  // Central banks: a decision moves every market; anything else said about rates, less.
  { re: CENTRAL_BANK, and: /\b(raises?|raised|hikes?|hiked|cuts?|lowers?|lowered|holds?|keeps?|leaves?|pauses?|paused)\b.{0,40}\b(rates?|interest)\b|\brate decision\b|\b(emergency|surprise) (rate|meeting|cut|hike)\b|\bbasis points?\b/i, markets: ALL, score: 3, reason: "keputusan suku bunga" },
  { re: CENTRAL_BANK, and: /\b(rates?|hike|cut|minutes|hawkish|dovish|tighten\w*|easing|inflation)\b/i, markets: ["forex"], score: 2, reason: "bank sentral" },
  { re: /\b(powell|lagarde|ueda|bailey|warsh)\b/i, and: /\b(rates?|inflation|cut|hike|signals?|warns?|policy)\b/i, markets: ALL, score: 2, reason: "pejabat bank sentral" },
  // Data that moves rates; a surprise moves more.
  { re: /\b(cpi|consumer prices|inflation (rate|data|report)|pce|nonfarm|non-farm|payrolls|jobs report|unemployment rate|gdp)\b/i, and: /\b(rises?|rose|falls?|fell|jumps?|jumped|slows?|slowed|accelerat\w*|cools?|cooled|hotter|cooler|beats?|miss(es|ed)?|tops?|expected|unexpected\w*|surges?|shrinks?|contracts?)\b/i, markets: ALL, score: 3, reason: "data inflasi / tenaga kerja / GDP" },
  // Currencies.
  { re: FX, and: /\b(intervention|intervene[sd]?|devalu\w*|de-?peg\w*|record (low|high)|weakest|strongest|crisis|collapse[sd]?|plunges?|plummets?|soars?)\b/i, markets: ["forex"], score: 3, reason: "pergerakan mata uang" },
  // Trade, war and the public purse.
  { re: /\b(tariffs?|trade war|export (ban|controls?))\b/i, and: /\b(impose[sd]?|imposes|raises?|hikes?|announce[sd]?|slaps?|retaliat\w*|threatens?|escalat\w*|\d+\s?%)\b/i, markets: ALL, score: 3, reason: "tarif / perang dagang" },
  { re: /\b(war|invasion|invades?|missiles?|airstrikes?|nuclear (strike|weapons?|test|attack|sites?)|ceasefire|attacks? on)\b/i, markets: ALL, score: 2, reason: "geopolitik" },
  { re: /\b(government shutdown|debt ceiling|sovereign default|credit rating downgrade|downgrades? .{0,20}(credit|sovereign) rating)\b/i, markets: ALL, score: 3, reason: "risiko fiskal" },
  // Crypto.
  { re: CRYPTO, and: /\b(etfs? (approv\w*|reject\w*|inflows?|outflows?)|sec (sues|charges|approves|rejects|drops)|hack(ed|s)?|exploit(ed)?|stolen|drained|liquidat\w*|ban(s|ned)?|strategic (bitcoin )?reserve|executive order|delist\w*|insolven\w*|bankrupt\w*|de-?peg\w*|halving)\b/i, markets: ["crypto"], score: 3, reason: "peristiwa crypto (regulasi/ETF/hack/likuidasi)" },
  { re: CRYPTO, and: INTENSITY, markets: ["crypto"], score: 2, reason: "pergerakan crypto" },
  { re: /\b(strategy|microstrategy|saylor|blackrock|ibit|spot bitcoin etfs?)\b/i, and: /\b(buys?|bought|acquires?|sells?|sold|inflows?|outflows?)\b/i, markets: ["crypto"], score: 2, reason: "aliran dana institusi crypto" },
  // Stocks.
  { re: INDICES, and: INTENSITY, markets: ["stocks"], score: 3, reason: "pergerakan indeks saham" },
  { re: MEGACAPS, and: /\b(earnings|results|revenue|guidance|forecast|outlook|antitrust|shares (jump|soar|surge|plunge|tumble|sink|fall|drop|slide)s?)\b/i, markets: ["stocks"], score: 2, reason: "saham berkapitalisasi besar" },
  { re: /\b(acquire[sd]?|acquisition|merger|takeover|buyout)\b/i, and: BIG_MONEY, markets: ["stocks"], score: 2, reason: "merger / akuisisi besar" },
  { re: /\b(bankrupt\w*|chapter 11|insolven\w*)\b/i, markets: ["stocks"], score: 2, reason: "kebangkrutan" },
  { re: /\b(bank (run|failure|collapse)|banking crisis|circuit breaker|trading (halt|suspended)|flash crash|market crash)\b/i, markets: ALL, score: 3, reason: "krisis pasar" },
  { re: /\b(oil|crude|brent|opec\+?)\b/i, and: /\b(output cut|cuts output|embargo|plunges?|soars?|spikes?|surges?|tumbles?|record)\b/i, markets: ["stocks", "forex"], score: 2, reason: "minyak" },
];

/** How much a headline is likely to move crypto, stocks or currencies, if at all. */
export function newsImpact(title: string): NewsImpact {
  let score = 0;
  const markets = new Set<Market>();
  const reasons: string[] = [];
  for (const t of TOPICS) {
    if (!t.re.test(title) || (t.and && !t.and.test(title))) continue;
    score = Math.max(score, t.score);
    for (const m of t.markets) markets.add(m);
    if (!reasons.includes(t.reason)) reasons.push(t.reason);
  }
  if (!markets.size) return null;
  // Size or surprise makes it bigger; a list of movers, a preview or a "could" smaller.
  if (INTENSITY.test(title) || BIG_PERCENT.test(title) || BIG_MONEY.test(title)) score += 1;
  if (ROUTINE.test(title)) score -= 2;
  if (score < 2) return null;
  const order: Market[] = ["crypto", "stocks", "forex"];
  return { level: score >= 3 ? "high" : "medium", score, markets: order.filter((m) => markets.has(m)), reasons };
}

export const MARKET_LABEL: Record<Market, string> = { crypto: "CRYPTO", stocks: "SAHAM", forex: "FOREX" };
