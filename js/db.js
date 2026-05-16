'use strict';

/**
 * SQLite 資料庫 (sql.js WebAssembly - 無需 native 編譯)
 * 暴露同步相容的 prepare API + 非同步初始化
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DB_PATH = process.env.DB_PATH
  ? path.resolve(__dirname, '..', process.env.DB_PATH)
  : path.join(__dirname, '../data/life_manager.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ── Singleton ──
let _db = null;

function wrap(raw) {
  function persist() {
    fs.writeFileSync(DB_PATH, Buffer.from(raw.export()));
  }

  return {
    _raw: raw,
    persist,
    prepare(sql) {
      return {
        all(...params) {
          const flat = params.flat();
          const stmt = raw.prepare(sql);
          const rows = [];
          if (flat.length) stmt.bind(flat);
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
        get(...params) {
          const flat = params.flat();
          const stmt = raw.prepare(sql);
          if (flat.length) stmt.bind(flat);
          const row = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return row;
        },
        run(...params) {
          const flat = params.flat();
          if (flat.length) raw.run(sql, flat);
          else raw.run(sql);
          const meta = raw.exec('SELECT last_insert_rowid() AS id, changes() AS c');
          const row  = meta[0]?.values[0] || [0, 0];
          persist();
          return { lastInsertRowid: row[0], changes: row[1] };
        }
      };
    }
  };
}

async function init() {
  if (_db) return _db;
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: f => path.join(__dirname, '../node_modules/sql.js/dist/', f)
  });
  const raw = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  _db = wrap(raw);

  const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS accounting (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL, note TEXT DEFAULT '', date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE INDEX IF NOT EXISTS idx_accounting_date ON accounting(date)`,
    `CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'pending', due_date TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS fitness (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, duration INTEGER DEFAULT 0, calories INTEGER DEFAULT 0, note TEXT DEFAULT '', date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE INDEX IF NOT EXISTS idx_fitness_date ON fitness(date)`,
    `CREATE TABLE IF NOT EXISTS investments (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT DEFAULT 'stock', shares REAL DEFAULT 0, avg_cost REAL DEFAULT 0, current_price REAL DEFAULT 0, note TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS investment_txns (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, action TEXT NOT NULL, shares REAL NOT NULL, price REAL NOT NULL, total REAL NOT NULL, date TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS ai_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS line_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, status TEXT DEFAULT 'sent', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS telegram_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, status TEXT DEFAULT 'sent', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS travel_visited (id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT NOT NULL, region_id TEXT NOT NULL, region_name TEXT NOT NULL, visited_at TEXT DEFAULT (datetime('now','localtime')), UNIQUE(country, region_id))`,
    `CREATE TABLE IF NOT EXISTS travel_geojson (country TEXT NOT NULL PRIMARY KEY, geojson TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS nav_order (sec TEXT NOT NULL PRIMARY KEY, position INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS assets_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, unit TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'TWD', amount REAL DEFAULT 0, category TEXT DEFAULT '現金', sort_order INTEGER DEFAULT 0, note TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS assets_rates (currency TEXT NOT NULL PRIMARY KEY, rate REAL NOT NULL DEFAULT 1, updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS assets_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, total_twd REAL NOT NULL, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS travel_trips (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, destination TEXT DEFAULT '', start_date TEXT, end_date TEXT, status TEXT DEFAULT 'planning', transportation TEXT DEFAULT '', accommodation TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS travel_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, day_offset INTEGER DEFAULT 1, time_slot TEXT DEFAULT '', title TEXT NOT NULL, description TEXT DEFAULT '', type TEXT DEFAULT 'activity', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS travel_checklist (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL, item TEXT NOT NULL, checked INTEGER DEFAULT 0, category TEXT DEFAULT '其他', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS travel_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER, title TEXT NOT NULL, content TEXT DEFAULT '', date TEXT, tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS travel_weekly_schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, week_date TEXT NOT NULL, return_date TEXT, week_type TEXT DEFAULT '大', location TEXT DEFAULT '', transportation TEXT DEFAULT '', tickets TEXT DEFAULT '', accommodation TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS investment_yearly_pnl (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL UNIQUE, realized_pnl REAL DEFAULT 0, unrealized_pnl REAL DEFAULT 0, dividend_income REAL DEFAULT 0, tax_paid REAL DEFAULT 0, note TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS psn_cache (username TEXT NOT NULL PRIMARY KEY, profile_data TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS work_jira_config (id INTEGER PRIMARY KEY AUTOINCREMENT, base_url TEXT NOT NULL, email TEXT NOT NULL, api_token TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS encrypted_files (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER DEFAULT 0, content_encrypted TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL, is_binary INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS investment_settings (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now','localtime')))`,
    `CREATE TABLE IF NOT EXISTS work_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT DEFAULT '其他', name TEXT NOT NULL, username TEXT DEFAULT '', password TEXT DEFAULT '', url TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))`
  ];
  SCHEMA.forEach(s => { try { raw.run(s); } catch(e) { console.error('[DB]', e.message); } });

  // ── migrations ──
  try { raw.run(`ALTER TABLE investments ADD COLUMN market TEXT DEFAULT 'tw'`); } catch(e) { /* already exists */ }
  try { raw.run(`CREATE TABLE IF NOT EXISTS tw_shorts (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL UNIQUE, name TEXT DEFAULT '', short_shares REAL DEFAULT 0, avg_sell_price REAL DEFAULT 0, current_price REAL DEFAULT 0, note TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now','localtime')))`); } catch(e) { /* already exists */ }
  try { raw.run(`CREATE TABLE IF NOT EXISTS forex (id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, base_currency TEXT NOT NULL, quote_currency TEXT NOT NULL, amount REAL DEFAULT 0, entry_rate REAL DEFAULT 0, current_rate REAL DEFAULT 0, date TEXT NOT NULL, note TEXT DEFAULT '', status TEXT DEFAULT 'open', created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))`); } catch(e) { /* already exists */ }
  try { raw.run(`ALTER TABLE investments ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch(e) { /* already exists */ }
  try { raw.run(`ALTER TABLE tw_shorts ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch(e) { /* already exists */ }
  try { raw.run(`ALTER TABLE investments ADD COLUMN exchange TEXT DEFAULT ''`); } catch(e) { /* already exists */ }
  try { raw.run(`CREATE TABLE IF NOT EXISTS psn_auth (id INTEGER PRIMARY KEY AUTOINCREMENT, access_token TEXT NOT NULL, refresh_token TEXT DEFAULT '', expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime')))`); } catch(e) { /* already exists */ }

  _db.persist();
  console.log('\u2713 SQLite (sql.js) \u5df2\u8f09\u5165: ' + DB_PATH);
  return _db;
}

module.exports = { init, get() { return _db; } };
