// The macro engine from a terminal, without the app (blueprint §5–6):
//
//   npm run engine -- --mode train                      fit every target, test it walk-forward, save the models
//   npm run engine -- --mode live [--target cpi_mom]    the next releases' P10/P50/P90 and their bias
//          [--consensus 0.3] [--fed_sentiment 0.8] [--set gas=7.3]
//   npm run engine -- --mode backtest                   the out-of-sample record, by target
//   npm run engine -- --mode reactions                  how markets moved on the surprises
//
// Data comes from the same sources as the app, kept in the same store (DATA_DIR, else ./data).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { dataDir } from "../db.js";
import { latestFedSentiment } from "../providers/fedtranscript.js";
import { backtest, engineInputs, ENGINE_PARAMS, rows, runEngine, TARGETS, type EngineRow, type Inputs } from "../providers/macroengine.js";
import { fitBand } from "../providers/quantgbm.js";
import { INSTRUMENTS, reactions } from "../providers/reactions.js";

const { values } = parseArgs({
  options: {
    mode: { type: "string" },
    target: { type: "string" },
    consensus: { type: "string" },
    fed_sentiment: { type: "string" },
    set: { type: "string", multiple: true },
    help: { type: "boolean", short: "h" },
  },
});

const USAGE = `Pemakaian: npm run engine -- --mode <train|live|backtest|reactions> [opsi]
  --target <key>          satu target saja: ${TARGETS.map((t) => t.key).join(", ")}
  --consensus <angka>     ganti konsensus rilis berikutnya (butuh --target)
  --fed_sentiment <-1..1> ganti sentimen Fed (default: bacaan terakhir dari siaran The Fed)
  --set <fitur>=<angka>   ganti input, mis. --set gas=7.3 --set gdpnow=1.2`;

const LINE = "=".repeat(57);
const RULE = "-".repeat(57);
const fmtv = (v: number, unit: string) => (unit === "K" ? `${Math.round(v)}K` : unit === "pt" ? v.toFixed(1) : `${v.toFixed(2)}%`);
const READING = {
  hawkish: { bias: "HAWKISH 🦅", xau: "turun (USD & yield naik)", crypto: "turun / tertekan" },
  dovish: { bias: "DOVISH 🕊", xau: "naik (USD & yield turun)", crypto: "naik / terdorong" },
  neutral: { bias: "NETRAL ⚖", xau: "tunggu (tidak jelas)", crypto: "tunggu (tidak jelas)" },
};

function printLive(r: EngineRow): void {
  const inputs = r.inputs.length ? r.inputs.map((i) => `${i.name} ${i.value ?? "-"}`).join(" | ") : "(tidak ada yang lolos uji; pita = sebaran kejutan historis)";
  const b = r.backtest;
  console.log(`\n${LINE}\n📊 MACRO NOWCASTING ENGINE · ${r.label} (${r.period})\n${LINE}`);
  console.log(`Rilis             : ${new Date(r.release).toLocaleString()}`);
  console.log(`Input             : ${inputs}`);
  console.log(`Konsensus Pasar   : ${fmtv(r.consensus, r.unit)}${r.previous !== null ? `   (sebelumnya ${fmtv(r.previous, r.unit)})` : ""}`);
  console.log(`Skor Sentimen Fed : ${r.sentiment ? `${r.sentiment.index.toFixed(2)} (skala -1..1), menggeser ${r.adjustment}` : "tidak ada (14 hari terakhir)"}`);
  console.log(RULE);
  console.log(`Prediksi Engine   : ${fmtv(r.adjusted, r.unit)}   (P50 model ${fmtv(r.p50, r.unit)})`);
  console.log(`Rentang P10–P90   : [${fmtv(r.p10, r.unit)}  -  ${fmtv(r.p90, r.unit)}]`);
  console.log(`Tingkat Keyakinan : ${r.confidence}%`);
  if (r.actual !== null) console.log(`Aktual            : ${fmtv(r.actual, r.unit)}`);
  console.log(RULE);
  console.log(`Bias Ekonomi      : ${READING[r.bias].bias}`);
  console.log(`Arah XAU/USD      : ${READING[r.bias].xau}`);
  console.log(`Arah Crypto       : ${READING[r.bias].crypto}`);
  console.log(`Rekam jejak       : ${b.months} rilis sejak ${b.from}: meleset ${b.maeEngine} vs konsensus ${b.maeConsensus}; P10–P90 memuat ${Math.round(b.coverage * 100)}%`);
  console.log(`${LINE}\n(Bacaan arah, bukan sinyal trading.)`);
}

