export type DcfInputs = {
  freeCashFlow: number;
  growth: number; // annual FCF growth during the projection, as a fraction
  discountRate: number;
  terminalGrowth: number;
  years: number;
  netDebt: number;
  shares: number;
};

export type DcfResult = {
  flows: Array<{ year: number; fcf: number; presentValue: number }>;
  presentValueOfFlows: number;
  terminalValue: number;
  presentValueOfTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  perShare: number;
};

/** Two-stage free-cash-flow DCF with a Gordon-growth terminal value. Null when the model is undefined. */
export function discountedCashFlow(i: DcfInputs): DcfResult | null {
  const { freeCashFlow, growth, discountRate: r, terminalGrowth: g, netDebt, shares } = i;
  const years = Math.round(i.years);
  if (!(r > g) || years < 1 || !(shares > 0) || ![freeCashFlow, growth, r, g, netDebt].every(Number.isFinite)) return null;
  const flows: DcfResult["flows"] = [];
  let fcf = freeCashFlow;
  let presentValueOfFlows = 0;
  for (let year = 1; year <= years; year++) {
    fcf *= 1 + growth;
    const presentValue = fcf / Math.pow(1 + r, year);
    presentValueOfFlows += presentValue;
    flows.push({ year, fcf, presentValue });
  }
  const terminalValue = (fcf * (1 + g)) / (r - g);
  const presentValueOfTerminal = terminalValue / Math.pow(1 + r, years);
  const enterpriseValue = presentValueOfFlows + presentValueOfTerminal;
  const equityValue = enterpriseValue - netDebt;
  return { flows, presentValueOfFlows, terminalValue, presentValueOfTerminal, enterpriseValue, equityValue, perShare: equityValue / shares };
}
