// Where the workspace is saved, so that every change survives — several app windows at once, a
// restart, or the browser's storage being cleared:
//
//   localStorage["openterminal-workspace"]          the tab order and the shared lists
//   localStorage["openterminal-workspace:tab:<id>"]  one entry per tab
//
// A window writes only what it changed since it last read or wrote: the tabs it edited, and the
// tab list merged with the one already saved (tabs another window opened meanwhile stay, tabs it
// closed stay closed). Two windows changing different tabs at the same moment therefore can't
// overwrite each other, as they could when each saved the whole list.
//
// A copy also goes to the API's disk (data/workspace.json, see backupWorkspace) and comes back
// when the browser has nothing saved.

import type { PersistStorage, StorageValue } from "zustand/middleware";

export const WORKSPACE_KEY = "openterminal-workspace";
const TAB_PREFIX = `${WORKSPACE_KEY}:tab:`;

/** The saved part of the store (see the persist options in terminal.ts). */
export type SavedTab = { id: string } & Record<string, unknown>;
export type SavedWorkspace = { tabs: SavedTab[]; watchlist?: string[]; favoriteIntervals?: string[] };

/** `savedAt`: when it last changed, to tell whether the copy on disk is newer. */
type Index = { order: string[]; watchlist?: string[]; favoriteIntervals?: string[]; savedAt?: number };
type Known = { order: string[]; tabs: Map<string, string>; watchlist: string; favoriteIntervals: string };

const json = (v: unknown) => JSON.stringify(v ?? null);

/** Merges this window's tab order into the saved one, given what it last knew. */
export function mergeOrder(mine: string[], known: string[], saved: string[]): string[] {
  const knownSet = new Set(known);
  const savedSet = new Set(saved);
  // Tabs closed in another window (known, no longer saved) stay closed …
  const kept = mine.filter((id) => !(knownSet.has(id) && !savedSet.has(id)));
  // … and tabs opened in another window (saved, never known here) stay open.
  const theirs = saved.filter((id) => !knownSet.has(id) && !kept.includes(id));
  return [...kept, ...theirs];
}

export function createWorkspaceStorage(store: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): PersistStorage<SavedWorkspace> | undefined {
  if (!store) return undefined;
  let known: Known | null = null;

  const readIndex = (): { index: Index | null; version: number; legacy?: SavedWorkspace } => {
    const raw = store.getItem(WORKSPACE_KEY);
    if (!raw) return { index: null, version: 0 };
    const parsed = JSON.parse(raw) as { state: Index & { tabs?: SavedTab[] }; version?: number };
    // v1 kept every tab inside this one entry.
    if (parsed.state?.tabs) return { index: null, version: parsed.version ?? 0, legacy: parsed.state as SavedWorkspace };
    return { index: parsed.state, version: parsed.version ?? 0 };
  };

  const remember = (ws: SavedWorkspace) => {
    known = {
      order: ws.tabs.map((t) => t.id),
      tabs: new Map(ws.tabs.map((t) => [t.id, json(t)])),
      watchlist: json(ws.watchlist),
      favoriteIntervals: json(ws.favoriteIntervals),
    };
  };

  return {
    getItem: (): StorageValue<SavedWorkspace> | null => {
      try {
        const { index, version, legacy } = readIndex();
        if (legacy) {
          known = null; // nothing in the per-tab layout yet: the first save writes all of it
          return { state: legacy, version };
        }
        if (!index) return null;
        const tabs: SavedTab[] = [];
        for (const id of index.order) {
          const raw = store.getItem(TAB_PREFIX + id);
          if (raw) tabs.push(JSON.parse(raw) as SavedTab);
        }
        const ws: SavedWorkspace = { tabs, watchlist: index.watchlist, favoriteIntervals: index.favoriteIntervals };
        remember(ws);
        return { state: ws, version, savedAt: index.savedAt } as StorageValue<SavedWorkspace>;
      } catch {
        return null;
      }
    },

    setItem: (_name, value) => {
      const mine = value.state;
      const { index: saved } = readIndex();
      const savedOrder = saved?.order ?? [];
      const k = known;
      const order = k ? mergeOrder(mine.tabs.map((t) => t.id), k.order, savedOrder) : mine.tabs.map((t) => t.id);

      // Tabs this window changed (or every tab, the first time).
      let changed = false;
      for (const tab of mine.tabs) {
        const body = json(tab);
        if (!k || k.tabs.get(tab.id) !== body) {
          store.setItem(TAB_PREFIX + tab.id, body);
          changed = true;
        }
      }
      // Tabs this window closed.
      if (k) for (const id of k.order) if (!mine.tabs.some((t) => t.id === id)) store.removeItem(TAB_PREFIX + id);

      const index: Index = {
        order,
        savedAt: saved?.savedAt,
        watchlist: !k || json(mine.watchlist) !== k.watchlist ? mine.watchlist : saved?.watchlist ?? mine.watchlist,
        favoriteIntervals: !k || json(mine.favoriteIntervals) !== k.favoriteIntervals ? mine.favoriteIntervals : saved?.favoriteIntervals ?? mine.favoriteIntervals,
      };
      const unchanged = JSON.stringify({ state: index, version: value.version });
      if (changed || store.getItem(WORKSPACE_KEY) !== unchanged) {
        // A saved copy given back (the backup restored) keeps its own time.
        index.savedAt = (value as { savedAt?: number }).savedAt ?? Date.now();
        store.setItem(WORKSPACE_KEY, JSON.stringify({ state: index, version: value.version }));
      }

      // What's saved now is what this window knows.
      const tabs = order
        .map((id) => mine.tabs.find((t) => t.id === id) ?? (store.getItem(TAB_PREFIX + id) ? (JSON.parse(store.getItem(TAB_PREFIX + id)!) as SavedTab) : null))
        .filter((t): t is SavedTab => t !== null);
      remember({ tabs, watchlist: index.watchlist, favoriteIntervals: index.favoriteIntervals });
    },

    removeItem: () => {
      const { index } = readIndex();
      for (const id of index?.order ?? []) store.removeItem(TAB_PREFIX + id);
      store.removeItem(WORKSPACE_KEY);
      known = null;
    },
  };
}

/** Whether the browser had a workspace saved when the app started (before anything was written). */
export const SAVED_AT_START = hasSavedWorkspace();

/** Whether the browser has a saved workspace (any layout). */
export function hasSavedWorkspace(store: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): boolean {
  try {
    return Boolean(store?.getItem(WORKSPACE_KEY));
  } catch {
    return false;
  }
}

/** When the workspace in the browser last changed (0 if never or unknown). */
export function localSavedAt(store: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): number {
  try {
    const raw = store?.getItem(WORKSPACE_KEY);
    return raw ? Number((JSON.parse(raw) as { state?: Index }).state?.savedAt ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** The whole saved workspace as one object, for the backup on the API's disk. */
export function readWorkspace(store: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): StorageValue<SavedWorkspace> | null {
  return createWorkspaceStorage(store)?.getItem(WORKSPACE_KEY) as StorageValue<SavedWorkspace> | null;
}
