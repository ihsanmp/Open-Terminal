"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // A failed request is tried again three times, 1 s, 2 s and 4 s apart, before it counts
            // as an error — a provider's hiccup or a busy moment with many windows open rides
            // through without the page showing it. Data already shown stays meanwhile.
            retry: 3,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
            staleTime: 10_000,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
