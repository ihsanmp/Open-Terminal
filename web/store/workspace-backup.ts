// The workspace's copy on the API's disk (data/workspace.json): sent a moment after each change
// and when a window closes, and read back when the browser has nothing saved — its storage
// cleared, or a new browser profile — so changes outlive the browser's own copy.

import { useTerminal } from "./terminal";
import { createWorkspaceStorage, localSavedAt, readWorkspace, SAVED_AT_START, WORKSPACE_KEY } from "./workspace-storage";

const URL_PATH = "/api/workspace";
const DELAY_MS = 1500;

/**
 * Takes the copy from disk when it's newer than the browser's — the browser has nothing saved
 * (its storage cleared, a new profile), or lost its last changes (the browser was killed before
 * writing them out). Resolves true once that's settled; false if the API never answered, and then
 * the copy on disk must not be replaced by this window's defaults.
 */
async function restoreIfNewer(): Promise<boolean> {
  // Only the first window: others opened from it share its fresh copy.
  if (SAVED_AT_START && window.opener) return true;
  const local = localSavedAt();
  const until = Date.now() + (SAVED_AT_START ? 10_000 : 60_000);
  while (Date.now() < until) {
    try {
      const res = await fetch(URL_PATH, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) return true;
      if (res.ok) {
        const { workspace } = (await res.json()) as { workspace: { state: unknown; version: number; savedAt?: number } };
        if ((workspace.savedAt ?? 0) > local || !SAVED_AT_START) {
          createWorkspaceStorage()?.setItem(WORKSPACE_KEY, workspace as never);
          await useTerminal.persist.rehydrate();
        }
        return true;
      }
    } catch {
      // the API is still starting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  // With a workspace in the browser, it just stays; without one, the API never answered.
  return SAVED_AT_START;
}

function send(beacon: boolean): void {
  const saved = readWorkspace();
  if (!saved) return;
  const body = JSON.stringify(saved);
  if (beacon && navigator.sendBeacon(URL_PATH, new Blob([body], { type: "application/json" }))) return;
  void fetch(URL_PATH, { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60_000 }).catch(() => {
    // the next change or the window closing sends it again
  });
}

/** Restores the copy if needed, then keeps it up to date. Returns a function that stops it. */
export function startWorkspaceBackup(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let stopped = false;
  let unsubscribe = () => {};

  const flush = (beacon: boolean) => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    send(beacon);
  };
  const onHide = () => flush(true);
  const onVisibility = () => document.visibilityState === "hidden" && onHide();

  // The copy is only written once the restore had its chance, so defaults never replace it.
  void restoreIfNewer().then((settled) => {
    if (stopped) return;
    unsubscribe = useTerminal.subscribe((st, prev) => {
      if (st.tabs === prev.tabs && st.watchlist === prev.watchlist && st.favoriteIntervals === prev.favoriteIntervals) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => flush(false), DELAY_MS);
    });
    // A first copy right away, so there is one even before anything changes.
    if (!settled) return;
    dirty = true;
    flush(false);
  });
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stopped = true;
    flush(false);
    unsubscribe();
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
