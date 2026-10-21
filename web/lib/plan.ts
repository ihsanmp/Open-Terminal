// The Nodes Plan's arithmetic: a trade plan's risk per unit, reward-to-risk for each target, the
// position size for a given account and risk, and where the live price stands against the plan.

export type Direction = "long" | "short";
export type PlanStatus = "ide" | "menunggu" | "aktif" | "selesai" | "batal";

export type Plan = {
  id: string;
  symbol: string;
  direction: Direction;
  title: string;
  status: PlanStatus;
  timeframe: string;
  createdAt: number;
  updatedAt: number;
  /** 1 Tesis */
  thesis: string;
  /** 2 Konteks & katalis: the regime, positioning, events ahead. */
  context: string;
  checks: Record<string, boolean>;
  /** 3 Pemicu: what has to happen before entering. */
  trigger: string;
  /** 4 Eksekusi */
  entry: number | null;
  stop: number | null;
  targets: Array<number | null>;
  /** 5 Risiko */
  account: number | null;
  riskPct: number | null;
  invalidation: string;
  /** 6 Review */
  exit: number | null;
  review: string;
};

export const CHECKS: Array<[string, string]> = [
  ["regime", "Searah dengan regime makro / bias aset"],
  ["trend", "Searah tren (harga vs rata-rata 50/200 hari)"],
  ["catalyst", "Tahu katalis/rilis besar sebelum target"],
  ["positioning", "Posisi pasar (COT) tidak penuh di sisi saya"],
  ["breadth", "Breadth/arus dana mengonfirmasi"],
  ["rr", "Reward-to-risk target pertama ≥ 2"],
];

export function emptyPlan(id: string, symbol: string, now = Date.now()): Plan {
  return {
    id, symbol, direction: "long", title: "", status: "ide", timeframe: "Swing (hari–minggu)", createdAt: now, updatedAt: now,
    thesis: "", context: "", checks: {}, trigger: "", entry: null, stop: null, targets: [null, null, null], account: null, riskPct: 1, invalidation: "", exit: null, review: "",
  };
}

/** The price distance risked per unit (entry to stop), or null when the stop is on the wrong side. */
export function riskPerUnit(p: Pick<Plan, "direction" | "entry" | "stop">): number | null {
  if (p.entry == null || p.stop == null) return null;
  const r = p.direction === "long" ? p.entry - p.stop : p.stop - p.entry;
  return r > 0 ? r : null;
}

/** Reward over risk for a target (2 = twice what's risked), or null. */
export function rewardRisk(p: Pick<Plan, "direction" | "entry" | "stop">, target: number | null): number | null {
  const risk = riskPerUnit(p);
  if (risk == null || target == null || p.entry == null) return null;
  const reward = p.direction === "long" ? target - p.entry : p.entry - target;
  return reward / risk;
}

/** Units to buy/sell so that being stopped out loses `riskPct` of the account. */
export function positionSize(p: Pick<Plan, "direction" | "entry" | "stop" | "account" | "riskPct">): { units: number; riskAmount: number; notional: number } | null {
  const risk = riskPerUnit(p);
  if (risk == null || p.account == null || p.riskPct == null || p.account <= 0 || p.riskPct <= 0 || p.entry == null) return null;
  const riskAmount = (p.account * p.riskPct) / 100;
  const units = riskAmount / risk;
  return { units, riskAmount, notional: units * p.entry };
}

/** The result in R (multiples of the risk) for an exit price. */
export function resultR(p: Pick<Plan, "direction" | "entry" | "stop">, exit: number | null): number | null {
  return rewardRisk(p, exit);
}

export type Live = { where: "sebelum-entry" | "di-zona-entry" | "berjalan" | "kena-stop" | "kena-target"; r: number | null; text: string };

/** Where the price is against the plan: before entry, around it, running (in R), stopped or at a target. */
export function liveState(p: Pick<Plan, "direction" | "entry" | "stop" | "targets">, price: number | null): Live | null {
  if (price == null || p.entry == null) return null;
  const sign = p.direction === "long" ? 1 : -1;
  const r = rewardRisk(p, price);
  const best = p.targets.filter((t): t is number => t != null).sort((a, b) => sign * (a - b))[0];
  if (p.stop != null && sign * (price - p.stop) <= 0) return { where: "kena-stop", r, text: "Harga sudah melewati stop: rencana batal/terkena stop." };
  if (best != null && sign * (price - best) >= 0) return { where: "kena-target", r, text: "Harga sudah mencapai target pertama." };
  const dist = ((price - p.entry) / p.entry) * 100;
  if (Math.abs(dist) <= 0.3) return { where: "di-zona-entry", r, text: "Harga di sekitar level entry (±0,3%)." };
  if (sign * dist < 0) return { where: "sebelum-entry", r, text: `Harga ${Math.abs(dist).toFixed(2)}% ${p.direction === "long" ? "di bawah" : "di atas"} entry.` };
  return { where: "berjalan", r, text: r != null ? `Bila sudah masuk di entry: ${r >= 0 ? "+" : ""}${r.toFixed(2)} R.` : "Harga sudah melewati entry." };
}

/** How many of the six nodes are filled in. */
export function nodesDone(p: Plan): boolean[] {
  return [
    p.thesis.trim().length > 0,
    p.context.trim().length > 0 || Object.values(p.checks).some(Boolean),
    p.trigger.trim().length > 0,
    p.entry != null && p.stop != null && p.targets.some((t) => t != null),
    p.account != null && p.riskPct != null && p.invalidation.trim().length > 0,
    p.exit != null || p.review.trim().length > 0,
  ];
}
