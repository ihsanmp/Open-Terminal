import { describe, expect, it } from "vitest";
import { History, describeChange } from "./undo";

describe("undo and redo", () => {
  it("goes back and forward through the changes", () => {
    const h = new History<number>();
    h.record(0, "a", 1000);
    h.record(1, "b", 2000);
    expect(h.undoLabel()).toBe("b");
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeNull();
    expect(h.redoLabel()).toBe("a");
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBeNull();
  });

  it("forgets what could be redone once something new is done", () => {
    const h = new History<number>();
    h.record(0, "a", 1000);
    h.undo(1);
    h.record(0, "c", 5000);
    expect(h.redoLabel()).toBe("");
    expect(h.undo(7)).toBe(0);
  });

  it("counts quick changes of one kind as one, and keeps a limit", () => {
    const h = new History<number>(3);
    h.record(0, "type", 1000);
    h.record(1, "type", 1200);
    h.record(2, "type", 1400);
    expect(h.undo(3)).toBe(0);
    const k = new History<number>(3);
    for (let i = 0; i < 5; i++) k.record(i, `s${i}`, 1000 * i);
    expect([k.undo(5), k.undo(4), k.undo(3), k.undo(2)]).toEqual([4, 3, 2, null]);
  });

  it("names the change", () => {
    const name = (x: { id: string; n: string }) => x.n;
    const a = { id: "1", n: "Trend line" };
    const b = { id: "2", n: "Rectangle" };
    expect(describeChange([a], [a, b], (x) => x.id, name, "drawings")).toBe("add Rectangle");
    expect(describeChange([a, b], [a], (x) => x.id, name, "drawings")).toBe("remove Rectangle");
    expect(describeChange([a, b], [], (x) => x.id, name, "drawings")).toBe("remove 2 drawings");
    expect(describeChange([a, b], [a, { ...b }], (x) => x.id, name, "drawings")).toBe("change Rectangle");
  });
});
