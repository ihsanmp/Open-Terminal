<div align="center">

# OpenTerminal

**A Terminal‑style workspace for the rest of us — built entirely on free, public market data.**

Dark. Dense. Keyboard‑driven. Zero paid API keys, zero subscriptions.

[![Stack](https://img.shields.io/badge/stack-Next.js%20%2B%20Express%20%2B%20TypeScript-orange)](#tech-stack)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![No API Key Required](https://img.shields.io/badge/data-no%20API%20key%20required-brightgreen)](#data-sources)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](#contributing)

<a href="https://trendshift.io/repositories/215916?utm_source=trendshift-badge&utm_medium=badge&utm_campaign=badge-trendshift-215916" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/215916/daily?language=TypeScript" alt="ErTasselli%2FOpenTerminal | Trendshift" width="250" height="55"/></a>

<br/>

<img src="docs/screenshots/dashboard.png" alt="OpenTerminal dashboard — live chart, quote panel, watchlist, news and macro indexes" width="100%" />

<sub>⭐ If this is useful to you, consider starring the repo — it genuinely helps other people find it.</sub>

</div>

<br/>

## Why OpenTerminal?

Real trading terminals cost **$2,000+ a month**. Most retail dashboards either lock the good stuff behind a paywall or run on a single flaky data source that breaks the moment you actually need it.

OpenTerminal takes a different approach: it stitches together several **free, publicly documented (or reverse‑engineered but widely used) market data endpoints** — the same ones that power major finance sites' own front ends — into one fast, keyboard‑first, widget‑based dashboard that runs entirely on your machine. Every data endpoint has an automatic fallback chain, so a single provider hiccup never takes the whole app down.

No signup. No credit card. No rate‑limited demo tier. Clone it, `npm install`, and you have a live terminal in under a minute.

<br/>

## ✨ Features

- 🖥️ **Widget-based workspace** — drag, resize, add, and remove panels (`react-grid-layout`); your layout is saved locally and restored on reload
- ⌘K **global command palette** — instantly search stocks, ETFs, and crypto and jump straight to them
- 📈 **Professional charting** (via [`lightweight-charts`](https://github.com/tradingview/lightweight-charts)) — candlesticks, bars, line, area, 8 timeframes (1D → MAX)
- 🧮 **97 TradingView built-in indicators** — ported from Pine Script's `ta.*` semantics and checked value-for-value against TradingView's own numbers (RSI, MACD, Stochastic, ADX/DMI, Ichimoku, Supertrend, Parabolic SAR, Bollinger/Keltner/Donchian, VWAP with bands, all six Pivot Points types, ZigZag, and many more), plus rebuilt community scripts (ATR Z-Score, ALMA SD Bands, Adaptive Trend Envelope). Searchable picker, per-indicator settings, separate panes, cloud fills, signals and a TradingView-style legend
- 💹 **Quote panel** — last / bid / ask / OHLC, volume, market cap, P/E, EPS, dividend yield, 52‑week range, beta, shares outstanding
- 📰 **News feed** — aggregated and de‑duplicated from multiple RSS sources, per‑symbol or global
- 🔎 **Full‑market screener** — filter by sector, market cap, % change, and volume across the entire US equity market, sortable on every column
- 🗺️ **Live sector heatmap** — treemap sized by market cap, colored by daily % change, refreshing every few seconds
- ⛓️ **Options chain** — calls and puts side‑by‑side with strike, bid/ask, volume, open interest, and ITM highlighting
- 🪙 **Every crypto coin & token** — a ranked board of ~2,500 assets (paged, searchable, logos, BTC/ETH dominance) and a chart for any of them: Binance candles for its ~500 USDT pairs, CoinGecko for the rest. Symbols use the `BTC-USD` form so coins never collide with stock tickers
- 🌍 **World indices** — ~40 benchmarks across the Americas, Europe, Asia‑Pacific and the Middle East (S&P 500, Nikkei 225, IHSG, Nifty 50, DAX…), searchable and chartable like any stock, alongside stocks from exchanges worldwide (`BBCA.JK`, `7203.T`, `0700.HK`)
- 🔬 **Equity research** — multi‑year income statement, balance sheet and cash flow (global coverage), yearly ratios with DuPont breakdown, Piotroski F‑score, Altman Z‑score, Beneish M‑score, Graham number, an interactive DCF with CAPM defaults, analyst consensus and price targets (converted to the trading currency), and industry peers
- 🏦 **Macro dashboard** — live US Treasury yield curve, VIX, and major index/commodity proxies
- 💼 **Portfolio tracker** — log buy/sell transactions, track average cost, realized & unrealized P&L (persisted in SQLite)
- 📅 **Calendar** — economic events (Fed, ECB, CPI, NFP and more) with consensus forecast, previous reading and, for the major US/EU releases, the actual outcome; plus a per‑watchlist earnings calendar with click‑through history showing forecast vs. actual EPS for the last several quarters and the stock's next‑day price move
- 🤖 **AI assistant** (optional) — ask questions about the symbol you're looking at, powered by Claude, fully context‑aware of the terminal's current data
- ⚡ **Near real‑time updates** — quotes and indexes refresh every second with a subtle flash on change, so you always know what just moved
- ⌨️ **Keyboard shortcuts** everywhere — `⌘K` to search, `⌥1`–`⌥9` to add any widget

<br/>

## 📸 A closer look

### Charting

Candlesticks, bars, line, or area — 8 timeframes, 97 TradingView built-in indicators, and a live legend under your cursor showing OHLC, volume, and every active indicator's value for the candle you're pointing at.

<img src="docs/screenshots/chart.png" alt="Candlestick chart with SMA/RSI/MACD indicators and hover legend" width="100%" />

<br/>

### Live sector heatmap

The whole US equity market as a treemap — sized by market cap, colored by daily % change, refreshing every few seconds so nothing you're watching ever goes stale.

<img src="docs/screenshots/heatmap.png" alt="Live sector heatmap of the US equity market" width="100%" />

<br/>

### Crypto

Every ranked coin and token, paged and searchable, with market cap, 24h volume and BTC/ETH dominance — click through to full candlestick charting for any of them, same charting engine and indicators as stocks.

<img src="docs/screenshots/crypto.png" alt="Crypto board with sparklines and dominance" width="100%" />

<br/>

### News

Headlines aggregated and de‑duplicated across multiple sources, filterable per‑symbol or global, so you're never digging through five tabs to catch up.

<img src="docs/screenshots/news.png" alt="Per-symbol and global news feed, aggregated and de-duplicated" width="100%" />

<br/>

## 🗂️ Data sources

No paid API, no keys, and no single point of failure — every endpoint has a fallback chain, and results are cached with a stale‑while‑revalidate strategy so a temporary outage never blanks out the UI.

| Data | Primary source | Fallback |
|---|---|---|
| Quotes (US stocks/ETFs) | Nasdaq public quote API | Yahoo Finance → Stooq |
| Quotes (indices, non‑US stocks) | TradingView scanner API (one batched request) | Yahoo Finance |
| Fundamentals (P/E, EPS, beta, div yield) | TradingView scanner API | — |
| Historical candles | Nasdaq chart API | Yahoo Finance → Stooq |
| Symbol search | TradingView symbol search + built‑in index list + ranked coin universe | Yahoo Finance |
| Full‑market screener / heatmap | TradingView scanner API (live, whole US market) | — |
| Options chain | Nasdaq option‑chain API | Yahoo Finance |
| News | Yahoo Finance RSS | Google News RSS |
| Crypto board & quotes | TradingView coin scanner (~2,500 ranked assets) · Binance for its USDT pairs | CoinGecko → Yahoo Finance |
| Crypto candles | Binance market‑data mirror (`data-api.binance.vision`, reachable where api.binance.com is ISP‑blocked) | CoinGecko OHLC → Yahoo Finance |
| Financial statements | Yahoo Finance fundamentals time series | SEC EDGAR XBRL company facts (US filers) |
| Company profile, analyst consensus, price targets, peers | TradingView scanner API | — |
| Macro (Treasury yields, VIX) | FRED (Federal Reserve) | — |
| Economic calendar (schedule, forecast, previous) | Forex Factory public feed | — |
| Economic calendar (actual — Fed / ECB / CPI / NFP only) | FRED (Federal Reserve) | — |
| Earnings calendar (next/last date, EPS estimate) | TradingView scanner API | — |
| Earnings history (forecast vs. actual, surprise %) | Nasdaq earnings‑surprise API | — |

> ⚠️ These are public endpoints, not officially licensed data feeds — treat prices as delayed/indicative, not execution‑grade. See [`server/src/providers/`](server/src/providers) — each provider is a small, isolated module, so swapping or adding a data source is a 30‑minute job.

<br/>

## 🚀 Quick start

```bash
git clone https://github.com/ErTasselli/openterminal.git
cd openterminal
npm install
npm run dev
```

- Web UI → **http://localhost:3000**
- API health → **http://localhost:4000/api/status**

That's it — no `.env` file required to get a fully working terminal.

### Windows desktop app

Prefer a double-click app over a terminal? Run the installer once:

```bash
desktop\install.cmd
```

It builds the project and adds an **OpenTerminal** shortcut to your Desktop and Start Menu. Opening it starts the API and web servers in the background, shows the terminal in its own window (Microsoft Edge or Chrome app mode), and stops the servers when you close that window.

On every launch it also checks GitHub: if `origin/main` has new commits it fast-forwards, reinstalls dependencies when `package.json` changed, and rebuilds before starting. Without network access (or with local edits in the way) it simply opens the current version. Logs are written to `data/logs/`; `desktop\uninstall.ps1` removes the shortcuts.

### Optional: AI assistant

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Without a key, everything else still works — the AI widget just shows a friendly "unavailable" message instead of failing.

### Security defaults

- The API binds to `127.0.0.1` and only accepts browser requests from `http://localhost:3000` by default — nothing else on your network can reach it out of the box.
- The portfolio and AI endpoints require a shared secret. If you don't set `API_KEY` yourself, the API generates one on first run and saves it to `data/.api-key`; the bundled web app reads that file automatically, so local dev stays zero-config.
- To expose this beyond your own machine, set `API_HOST=0.0.0.0`, `API_KEY=<a-strong-secret>` (on both the api and web processes), and `WEB_ORIGIN=<your actual origin>` explicitly. Don't do this without also keeping dependencies patched — see [Known limitations](#known-limitations) below.
- The `/api/ai` rate limit (10 req/min) keys on `req.ip`. Calls made through the bundled web proxy all arrive from that proxy's own address, so by default every caller sharing it shares one bucket. If you're serving more than one real user through it, set `TRUST_PROXY=1` on the api process **only if** you also run your own reverse proxy in front of the web service that sets `X-Forwarded-For` from the real client and doesn't let visitors set it themselves — otherwise a caller can forge that header to dodge the limit.

<br/>

## 🐳 Docker

```bash
docker compose up --build
```

Portfolio data persists in the `terminal-data` volume (SQLite, WAL mode). Ports are published on `127.0.0.1` only by default; see [Security defaults](#security-defaults) to expose it deliberately.

<br/>

## 🧱 Tech stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Zustand · TanStack Query |
| Charts | `lightweight-charts` (candles/indicators) · D3 (heatmap treemap) · Recharts (yield curve) |
| Backend | Node.js · Express · TypeScript |
| Database | SQLite (`better-sqlite3`, WAL mode) |
| AI | Anthropic Claude (optional) |

<br/>

## 📁 Project structure

```
├── server/                  # Express + TypeScript API
│   └── src/
│       ├── providers/       # nasdaq, tradingview, yahoo, stooq, fred, econcalendar, coingecko, binance, news
│       ├── routes/          # market, portfolio, ai
│       ├── cache.ts         # TTL cache with stale-while-revalidate fallback
│       └── db.ts            # SQLite (better-sqlite3, WAL)
└── web/                      # Next.js 15 + React 19 + Tailwind 4
    ├── components/           # TopBar, Sidebar, Workspace, CommandPalette
    ├── components/widgets/   # Chart, Quote, Watchlist, News, Screener, Heatmap, Crypto, Options, Macro, Portfolio, Calendar, AI
    ├── lib/                  # API client
    ├── lib/ta/               # indicator engine: Pine-style ta.* core, catalog, chart fill/bgcolor primitives
    └── store/                # Zustand store (workspace layout, persisted)
```

Run tests with `npm test` (Vitest, no network calls). The indicator suite compares every supported value against a fixture captured from TradingView's scanner on the same daily candles, so a formula that drifts from TradingView fails CI. CI runs on every push — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

<br/>

## 🗺️ Roadmap

- [ ] Chart drawing tools & multi‑asset comparison overlay
- [ ] Black‑Scholes Greeks on the options chain
- [ ] Price alerts with desktop notifications
- [ ] PostgreSQL as an alternative to SQLite

Have an idea? [Open an issue](../../issues) — contributions are very welcome.

<br/>

## 🙏 Acknowledgements

The equity‑research, world‑indices and all‑crypto features were inspired by [FinceptTerminal](https://github.com/Fincept-Corporation/FinceptTerminal). No code was taken from it — it is AGPL‑3.0 and this project is MIT — the features were reimplemented independently on free public data sources.

## 🤝 Contributing

Pull requests are welcome, especially:
- New or more resilient data providers (`server/src/providers/`)
- New widgets (`web/components/widgets/`)
- Bug fixes and UI polish

Please open an issue first for anything non‑trivial so we can align on approach before you invest the time.

<br/>

## Known limitations

- `npm audit` still flags two dependency advisories this project doesn't force-fix: `fast-xml-parser`'s XMLBuilder injection (moderate) doesn't apply here — only `XMLParser` is used, never `XMLBuilder` — and `postcss`'s high-severity issue is bundled inside Next.js itself, only resolved by a Next 16 major upgrade. Both are tracked, neither is silently ignored.
- If you deploy behind a reverse proxy or load balancer, set `API_HOST`/`WEB_ORIGIN` to match, and terminate TLS in front of it — this project doesn't handle HTTPS itself.

<br/>

## ⚖️ Disclaimer

For personal and educational use only. Market data comes from public endpoints and may be delayed, incomplete, or occasionally wrong — **do not use this for real investment decisions**.

This project is not affiliated with, endorsed by, or sponsored by any of the data providers it connects to. It does not host or redistribute data to third parties — it's source code you run yourself, fetching data directly from the provider. Respect the terms of service of the underlying data providers; most free sources are licensed for personal/research use only and prohibit commercial redistribution.

## License

[MIT](LICENSE)

<br/>

<div align="center">

**star the repo** ⭐ — it's the best way to support the project.

</div>
