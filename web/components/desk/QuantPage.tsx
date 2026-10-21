"use client";

import { useWidgetSetting } from "../../store/terminal";
import { usePairContext } from "../../lib/pair";
import PairBanner from "./PairBanner";
import QuantPanel from "../widgets/QuantPanel";
import EnginePanel from "../widgets/EnginePanel";
import NowcastPanel from "../widgets/NowcastPanel";
import ImpactPanel from "../widgets/ImpactPanel";
import ReactionsPanel from "../widgets/ReactionsPanel";
import RegressionPanel from "./RegressionPanel";

// Quantitative: the app's models in one place, full width — the asset forecaster (walk-forward
// tested, with its record), the macro release engine and the inflation/GDP nowcasts, how markets
// moved on past news, and how they moved on past Fed broadcasts. The same panels the Live TV page
// keeps beside the broadcast.

const TABS: Array<[string, string, string]> = [
  ["regression", "Regresi multifaktor", "Sensitivitas pair di Charting terhadap S&P 500, dolar, yield, VIX, emas, minyak, bitcoin."],
  ["quant", "Prakiraan aset", "Peluang naik 5/10/20 hari tiap aset, rentang wajar, rekam jejak walk-forward."],
  ["engine", "Engine rilis & nowcast", "P10/P50/P90 rilis makro AS berikutnya vs konsensus, nowcast inflasi dan GDP."],
  ["impact", "Dampak berita", "Seberapa besar pasar bergerak setelah jenis berita tertentu, terukur dari arsip."],
  ["reactions", "Reaksi siaran Fed", "Gerak pasar saat dan setelah konferensi pers/siaran Fed."],
];

export default function QuantPage() {
  const [tab, setTab] = useWidgetSetting<string>("quantTab", "regression");
  const current = TABS.find((t) => t[0] === tab) ?? TABS[0];
  const { symbol, ctx } = usePairContext();
  return (
    <div className="h-full flex flex-col min-h-0 text-fs-11">
      <div className="flex flex-wrap gap-1 p-1 items-center border-b border-[var(--border)]">
        {TABS.map(([id, label]) => (
          <button key={id} className={`term-btn ${current[0] === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span className="dim text-fs-10 ml-2">{current[2]}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-2 pt-2">
          <PairBanner symbol={symbol} ctx={ctx}>
            {ctx?.quantKey ? "barisnya ditandai ● dan dibuka di Prakiraan aset" : ctx ? "tidak dicakup model quant; aset terdekat bisa dilihat di tabel" : null}
          </PairBanner>
        </div>
        <div>
          {current[0] === "regression" && <RegressionPanel />}
          {current[0] === "quant" && <QuantPanel focus={ctx?.quantKey ?? null} />}
          {current[0] === "engine" && (
            <>
              <EnginePanel />
              <NowcastPanel />
            </>
          )}
          {current[0] === "impact" && <ImpactPanel />}
          {current[0] === "reactions" && <ReactionsPanel />}
        </div>
      </div>
    </div>
  );
}
