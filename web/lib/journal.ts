"use client";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { apiGet, apiPut } from "./api";

// The Notepad's notes and the Nodes Plan's trade plans, kept on the server (data/journal/, see
// server/src/routes/journal.ts): read once, changed here at once, and the whole list written back
// half a second after the last change (and when the page closes).

export type JournalKind = "notes" | "plans";

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function useJournal<T extends { id: string }>(kind: JournalKind) {
  const qc = useQueryClient();
  const key = ["journal", kind];
  const { data, error, isLoading } = useQuery({ queryKey: key, queryFn: () => apiGet<T[]>(`/api/journal/${kind}`), staleTime: Infinity, refetchOnWindowFocus: false });
  const pending = useRef<T[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const list = pending.current;
    pending.current = null;
    if (list) apiPut(`/api/journal/${kind}`, list).catch((err) => console.warn(`journal ${kind}:`, err));
  }, [kind]);

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const save = useCallback(
    (next: T[]) => {
      qc.setQueryData(key, next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, flush, kind],
  );

  const list = data ?? [];
  // Changes build on the latest list, not the one this render saw: two edits in a row both stay.
  const latest = () => qc.getQueryData<T[]>(key) ?? [];
  const upsert = (item: T) => {
    const now = latest();
    save(now.some((x) => x.id === item.id) ? now.map((x) => (x.id === item.id ? item : x)) : [item, ...now]);
  };
  /** Merges a change into an item as it is now. */
  const update = (id: string, patch: Partial<T>) => save(latest().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => save(latest().filter((x) => x.id !== id));
  return { list, error, isLoading, upsert, update, remove, save };
}
