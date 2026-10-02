import { describe, expect, it } from "vitest";
import { createWorkspaceStorage, mergeOrder, readWorkspace, WORKSPACE_KEY, type SavedWorkspace } from "./workspace-storage";

/** A localStorage both "windows" share. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

const tab = (id: string, activeSymbol: string) => ({ id, activeSymbol, view: "chart" });
const ws = (tabs: ReturnType<typeof tab>[], watchlist = ["AAPL"]): SavedWorkspace => ({ tabs, watchlist, favoriteIntervals: [] });
const save = (s: ReturnType<typeof createWorkspaceStorage>, w: SavedWorkspace) => s!.setItem(WORKSPACE_KEY, { state: w, version: 1 });
const load = (s: ReturnType<typeof createWorkspaceStorage>) => s!.getItem(WORKSPACE_KEY) as { state: SavedWorkspace } | null;
const symbols = (store: Storage) => readWorkspace(store)!.state.tabs.map((t) => `${t.id}:${t.activeSymbol}`);

describe("saving the workspace from several windows", () => {
  it("keeps both changes when two windows edit different tabs at the same moment", () => {
    const store = memoryStorage();
    const a = createWorkspaceStorage(store);
    const b = createWorkspaceStorage(store);
    save(a, ws([tab("t1", "AAPL"), tab("t2", "MSFT")]));
    const seenByA = load(a)!.state;
    const seenByB = load(b)!.state;
    // A changes t1 and B changes t2, each from its own (by now outdated) copy.
    save(a, { ...seenByA, tabs: [tab("t1", "BTC-USD"), seenByA.tabs[1] as ReturnType<typeof tab>] });
    save(b, { ...seenByB, tabs: [seenByB.tabs[0] as ReturnType<typeof tab>, tab("t2", "ETH-USD")] });
    expect(symbols(store)).toEqual(["t1:BTC-USD", "t2:ETH-USD"]);
  });

  it("keeps a tab another window opened, and a tab it closed stays closed", () => {
    const store = memoryStorage();
    const a = createWorkspaceStorage(store);
    const b = createWorkspaceStorage(store);
    save(a, ws([tab("t1", "AAPL"), tab("t2", "MSFT")]));
    load(b);
    // A opens t3 and closes t2; B, not yet updated, then changes t1.
    save(a, ws([tab("t1", "AAPL"), tab("t3", "NVDA")]));
    save(b, ws([tab("t1", "TSLA"), tab("t2", "MSFT")]));
    expect(symbols(store)).toEqual(["t1:TSLA", "t3:NVDA"]);
  });

  it("keeps the watchlist another window changed when this one didn't touch it", () => {
    const store = memoryStorage();
    const a = createWorkspaceStorage(store);
    const b = createWorkspaceStorage(store);
    save(a, ws([tab("t1", "AAPL")], ["AAPL"]));
    load(b);
    save(a, ws([tab("t1", "AAPL")], ["AAPL", "NVDA"]));
    save(b, ws([tab("t1", "SPY")], ["AAPL"]));
    expect(readWorkspace(store)!.state.watchlist).toEqual(["AAPL", "NVDA"]);
    expect(symbols(store)).toEqual(["t1:SPY"]);
  });

  it("reads the one-entry format (v1) and moves it to one entry per tab on the next save", () => {
    const store = memoryStorage();
    store.setItem(WORKSPACE_KEY, JSON.stringify({ state: ws([tab("t1", "AAPL"), tab("t2", "SOL-USD")]), version: 1 }));
    const s = createWorkspaceStorage(store);
    const loaded = load(s)!.state;
    expect(loaded.tabs.map((t) => t.activeSymbol)).toEqual(["AAPL", "SOL-USD"]);
    save(s, loaded);
    expect(JSON.parse(store.getItem(WORKSPACE_KEY)!).state).toMatchObject({ order: ["t1", "t2"], watchlist: ["AAPL"], favoriteIntervals: [] });
    expect(JSON.parse(store.getItem(`${WORKSPACE_KEY}:tab:t2`)!).activeSymbol).toBe("SOL-USD");
  });

  it("writes only what changed", () => {
    const store = memoryStorage();
    const s = createWorkspaceStorage(store);
    save(s, ws([tab("t1", "AAPL"), tab("t2", "MSFT")]));
    const writes: string[] = [];
    const set = store.setItem.bind(store);
    store.setItem = (k, v) => {
      writes.push(k);
      set(k, v);
    };
    save(s, ws([tab("t1", "AAPL"), tab("t2", "AMZN")]));
    // The changed tab, and the list's "last changed" time.
    expect(writes).toEqual([`${WORKSPACE_KEY}:tab:t2`, WORKSPACE_KEY]);
    // Nothing changed: nothing written.
    writes.length = 0;
    save(s, ws([tab("t1", "AAPL"), tab("t2", "AMZN")]));
    expect(writes).toEqual([]);
  });
});

describe("mergeOrder", () => {
  it("follows this window's order, drops tabs closed elsewhere, appends tabs opened elsewhere", () => {
    expect(mergeOrder(["b", "a", "c"], ["a", "b", "c"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
    expect(mergeOrder(["a", "b", "c"], ["a", "b", "c"], ["a", "c", "d"])).toEqual(["a", "c", "d"]);
  });
});
