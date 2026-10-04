// The economic calendar's filters: which countries (Forex Factory lists each event under its
// currency) and which impacts to show. Countries are kept as the ones hidden, so a currency the
// feed starts listing shows until it's turned off. Codes are compared upper-case (the feed writes
// "All" for global events).

export type Impact = "High" | "Medium" | "Low" | "Holiday";

export const IMPACTS: Array<{ id: Impact; label: string; cls: string }> = [
  { id: "High", label: "HIGH", cls: "down" },
  { id: "Medium", label: "MED", cls: "amber" },
  { id: "Low", label: "LOW", cls: "text-[#e8c547]" },
  { id: "Holiday", label: "HOLIDAY", cls: "dim" },
];

/** Forex Factory's currencies, in its order, with the economy each stands for. */
export const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "USD", name: "United States" },
  { code: "EUR", name: "Euro Area" },
  { code: "GBP", name: "United Kingdom" },
  { code: "JPY", name: "Japan" },
  { code: "AUD", name: "Australia" },
  { code: "NZD", name: "New Zealand" },
  { code: "CAD", name: "Canada" },
  { code: "CHF", name: "Switzerland" },
  { code: "CNY", name: "China" },
  { code: "ALL", name: "All (global)" },
];

/** The known countries, then any others in the events, each once. */
export function countriesOf(events: Array<{ country: string }>): Array<{ code: string; name: string }> {
  const known = new Set(COUNTRIES.map((c) => c.code));
  const extra = [...new Set(events.map((e) => countryOf(e.country)).filter((c) => c && !known.has(c)))].sort();
  return [...COUNTRIES, ...extra.map((code) => ({ code, name: code }))];
}

export const countryOf = (country: string) => country.toUpperCase();

/** An impact the feed doesn't name counts as Low. */
export const impactOf = (impact: string): Impact => (impact === "High" || impact === "Medium" || impact === "Holiday" ? impact : "Low");

export function filterEvents<E extends { country: string; impact: string }>(events: E[], impacts: Impact[], hiddenCountries: string[]): E[] {
  const show = new Set(impacts);
  const hidden = new Set(hiddenCountries);
  return events.filter((e) => show.has(impactOf(e.impact)) && !hidden.has(countryOf(e.country)));
}
