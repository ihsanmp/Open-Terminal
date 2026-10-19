// The fact-check's test seed: sentences labelled by hand with the claims they make (or that they
// make none), each said on a day. The Fed's from its press conferences (the chair's words, public
// record), the rest as business television says them. Every change to the reading must keep every
// one of these as labelled (factcheck.seed.test.ts); a sentence it gets wrong goes in here first.

export type SeedCase = {
  /** When it was said (claims name months relative to it). */
  asOf: string;
  text: string;
  /** [measure, figure, month or null] for each claim, in the order said; [] when it makes none. */
  claims: Array<[string, number, string | null]>;
};

export const SEED_CASES: SeedCase[] = [
  // ---------------------------------------------------------------- inflation
  { asOf: "2024-05-01", text: "Total PCE prices rose 2.7 percent over the 12 months ending in March.", claims: [["pce", 2.7, "2024-03"]] },
  { asOf: "2024-05-01", text: "Excluding the volatile food and energy categories, core PCE prices rose 2.8 percent.", claims: [["core_pce", 2.8, null]] },
  { asOf: "2022-12-14", text: "In November, the 12-month change in the CPI was 7.1 percent.", claims: [["cpi", 7.1, "2022-11"]] },
  { asOf: "2024-06-12", text: "The CPI rose 3.3 percent over the 12 months ending in May, and the core CPI rose 3.4 percent.", claims: [["cpi", 3.3, "2024-05"], ["core_cpi", 3.4, "2024-05"]] },
  { asOf: "2016-06-15", text: "Core inflation, which excludes energy and food prices, has been running close to 1.5 percent.", claims: [["inflation", 1.5, null]] },
  { asOf: "2022-11-02", text: "We have a strong economy, and we have an economy where inflation is running at 5 percent.", claims: [["inflation", 5, null]] },
  { asOf: "2017-09-20", text: "The 12-month change in the price index for personal consumption expenditures was 1.4 percent in July.", claims: [["pce", 1.4, "2017-07"]] },

  // ---------------------------------------------------------------- jobs
  { asOf: "2018-09-26", text: "The unemployment rate stood at 3.9 percent in August.", claims: [["unemployment", 3.9, "2018-08"]] },
  { asOf: "2023-12-13", text: "The unemployment rate remains low at 3.7 percent.", claims: [["unemployment", 3.7, null]] },
  { asOf: "2025-09-17", text: "The unemployment rate edged up to 4.3 percent in August.", claims: [["unemployment", 4.3, "2025-08"]] },
  { asOf: "2024-12-18", text: "Payroll job gains have slowed from earlier in the year, averaging 173,000 a month over the past three months.", claims: [["payrolls_avg", 173, null]] },
  { asOf: "2025-09-17", text: "Payroll job gains have slowed significantly to a pace of just 29,000 per month over the last three months.", claims: [["payrolls_avg", 29, null]] },
  { asOf: "2016-03-16", text: "Over the most recent three months, job gains averaged nearly 230,000 per month.", claims: [["payrolls_avg", 230, null]] },

  // ---------------------------------------------------------------- growth
  { asOf: "2020-11-05", text: "Real GDP rose at an annual rate of 33 percent in the third quarter.", claims: [["gdp", 33, "2020-07"]] },

  // ---------------------------------------------------------------- the Fed's rate and record
  { asOf: "2018-06-13", text: "The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point, bringing it to 1-3/4 to 2 percent.", claims: [["fed_funds", 1.75, null]] },
  { asOf: "2025-12-10", text: "We decided to lower our policy rate by 1/4 percentage point to a range of 3-1/2 to 3-3/4 percent.", claims: [["fed_funds", 3.5, null]] },
  { asOf: "2024-09-18", text: "This is the first rate cut since March 2020.", claims: [["first_since", -1, "2020-03"]] },
  { asOf: "2024-12-18", text: "This is our third consecutive rate cut.", claims: [["cuts_count", 3, null]] },
  { asOf: "2025-12-10", text: "We have cut rates three times this year.", claims: [["cuts_count", 3, "2025-01"]] },
  { asOf: "2026-08-01", text: "Rates have been unchanged since December.", claims: [["unchanged_since", 0, "2025-12"]] },
  { asOf: "2023-07-26", text: "We've raised the federal funds rate now by 525 basis points since March.", claims: [["rate_change", 5.25, "2023-03"]] },
  { asOf: "2026-09-16", text: "This is the first hike since 2023.", claims: [["first_since", 1, "2023"]] },

  // ---------------------------------------------------------------- the releases, as television says them
  { asOf: "2026-10-20", text: "Consumer prices rose 0.6 percent in September.", claims: [["cpi_mom", 0.6, "2026-09"]] },
  { asOf: "2026-10-20", text: "Retail sales rose 0.8% in September.", claims: [["retail_sales", 0.8, "2026-09"]] },
  { asOf: "2026-10-20", text: "Initial jobless claims fell to 199,000.", claims: [["jobless_claims", 199, null]] },
  { asOf: "2026-10-20", text: "The ISM manufacturing index came in at 54.5.", claims: [["ism_mfg", 54.5, null]] },
  { asOf: "2026-10-20", text: "Job openings slipped to 7.1 million in August.", claims: [["job_openings", 7.1, "2026-08"]] },
  { asOf: "2026-10-20", text: "Producer prices jumped 1.3 percent in September.", claims: [["ppi_mom", 1.3, "2026-09"]] },
  { asOf: "2026-10-20", text: "Average hourly earnings rose 3.8 percent over the past year.", claims: [["wages", 3.8, null]] },
  { asOf: "2026-10-20", text: "The 30-year mortgage rate is 6.3 percent.", claims: [["mortgage", 6.3, null]] },
  { asOf: "2026-10-20", text: "Continuing claims rose to 1.71 million.", claims: [["continuing_claims", 1710, null]] },

  // ---------------------------------------------------------------- the markets
  { asOf: "2026-10-20", text: "The 10-year Treasury yield is at 4.1 percent.", claims: [["yield_10y", 4.1, null]] },
  { asOf: "2026-10-20", text: "The S&P 500 closed at 6,700.", claims: [["spx", 6700, null]] },
  { asOf: "2026-10-20", text: "Oil is trading at $61 a barrel.", claims: [["oil", 61, null]] },
  { asOf: "2026-10-20", text: "Gold hit $4,000 an ounce.", claims: [["gold", 4000, null]] },
  { asOf: "2026-10-20", text: "Bitcoin is at $108,000.", claims: [["bitcoin", 108000, null]] },
  { asOf: "2026-10-20", text: "The dollar index is at 99.5.", claims: [["dxy", 99.5, null]] },

  // ---------------------------------------------------------------- none: goals, forecasts, comparisons, other times and places
  { asOf: "2025-09-17", text: "Inflation remains somewhat elevated relative to our 2 percent longer-run goal.", claims: [] },
  { asOf: "2020-09-16", text: "We want inflation to return to 2 percent over time.", claims: [] },
  { asOf: "2016-06-15", text: "Participants project the unemployment rate at 4.5 percent at the end of this year.", claims: [] },
  { asOf: "2017-06-14", text: "Inflation has been running below 2 percent for some time.", claims: [] },
  { asOf: "2018-12-19", text: "Last December, the unemployment rate was 4.1 percent.", claims: [] },
  { asOf: "2022-06-15", text: "Lots of countries are looking at inflation of 10 percent.", claims: [] },
  { asOf: "2022-03-16", text: "So why does unemployment remain at 3.5 percent?", claims: [] },
  { asOf: "2024-01-31", text: "On a three-month basis, core PCE has been running at 1.5 percent.", claims: [] },
  { asOf: "2019-10-30", text: "Personal consumption expenditures were almost 3 percent in this quarter.", claims: [] },
  { asOf: "2025-10-29", text: "Our securities holdings have declined by more than $2 trillion.", claims: [] },
  { asOf: "2026-03-18", text: "They're not sitting there waiting for oil to go over $70.", claims: [] },
  { asOf: "2026-10-20", text: "Economists expect retail sales to rise 0.4 percent.", claims: [] },
  { asOf: "2026-10-20", text: "The 10-year average of the unemployment rate is 5.6 percent.", claims: [] },
  { asOf: "2022-06-15", text: "When unemployment was 14 percent, we acted forcefully.", claims: [] },
  { asOf: "2026-10-20", text: "We will cut rates twice this year.", claims: [] },
  { asOf: "2025-12-10", text: "The median projection for the federal funds rate is 3.4 percent at the end of 2026.", claims: [] },
  { asOf: "2024-09-18", text: "GDP rose at a pace of around 1.5 percent in the first half of the year.", claims: [] },
  { asOf: "2020-06-10", text: "Unemployment has risen about 10 percentage points since February.", claims: [] },
  { asOf: "2024-03-20", text: "Inflation expectations remain well anchored at around 2 percent.", claims: [] },
  { asOf: "2026-10-20", text: "The S&P 500 index rose 2 percent today.", claims: [] },
  { asOf: "2026-10-20", text: "If inflation were to rise to 4 percent, we would respond.", claims: [] },
  { asOf: "2024-09-18", text: "Participants expect the first cut since 2020 later this year.", claims: [] },
];
