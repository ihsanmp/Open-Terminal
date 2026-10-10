// The news tab's categories (each feed's beat) and their colours, shared by the news recap.

export const NEWS_CATEGORIES = ["MARKETS", "ECONOMIC", "REGULATORY", "GEOPOLITICS", "CRYPTO", "ENERGY", "TECH"] as const;

export const CATEGORY_COLOR: Record<string, string> = {
  MARKETS: "#ff9900",
  ECONOMIC: "#26c6da",
  REGULATORY: "#b388ff",
  GEOPOLITICS: "#ff5252",
  CRYPTO: "#f7931a",
  ENERGY: "#ffeb3b",
  TECH: "#00e676",
};
