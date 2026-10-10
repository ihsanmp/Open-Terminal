// Watched Ethereum wallets (whales, exchanges, bridges): their transfers of ETH or of a token,
// from Blockscout's free Etherscan-style API (eth.blockscout.com, no key), named. The list below
// is checked against the chain (each address in use, ENS where it has one); more can be added
// in data/watched-wallets.json as [{ "address": "0x…", "name": "…", "kind": "…" }].
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../db.js";

export type WalletKind = "individual" | "exchange" | "bridge" | "fund";
export type Watched = { address: string; name: string; kind: WalletKind };

export const WATCHED: Watched[] = [
  { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", name: "Vitalik Buterin (vitalik.eth)", kind: "individual" },
  // Listed elsewhere as 0x3DdfA803…d150, an address never used; this is the one in use.
  { address: "0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296", name: "Justin Sun", kind: "individual" },
  { address: "0x28C6c06298d514Db089934071355E5743bf21d60", name: "Binance (Hot Wallet 1)", kind: "exchange" },
  { address: "0xF977814e90dA44bFA03b6295A0616a897441aceC", name: "Binance (Cold Storage)", kind: "exchange" },
  // Arbitrum's SequencerInbox (listed elsewhere as 0x1c471B2E…27E6, an address never used).
  { address: "0x1c479675ad559DC151F6Ec7ed3FbF8ceE79582B6", name: "Arbitrum Sequencer Inbox", kind: "bridge" },
];

const API = "https://eth.blockscout.com/api";

/** The built-in list and the user's own, each address once (the user's name wins). */
export function watchedWallets(): Watched[] {
  const byAddress = new Map(WATCHED.map((w) => [w.address.toLowerCase(), w]));
  const file = join(dataDir, "watched-wallets.json");
  try {
    if (existsSync(file)) {
      for (const w of JSON.parse(readFileSync(file, "utf8")) as Watched[]) {
        if (/^0x[0-9a-fA-F]{40}$/.test(w.address) && w.name) byAddress.set(w.address.toLowerCase(), { ...w, kind: w.kind ?? "individual" });
      }
    }
  } catch {
    // the built-in list alone
  }
  return [...byAddress.values()];
}

export type EvmTransfer = { hash: string; time: number; from: string; to: string; amount: number; symbol: string; contract: string | null };

type RawTx = { hash: string; timeStamp: string; from: string; to: string; value: string; isError?: string };
type RawTokenTx = RawTx & { tokenSymbol: string; tokenDecimal: string; contractAddress: string };

/** An Etherscan-style list's rows as transfers (native ETH, or a token in its own units). */
export function toTransfers(rows: Array<RawTx | RawTokenTx>): EvmTransfer[] {
  const out: EvmTransfer[] = [];
  for (const r of rows) {
    if (r.isError === "1") continue;
    const token = "tokenSymbol" in r;
    const decimals = token ? Number(r.tokenDecimal) || 0 : 18;
    const amount = Number(r.value) / 10 ** decimals;
    if (!(amount > 0)) continue;
    out.push({
      hash: r.hash,
      time: Number(r.timeStamp),
      from: r.from.toLowerCase(),
      to: (r.to ?? "").toLowerCase(),
      amount,
      symbol: token ? r.tokenSymbol.toUpperCase() : "ETH",
      contract: token ? r.contractAddress.toLowerCase() : null,
    });
  }
  return out;
}

const cache = new Map<string, { at: number; rows: EvmTransfer[] }>();

async function list(action: "txlist" | "tokentx", address: string, contract?: string): Promise<EvmTransfer[]> {
  const key = `${action}:${address}:${contract ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return hit.rows;
  const q = new URLSearchParams({ module: "account", action, address, sort: "desc", page: "1", offset: "100" });
  if (contract) q.set("contractaddress", contract);
  const res = await fetch(`${API}?${q}`, { headers: { "User-Agent": "OpenTerminal" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`blockscout ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  const rows = Array.isArray(body.result) ? toTransfers(body.result as RawTx[]) : [];
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

const tokens = new Map<string, string | null>();
/** A token's contract on Ethereum by its symbol: the most held of that exact symbol (look-alike
 *  tokens reusing a symbol are left out). */
export async function tokenContract(symbol: string): Promise<string | null> {
  const s = symbol.toUpperCase();
  if (tokens.has(s)) return tokens.get(s)!;
  const res = await fetch(`https://eth.blockscout.com/api/v2/tokens?q=${encodeURIComponent(s)}&type=ERC-20`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`blockscout ${res.status}`);
  const body = (await res.json()) as { items?: Array<{ symbol: string | null; address_hash: string; holders_count: string | null }> };
  const best = (body.items ?? [])
    .filter((t) => (t.symbol ?? "").toUpperCase() === s)
    .sort((a, b) => Number(b.holders_count ?? 0) - Number(a.holders_count ?? 0))[0];
  const address = best ? best.address_hash.toLowerCase() : null;
  tokens.set(s, address);
  return address;
}

type WhaleResult = { wallets: Watched[]; transfers: EvmTransfer[] };
const results = new Map<string, { at: number; data: WhaleResult }>();
const reading = new Map<string, Promise<WhaleResult>>();

/**
 * The watched wallets' transfers of a coin, without holding the page up: Blockscout takes up to
 * half a minute for a token's, so the last read is given at once and a new one started when it's
 * two minutes old; the first time it's waited for a few seconds, then shown when it's in.
 */
export async function whaleTransfers(symbol: string, waitMs = 4000): Promise<WhaleResult> {
  const s = symbol.toUpperCase();
  const have = results.get(s);
  if (!reading.has(s) && (!have || Date.now() - have.at > 120_000)) {
    const p = readWhales(s)
      .then((data) => {
        results.set(s, { at: Date.now(), data });
        return data;
      })
      .finally(() => reading.delete(s));
    reading.set(s, p);
  }
  if (have) return have.data;
  const timeout = new Promise<WhaleResult>((r) => setTimeout(() => r({ wallets: watchedWallets(), transfers: [] }), waitMs));
  return Promise.race([reading.get(s)!.catch(() => ({ wallets: watchedWallets(), transfers: [] })), timeout]);
}

/** The watched wallets' transfers of a coin (ETH itself, or an ERC-20 by symbol), newest first. */
async function readWhales(symbol: string): Promise<WhaleResult> {
  const wallets = watchedWallets();
  const s = symbol.toUpperCase();
  const contract = s === "ETH" ? null : await tokenContract(s);
  if (s !== "ETH" && !contract) return { wallets, transfers: [] };
  const lists = await Promise.all(
    wallets.map((w) => (contract ? list("tokentx", w.address, contract) : list("txlist", w.address)).catch(() => [] as EvmTransfer[]))
  );
  const seen = new Set<string>();
  const transfers: EvmTransfer[] = [];
  for (const t of lists.flat()) {
    const key = `${t.hash}:${t.from}:${t.to}:${t.amount}`;
    if (seen.has(key) || (contract && t.contract !== contract)) continue;
    seen.add(key);
    transfers.push(t);
  }
  return { wallets, transfers: transfers.sort((a, b) => b.time - a.time) };
}
