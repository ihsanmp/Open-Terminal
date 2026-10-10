// A chart's undo and redo, as TradingView's buttons at the top: each change to the drawings or the
// indicators keeps what was there before it, to go back to and forward again. Changes coming fast
// one after another (typing a drawing's text, a slider dragged) count as one.

export class History<T> {
  private past: Array<{ state: T; label: string }> = [];
  private future: Array<{ state: T; label: string }> = [];
  private lastAt = 0;
  private lastLabel = "";

  constructor(
    private limit = 100,
    private mergeMs = 500
  ) {}

  /** The state before a change (and what the change was). */
  record(before: T, label: string, now = Date.now()) {
    const merge = this.past.length > 0 && label === this.lastLabel && now - this.lastAt < this.mergeMs;
    if (!merge) {
      this.past.push({ state: before, label });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.lastAt = now;
    this.lastLabel = label;
  }

  /** The state to go back to (the current one kept for redo), or null. */
  undo(current: T): T | null {
    const step = this.past.pop();
    if (!step) return null;
    this.future.push({ state: current, label: step.label });
    this.lastAt = 0;
    return step.state;
  }

  redo(current: T): T | null {
    const step = this.future.pop();
    if (!step) return null;
    this.past.push({ state: current, label: step.label });
    this.lastAt = 0;
    return step.state;
  }

  /** What undo and redo would take back or do again ("" when nothing). */
  undoLabel = () => this.past[this.past.length - 1]?.label ?? "";
  redoLabel = () => this.future[this.future.length - 1]?.label ?? "";

  clear() {
    this.past = [];
    this.future = [];
    this.lastAt = 0;
  }
}

/** What changed between two lists (drawings, indicators): "add X", "remove X", "change X". */
export function describeChange<T>(before: readonly T[], after: readonly T[], keyOf: (x: T) => string, nameOf: (x: T) => string, plural: string): string {
  const was = new Map(before.map((x) => [keyOf(x), x]));
  const now = new Map(after.map((x) => [keyOf(x), x]));
  const added = after.filter((x) => !was.has(keyOf(x)));
  const removed = before.filter((x) => !now.has(keyOf(x)));
  if (added.length === 1 && removed.length === 0) return `add ${nameOf(added[0])}`;
  if (removed.length === 1 && added.length === 0) return `remove ${nameOf(removed[0])}`;
  if (removed.length > 1 && added.length === 0) return `remove ${removed.length} ${plural}`;
  if (added.length || removed.length) return `change ${plural}`;
  const changed = after.filter((x) => was.get(keyOf(x)) !== x);
  return changed.length === 1 ? `change ${nameOf(changed[0])}` : `change ${plural}`;
}
