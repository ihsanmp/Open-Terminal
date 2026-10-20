"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { catalogueIfReady, getCatalogue } from "../lib/astro-calendar/catalogue";
import type { AstroEvent } from "../lib/astro-calendar/events";
import type { QuantForecast } from "../lib/quant";
import AstroChat, { useChatHistory } from "./widgets/AstroChat";

// What the floating bubble's panel holds (loaded the first time it opens): the chat, the
// calendar's sky events (worked out once, shared with the Astro Calendar) and the quant forecast.

export default function AstroChatPanel() {
  const [events, setEvents] = useState<AstroEvent[] | null>(() => catalogueIfReady()?.events ?? null);
  useEffect(() => {
    if (events) return;
    // After the panel has shown: the catalogue takes under a second.
    const id = setTimeout(() => setEvents(getCatalogue().events), 50);
    return () => clearTimeout(id);
  }, [events]);
  // The same query (and cache) as the Live TV's and the calendar's.
  const forecast = useQuery({ queryKey: ["quant-forecast"], queryFn: () => apiGet<QuantForecast>("/api/quant/forecast"), staleTime: 300_000, retry: 1 });
  const history = useChatHistory();
  const [, , clear] = history;
  useEffect(() => {
    const onClear = () => clear();
    window.addEventListener("astro-chat-clear", onClear);
    return () => window.removeEventListener("astro-chat-clear", onClear);
  });
  return <AstroChat events={events} forecast={forecast.data} history={history} />;
}
