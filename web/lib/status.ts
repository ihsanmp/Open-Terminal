"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

// The API server's status (feeds, and whether the AI assistant is set up), shared by the top bar
// and the menu through one query.

export type Status = {
  ok: boolean;
  providers: Array<{ name: string; ok: number; failed: number; lastLatencyMs: number | null; avgLatencyMs: number | null }>;
  ai: boolean;
};

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<Status>("/api/status"),
    // Asked again every couple of seconds until a feed has answered: at start the server has
    // asked none yet, and the top bar said "connecting…" for up to a minute after the charts had
    // their data. Then once a minute.
    refetchInterval: (q) => (q.state.data?.providers.some((p) => p.ok > 0) ? 60_000 : 2_000),
  });
}

/** Whether the AI assistant works: the server has an Anthropic key. Unknown (false) until it says. */
export const useAiAvailable = () => useStatus().data?.ai ?? false;
