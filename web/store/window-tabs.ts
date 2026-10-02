// Which tabs each app window shows. Every window has tabs of its own, as browser windows do: a tab
// is shown in one window only, so windows never mirror each other. The tabs themselves are saved
// with the workspace (workspace-storage.ts); this records which window has which:
//
//   sessionStorage["openterminal-window"]      this window's id and tabs (kept over a reload)
//   localStorage["openterminal-window:<id>"]   each open window's tabs, for the others to see
//
// A window clears its entry when it closes. One that couldn't (the app was killed) is told apart
// from one that is merely minimised by a Web Lock each window holds while it's open; its tabs go
// to the next window that starts afresh, so nothing is lost.

const SESSION_KEY = "openterminal-window";
export const WINDOW_PREFIX = "openterminal-window:";
const lockName = (id: string) => `openterminal-window-lock:${id}`;

type Session = { id: string; tabs: string[] };

function readSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

const session = typeof window === "undefined" ? null : readSession();

/** This window's id (the same after a reload). */
export const windowId = session?.id ?? `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The tabs this window showed before a reload, if it was reloaded. */
export const sessionTabs: string[] | null = session?.tabs ?? null;

/** Records this window's tabs, for a reload and for the other windows. */
export function saveWindowTabs(tabs: string[]): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: windowId, tabs }));
  } catch {
    // a reload then starts afresh
  }
  try {
    window.localStorage.setItem(WINDOW_PREFIX + windowId, JSON.stringify(tabs));
  } catch {
    // other windows then can't see these tabs are taken
  }
}

/** Every other window's tabs, as recorded (including windows that closed without clearing). */
function otherWindows(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  try {
    const store = window.localStorage;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(WINDOW_PREFIX) || key === WINDOW_PREFIX + windowId) continue;
      out.set(key.slice(WINDOW_PREFIX.length), JSON.parse(store.getItem(key) ?? "[]") as string[]);
    }
  } catch {
    // none known
  }
  return out;
}

/** Tabs another window shows. */
export function tabsOfOtherWindows(): Set<string> {
  return new Set([...otherWindows().values()].flat());
}

/** Marks this window open until it closes (also when it is killed), for tabsOfClosedWindows. */
export function holdWindowLock(): void {
  try {
    void navigator.locks?.request(lockName(windowId), () => new Promise<void>(() => {}));
  } catch {
    // without Web Locks, entries of killed windows stay until cleared by hand
  }
}

/**
 * The tabs of windows that closed without clearing their entry; their entries are removed. Empty
 * without Web Locks (then every recorded window counts as open).
 */
export async function tabsOfClosedWindows(): Promise<string[]> {
  if (typeof navigator === "undefined" || !navigator.locks?.query) return [];
  try {
    const { held = [] } = await navigator.locks.query();
    const open = new Set(held.map((l) => l.name));
    const freed: string[] = [];
    for (const [id, tabs] of otherWindows()) {
      if (open.has(lockName(id))) continue;
      window.localStorage.removeItem(WINDOW_PREFIX + id);
      freed.push(...tabs);
    }
    return freed;
  } catch {
    return [];
  }
}

/** Clears this window's entry as it closes or reloads (a reload records it again at once). */
export function forgetWindowOnClose(): () => void {
  const onHide = () => {
    try {
      window.localStorage.removeItem(WINDOW_PREFIX + windowId);
    } catch {
      // the next window to start afresh takes these tabs back
    }
  };
  window.addEventListener("pagehide", onHide);
  return () => window.removeEventListener("pagehide", onHide);
}
