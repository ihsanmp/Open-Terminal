// The quant forecaster's two models side by side, out of sample: the logistic regression the app
// uses (model.ts) and boosted trees (gbm.ts), each market and horizon by the same yearly
// walk-forward test from 2016. Run: npm run quant:compare (DATA_DIR set to a copy of the data).

import { engineInputs } from "../providers/macroengine.js";
import { astroFeatures } from "../quant/astrofeatures.js";
import { dailyCloses, MARKETS } from "../quant/data.js";
import { GBM_DEFAULTS, walkForwardGbm, type GbmParams } from "../quant/gbm.js";
import { macroFeatures } from "../quant/macrofeatures.js";
import { dataset, HORIZONS, walkForward, type Score } from "../quant/model.js";

const VARIANTS: Array<{ name: string; params: GbmParams }> = [
  { name: "gbm d2", params: GBM_DEFAULTS },
  { name: "gbm d3", params: { ...GBM_DEFAULTS, depth: 3, minChild: 80 } },
];

const fmt = (s: Score) => `acc ${(s.acc * 100).toFixed(1)} base ${(s.baseAcc * 100).toFixed(1)} z ${s.z.toFixed(2).padStart(5)} bss ${(s.bss * 100).toFixed(2).padStart(6)}%${s.proven ? " ✓" : ""}`;

async function main() {
  const closes = await dailyCloses(365 * 86_400_000);
  const allDays = MARKETS.flatMap((m) => closes[m.key].days);
  const from = Math.min(...allDays);
  const to = Math.max(...allDays);
  const releases = await engineInputs().then((i) => i.releases).catch(() => []);
  const macro = macroFeatures(releases, from, to);
  const astro = astroFeatures(from, to);
  const totals: Record<string, { bss: number; better: number; proven: number; n: number }> = {};
  const add = (k: string, s: Score, lr: Score) => {
    const t = (totals[k] ??= { bss: 0, better: 0, proven: 0, n: 0 });
    t.bss += s.bss;
    t.n++;
    if (s.proven) t.proven++;
    if (s.bss > lr.bss) t.better++;
  };
  for (const m of MARKETS.filter((x) => x.forecast)) {
    const ds = dataset(m.key, closes, macro, astro);
    if (ds.rows.length < 1000) continue;
    for (const h of HORIZONS) {
      const t0 = Date.now();
      const lr = (await walkForward(ds, h, "all")).score;
      add("logistic", lr, lr);
      console.log(`${m.key.padEnd(7)} ${String(h).padStart(2)}d  logistic  ${fmt(lr)}`);
      for (const v of VARIANTS) {
        const g = await walkForwardGbm(ds, h, "all", v.params);
        add(v.name, g.score, lr);
        console.log(`${m.key.padEnd(7)} ${String(h).padStart(2)}d  ${v.name.padEnd(8)}  ${fmt(g.score)}  trees/yr ${g.rounds.join(",")}`);
      }
      console.log(`         (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
  console.log("\nSummary (mean Brier skill vs the base-rate bet; proven = z ≥ 1.64 and BSS > 0):");
  for (const [k, t] of Object.entries(totals))
    console.log(`  ${k.padEnd(9)} mean BSS ${((t.bss / t.n) * 100).toFixed(2)}%  proven ${t.proven}/${t.n}${k === "logistic" ? "" : `  better BSS than logistic ${t.better}/${t.n}`}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
