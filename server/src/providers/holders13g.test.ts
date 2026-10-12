import { describe, expect, it } from "vitest";
import { filerOf, holderChanges, holderKey, parseText13g, parseXml13g, subjectOf, type HolderFiling } from "./holders13g.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?><edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g" xmlns:com="http://www.sec.gov/edgar/common">
<formData><coverPageHeader><eventDateRequiresFilingThisStatement>03/13/2026</eventDateRequiresFilingThisStatement>
<issuerInfo><issuerCik>0000320193</issuerCik><issuerName>Apple Inc</issuerName></issuerInfo></coverPageHeader>
<coverPageHeaderReportingPersonDetails><reportingPersonName>The Vanguard Group</reportingPersonName>
<reportingPersonBeneficiallyOwnedAggregateNumberOfShares>1415826462</reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
<classPercent>9.47</classPercent><comments>On January 12, 2026, The Vanguard Group went through an internal realignment.</comments>
</coverPageHeaderReportingPersonDetails></formData></edgarSubmission>`;

describe("big holders' stakes from Schedule 13G / 13D", () => {
  it("reads the XML schedule", () => {
    expect(parseXml13g(XML)).toEqual({
      holder: "The Vanguard Group", shares: 1_415_826_462, percent: 9.47, realignment: true, event: Date.UTC(2026, 2, 13) / 1000, issuer: 320193,
    });
  });

  it("reads the older text and HTML schedules", () => {
    expect(parseText13g("(9) Aggregate amount beneficially owned by each reporting person\n\n 1043713019\n (11) Percent of class represented by amount in Row 9\n\n 6.7%")).toEqual({ shares: 1_043_713_019, percent: 6.7 });
    expect(parseText13g("Item 4. Ownership (a) Amount Beneficially Owned: 998,190,803 (b) Percent of Class: 4.069%")).toEqual({ shares: 998_190_803, percent: 4.069 });
    expect(parseText13g("<td>AGGREGATE AMOUNT BENEFICIALLY OWNED</td><td>&nbsp;915,560,382</td><td>PERCENT OF CLASS</td><td>5.8%</td>")).toEqual({ shares: 915_560_382, percent: 5.8 });
  });

  it("reads who filed and about whom from the header", () => {
    const h = "SUBJECT COMPANY:\n\tCOMPANY DATA:\n\t\tCOMPANY CONFORMED NAME:\t\t\tApple Inc.\n\t\tCENTRAL INDEX KEY:\t\t\t0000320193\nFILED BY:\n\tCOMPANY DATA:\n\t\tCOMPANY CONFORMED NAME:\t\t\tBlackRock Inc.\n";
    expect(filerOf(h)).toBe("BlackRock Inc.");
    expect(subjectOf(h)).toBe(320193);
    expect(holderKey("VANGUARD GROUP INC")).toBe(holderKey("The Vanguard Group"));
  });

  it("counts a holder's change across a stock split from the percent held", () => {
    const f = (holder: string, time: number, shares: number, percent: number | null): HolderFiling => ({ accession: `${holder}${time}`, holder, shares, percent, time, form: "SC 13G/A", url: "", realignment: false });
    const out = holderChanges([
      f("FMR LLC", 1, 127_855_229, 5.176),
      f("BlackRock Inc.", 2, 100, null),
      f("FMR LLC", 3, 998_190_803, 4.069), // after a 10-for-1 split: fewer, not more
      f("BlackRock Inc.", 4, 120, null),
      f("BlackRock Inc.", 5, 1200, null), // tenfold with no percent: a split, not a buy
    ]);
    expect(out.map((o) => o.change)).toEqual([null, null, Math.round(998_190_803 * (1 - 5.176 / 4.069)), 20, null]);
    expect(out[2].change!).toBeLessThan(0);
  });
});
