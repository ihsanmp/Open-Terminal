import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// DATA_DIR lets the Docker image point this at the mounted volume: once
// compiled, dist/db.js sits two levels below /app instead of server/src, so
// the source-relative default below would otherwise resolve outside /app.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = process.env.DATA_DIR ?? join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "terminal.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  executed_at TEXT NOT NULL
);
`);

// The portfolio is a trading journal: every buy or sell entered by hand, with what the template
// it follows asks for — the reason and feelings before, the feelings, grade and lesson after, and
// a chart photo. Side, quantity and price are optional; the entries that have them make holdings.
db.exec(`
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  traded_at TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT CHECK (side IS NULL OR side IN ('BUY','SELL')),
  quantity REAL CHECK (quantity IS NULL OR quantity > 0),
  price REAL CHECK (price IS NULL OR price >= 0),
  reason TEXT NOT NULL DEFAULT '',
  emotion_before TEXT NOT NULL DEFAULT '',
  emotion_after TEXT NOT NULL DEFAULT '',
  grade INTEGER CHECK (grade IS NULL OR grade BETWEEN 1 AND 5),
  lesson TEXT NOT NULL DEFAULT '',
  chart_image TEXT,
  chart_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Once: the plain buy/sell transactions kept before become the journal's first entries.
if ((db.pragma("user_version", { simple: true }) as number) < 1) {
  db.transaction(() => {
    db.exec(`
      INSERT INTO journal_entries (portfolio_id, traded_at, symbol, side, quantity, price)
      SELECT portfolio_id, substr(executed_at, 1, 10), symbol, side, quantity, price FROM transactions ORDER BY executed_at, id;
    `);
    db.pragma("user_version = 1");
  })();
}

const defaultPortfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get();
if (!defaultPortfolio) {
  db.prepare("INSERT INTO portfolios (name) VALUES (?)").run("Main");
}
