// Benchmark indices by region: Yahoo symbols (charts) with their TradingView tickers (quotes).
export type IndexInfo = { symbol: string; /** TradingView ticker, used for batch quotes */ tv: string; name: string; country: string; region: "Americas" | "Europe" | "Asia-Pacific" | "Middle East & Africa" };

export const WORLD_INDICES: IndexInfo[] = [
  { symbol: "^GSPC", tv: "SP:SPX", name: "S&P 500", country: "US", region: "Americas" },
  { symbol: "^DJI", tv: "DJ:DJI", name: "Dow Jones Industrial Average", country: "US", region: "Americas" },
  { symbol: "^IXIC", tv: "NASDAQ:IXIC", name: "Nasdaq Composite", country: "US", region: "Americas" },
  { symbol: "^NDX", tv: "NASDAQ:NDX", name: "Nasdaq 100", country: "US", region: "Americas" },
  { symbol: "^RUT", tv: "TVC:RUT", name: "Russell 2000", country: "US", region: "Americas" },
  { symbol: "^NYA", tv: "NYSE:NYA", name: "NYSE Composite", country: "US", region: "Americas" },
  { symbol: "^SOX", tv: "NASDAQ:SOX", name: "PHLX Semiconductor", country: "US", region: "Americas" },
  { symbol: "^VIX", tv: "CBOE:VIX", name: "CBOE Volatility Index", country: "US", region: "Americas" },
  { symbol: "^GSPTSE", tv: "TSX:TSX", name: "S&P/TSX Composite", country: "CA", region: "Americas" },
  { symbol: "^BVSP", tv: "BMFBOVESPA:IBOV", name: "Ibovespa", country: "BR", region: "Americas" },
  { symbol: "^MXX", tv: "BMV:ME", name: "S&P/BMV IPC", country: "MX", region: "Americas" },
  { symbol: "^MERV", tv: "BCBA:IMV", name: "S&P Merval", country: "AR", region: "Americas" },
  { symbol: "^FTSE", tv: "FTSE:UKX", name: "FTSE 100", country: "GB", region: "Europe" },
  { symbol: "^GDAXI", tv: "XETR:DAX", name: "DAX", country: "DE", region: "Europe" },
  { symbol: "^FCHI", tv: "EURONEXT:PX1", name: "CAC 40", country: "FR", region: "Europe" },
  { symbol: "^STOXX50E", tv: "TVC:SX5E", name: "Euro Stoxx 50", country: "EU", region: "Europe" },
  { symbol: "^STOXX", tv: "TVC:SXXP", name: "STOXX Europe 600", country: "EU", region: "Europe" },
  { symbol: "FTSEMIB.MI", tv: "TVC:FTMIB", name: "FTSE MIB", country: "IT", region: "Europe" },
  { symbol: "^IBEX", tv: "BME:IBC", name: "IBEX 35", country: "ES", region: "Europe" },
  { symbol: "^AEX", tv: "EURONEXT:AEX", name: "AEX", country: "NL", region: "Europe" },
  { symbol: "^SSMI", tv: "SIX:SMI", name: "Swiss Market Index", country: "CH", region: "Europe" },
  { symbol: "^OMX", tv: "OMXSTO:OMXS30", name: "OMX Stockholm 30", country: "SE", region: "Europe" },
  { symbol: "^N225", tv: "TVC:NI225", name: "Nikkei 225", country: "JP", region: "Asia-Pacific" },
  { symbol: "^HSI", tv: "TVC:HSI", name: "Hang Seng", country: "HK", region: "Asia-Pacific" },
  { symbol: "000001.SS", tv: "SSE:000001", name: "SSE Composite", country: "CN", region: "Asia-Pacific" },
  { symbol: "399001.SZ", tv: "SZSE:399001", name: "SZSE Component", country: "CN", region: "Asia-Pacific" },
  { symbol: "^KS11", tv: "KRX:KOSPI", name: "KOSPI", country: "KR", region: "Asia-Pacific" },
  { symbol: "^TWII", tv: "TWSE:IX0001", name: "TAIEX", country: "TW", region: "Asia-Pacific" },
  { symbol: "^NSEI", tv: "NSE:NIFTY", name: "Nifty 50", country: "IN", region: "Asia-Pacific" },
  { symbol: "^BSESN", tv: "BSE:SENSEX", name: "BSE Sensex", country: "IN", region: "Asia-Pacific" },
  { symbol: "^JKSE", tv: "IDX:COMPOSITE", name: "IDX Composite (IHSG)", country: "ID", region: "Asia-Pacific" },
  { symbol: "^JKLQ45", tv: "IDX:LQ45", name: "LQ45", country: "ID", region: "Asia-Pacific" },
  { symbol: "^STI", tv: "TVC:STI", name: "Straits Times Index", country: "SG", region: "Asia-Pacific" },
  { symbol: "^KLSE", tv: "FTSEMYX:FBMKLCI", name: "FTSE Bursa Malaysia KLCI", country: "MY", region: "Asia-Pacific" },
  { symbol: "^SET.BK", tv: "SET:SET", name: "SET Index", country: "TH", region: "Asia-Pacific" },
  { symbol: "PSEI.PS", tv: "PSE:PSEI", name: "PSEi", country: "PH", region: "Asia-Pacific" },
  { symbol: "^AXJO", tv: "ASX:XJO", name: "S&P/ASX 200", country: "AU", region: "Asia-Pacific" },
  { symbol: "^NZ50", tv: "NZX:NZ50G", name: "S&P/NZX 50", country: "NZ", region: "Asia-Pacific" },
  { symbol: "^TA125.TA", tv: "TASE:TA125", name: "TA-125", country: "IL", region: "Middle East & Africa" },
  { symbol: "^TASI.SR", tv: "TADAWUL:TASI", name: "Tadawul All Share", country: "SA", region: "Middle East & Africa" },
  { symbol: "^J203.JO", tv: "JSE:J203", name: "FTSE/JSE All Share", country: "ZA", region: "Middle East & Africa" },
];

export function searchIndices(query: string, limit = 5): IndexInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return WORLD_INDICES.filter(
    (i) => i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || i.country.toLowerCase() === q
  ).slice(0, limit);
}

export const INDEX_TV_TICKER = new Map(WORLD_INDICES.map((i) => [i.symbol, i.tv]));