/** The next release of a target with its consensus set by hand. */
function withConsensus(inputs: Inputs, key: string, value: number): Inputs {
  const t = TARGETS.find((x) => x.key === key);
  if (!t) throw new Error(`target tidak dikenal: ${key}`);
  const next = inputs.releases.find((e) => e.title === t.title && Date.parse(e.date) > Date.now() - 2 * 3_600_000);
  if (!next) throw new Error(`tidak ada rilis ${t.label} yang dijadwalkan`);
  return { ...inputs, releases: inputs.releases.map((e) => (e === next ? { ...e, forecast: value } : e)) };
}

async function trainOrTest(inputs: Inputs, train: boolean, targets: typeof TARGETS): Promise<void> {
  const models: Record<string, unknown> = {};
  console.log(`\n${"target".padEnd(16)} ${"rilis".padStart(5)} ${"meleset".padStart(9)} ${"konsensus".padStart(10)} ${"P10–P90".padStart(8)}  arah`);
  for (const t of targets) {
    const data = rows(t, inputs);
    const b = backtest(t, data);
    console.log(
      `${t.key.padEnd(16)} ${String(b.months).padStart(5)} ${String(b.maeEngine).padStart(9)} ${String(b.maeConsensus).padStart(10)} ${`${Math.round(b.coverage * 100)}%`.padStart(8)}  ${b.hits}/${b.calls}`,
    );
    if (train) {
      const band = fitBand(
        data.map((r) => r.x),
        data.map((r) => r.actual - r.consensus),
        ENGINE_PARAMS,
      );
      models[t.key] = { features: t.features.map((f) => f.name), params: ENGINE_PARAMS, rows: data.length, band };
    }
  }
  if (!train) return;
  const dir = join(dataDir, "macro-engine");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "models.json"), JSON.stringify({ trainedAt: new Date().toISOString(), models }));
  console.log(`\n[ENGINE] Training selesai. Model disimpan di ${join(dir, "models.json")}`);
  console.log("[ENGINE] (Mode live melatih ulang dari data terbaru setiap kali dijalankan; satu target < 1 detik.)");
}

async function main(): Promise<void> {
  if (values.help || !values.mode) {
    console.log(USAGE);
    return;
  }
  const targets = values.target ? TARGETS.filter((t) => t.key === values.target) : TARGETS;
  if (!targets.length) throw new Error(`target tidak dikenal: ${values.target}\n${USAGE}`);
  console.log("[ENGINE] Membaca data point-in-time (kalender sejak 2013, GDPNow, bensin)…");
  let inputs = await engineInputs();

  if (values.mode === "train" || values.mode === "backtest") return trainOrTest(inputs, values.mode === "train", targets);

  if (values.mode === "live") {
    if (values.consensus !== undefined) {
      if (!values.target) throw new Error("--consensus butuh --target");
      inputs = withConsensus(inputs, values.target, Number(values.consensus));
    }
    const overrides: Record<string, number> = {};
    for (const kv of values.set ?? []) {
      const [k, v] = kv.split("=");
      if (!k || !Number.isFinite(Number(v))) throw new Error(`--set harus nama=angka, bukan "${kv}"`);
      overrides[k] = Number(v);
    }
    const sentiment =
      values.fed_sentiment !== undefined
        ? { index: Math.max(-1, Math.min(1, Number(values.fed_sentiment))), at: new Date().toISOString(), title: "--fed_sentiment" }
        : latestFedSentiment();
    const e = runEngine(inputs, sentiment, Date.now(), overrides);
    const keys = new Set(targets.map((t) => t.key));
    for (const r of e.rows.filter((x) => keys.has(x.key)).sort((a, b) => a.release.localeCompare(b.release))) printLive(r);
    for (const w of e.waiting.filter((x) => keys.has(x.key))) console.log(`\n${w.label} (${w.period}), ${new Date(w.release).toLocaleString()}: menunggu konsensus.`);
    return;
  }

  if (values.mode === "reactions") {
    const r = await reactions(inputs);
    console.log("\nSeberapa sering pasar bergerak searah kejutan (~30 menit setelah rilis), % / jumlah rilis:");
    console.log(`${"target".padEnd(16)}${INSTRUMENTS.map((i) => i.label.padStart(13)).join("")}`);
    for (const s of r.summary.filter((x) => targets.some((t) => t.key === x.key))) {
      const cells = INSTRUMENTS.map((i) => {
        const c = s.surprise30[i.key];
        return (c.n ? `${Math.round((c.agree / c.n) * 100)}%/${c.n}` : "-").padStart(13);
      });
      console.log(`${s.key.padEnd(16)}${cells.join("")}`);
    }
    return;
  }
  console.log(USAGE);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
