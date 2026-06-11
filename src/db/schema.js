// ============================================================
// OEG Fleet HR — schema.js
// 使用 sql.js（純 JavaScript SQLite，不需要 native 編譯）
// ============================================================

const path = require('path');
const fs   = require('fs');
const { app } = require('electron');

function getDbPath() {
  return app
    ? path.join(app.getPath('userData'), 'oeg_hr.db')
    : path.join(__dirname, '../../oeg_hr.db');
}

// sql.js 的 wasm 檔案路徑（打包後在 asarUnpack 裡）
function getWasmPath() {
  if (app) {
    // 打包後的路徑
    const wasmInAsar = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules/sql.js/dist/sql-wasm.wasm'
    );
    if (fs.existsSync(wasmInAsar)) return wasmInAsar;
  }
  // 開發模式
  return path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
}

async function initDB() {
  const initSqlJs = require('sql.js');
  const wasmPath  = getWasmPath();
  const SQL       = await initSqlJs({ locateFile: () => wasmPath });

  const dbPath = getDbPath();
  const dir    = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 載入或建立 DB
  let db;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // 建立資料表
  db.run(`PRAGMA foreign_keys = ON`);

  db.run(`
    CREATE TABLE IF NOT EXISTS crew (
      opus_no       TEXT PRIMARY KEY,
      vessel        TEXT NOT NULL DEFAULT '',
      name_chn      TEXT NOT NULL DEFAULT '',
      name_eng      TEXT NOT NULL DEFAULT '',
      rank          TEXT NOT NULL DEFAULT '',
      basic_salary  REAL NOT NULL DEFAULT 0,
      day_rate      REAL NOT NULL DEFAULT 0,
      sail_bonus_d  REAL NOT NULL DEFAULT 0,
      sail_bonus_n  REAL NOT NULL DEFAULT 0,
      hourly_rate   REAL NOT NULL DEFAULT 0,
      food_per_day  REAL NOT NULL DEFAULT 300,
      transport     REAL NOT NULL DEFAULT 2980,
      ot_rate       REAL NOT NULL DEFAULT 0,
      pos_allowance REAL NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1,
      remind_date   TEXT NOT NULL DEFAULT '',
      remind_note   TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS month_config (
      month_key   TEXT PRIMARY KEY,
      year        INTEGER NOT NULL,
      month       INTEGER NOT NULL,
      total_days  INTEGER NOT NULL,
      vlk_onhire  INTEGER NOT NULL DEFAULT 0,
      vlk_offhire INTEGER NOT NULL DEFAULT 0,
      wtn_onhire  INTEGER NOT NULL DEFAULT 0,
      wtn_offhire INTEGER NOT NULL DEFAULT 0,
      vln_onhire  INTEGER NOT NULL DEFAULT 0,
      vln_offhire INTEGER NOT NULL DEFAULT 0,
      wyf_onhire  INTEGER NOT NULL DEFAULT 0,
      wyf_offhire INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  const dayCols = Array.from({length:31}, (_,i) => `d${String(i+1).padStart(2,'0')} TEXT DEFAULT ''`).join(',\n      ');
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key TEXT NOT NULL,
      opus_no   TEXT NOT NULL,
      vessel    TEXT NOT NULL,
      ${dayCols},
      ot_hours  REAL NOT NULL DEFAULT 0,
      tt_hours  REAL NOT NULL DEFAULT 0,
      adjust    REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(month_key, opus_no, vessel)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS salary (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key      TEXT NOT NULL,
      opus_no        TEXT NOT NULL,
      vessel         TEXT NOT NULL,
      name_chn       TEXT NOT NULL DEFAULT '',
      name_eng       TEXT NOT NULL DEFAULT '',
      rank           TEXT NOT NULL DEFAULT '',
      basic_salary   REAL NOT NULL DEFAULT 0,
      monthly_salary REAL NOT NULL DEFAULT 0,
      sail_bonus_d   REAL NOT NULL DEFAULT 0,
      sail_bonus_n   REAL NOT NULL DEFAULT 0,
      sail_bonus     REAL NOT NULL DEFAULT 0,
      subtotal       REAL NOT NULL DEFAULT 0,
      ot_amount      REAL NOT NULL DEFAULT 0,
      tt_amount      REAL NOT NULL DEFAULT 0,
      food_amount    REAL NOT NULL DEFAULT 0,
      transport      REAL NOT NULL DEFAULT 0,
      pos_allowance  REAL NOT NULL DEFAULT 0,
      total_salary   REAL NOT NULL DEFAULT 0,
      working_bonus  REAL NOT NULL DEFAULT 0,
      other_bonus    REAL NOT NULL DEFAULT 0,
      pay_leave      REAL NOT NULL DEFAULT 0,
      training       REAL NOT NULL DEFAULT 0,
      other_items    REAL NOT NULL DEFAULT 0,
      jiaicaijin     REAL NOT NULL DEFAULT 0,
      gross_pay      REAL NOT NULL DEFAULT 0,
      cnt_x  INTEGER NOT NULL DEFAULT 0,
      cnt_d  INTEGER NOT NULL DEFAULT 0,
      cnt_n  INTEGER NOT NULL DEFAULT 0,
      cnt_r  INTEGER NOT NULL DEFAULT 0,
      cnt_rd INTEGER NOT NULL DEFAULT 0,
      cnt_rn INTEGER NOT NULL DEFAULT 0,
      ot_hours REAL NOT NULL DEFAULT 0,
      tt_hours REAL NOT NULL DEFAULT 0,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(month_key, opus_no, vessel)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS salary_summary (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      month_key      TEXT NOT NULL,
      opus_no        TEXT NOT NULL,
      vessels        TEXT NOT NULL DEFAULT '',
      name_chn       TEXT NOT NULL DEFAULT '',
      name_eng       TEXT NOT NULL DEFAULT '',
      rank           TEXT NOT NULL DEFAULT '',
      basic_salary   REAL NOT NULL DEFAULT 0,
      monthly_salary REAL NOT NULL DEFAULT 0,
      sail_bonus_d   REAL NOT NULL DEFAULT 0,
      sail_bonus_n   REAL NOT NULL DEFAULT 0,
      sail_bonus     REAL NOT NULL DEFAULT 0,
      subtotal       REAL NOT NULL DEFAULT 0,
      ot_amount      REAL NOT NULL DEFAULT 0,
      tt_amount      REAL NOT NULL DEFAULT 0,
      food_amount    REAL NOT NULL DEFAULT 0,
      transport      REAL NOT NULL DEFAULT 0,
      pos_allowance  REAL NOT NULL DEFAULT 0,
      total_salary   REAL NOT NULL DEFAULT 0,
      gross_pay      REAL NOT NULL DEFAULT 0,
      calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(month_key, opus_no)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sys_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS import_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,
      filename   TEXT NOT NULL DEFAULT '',
      total      INTEGER NOT NULL DEFAULT 0,
      imported   INTEGER NOT NULL DEFAULT 0,
      skipped    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // 自動升版：補欄位
  try { db.run(`ALTER TABLE crew ADD COLUMN remind_date TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.run(`ALTER TABLE crew ADD COLUMN remind_note TEXT NOT NULL DEFAULT ''`); } catch {}

  // 包裝成類 better-sqlite3 介面，方便其他 handler 使用
  return wrapDb(db, dbPath);
}

// ── 把 sql.js 的 API 包裝成同步介面 ────────────────────────────
function wrapDb(sqlDb, dbPath) {
  // sql.js 本身就是同步的，只是 API 不同
  // 把它包成跟 better-sqlite3 一樣的介面

  function toObjects(result) {
    if (!result || !result.columns || !result.values) return [];
    return result.values.map(row => {
      const obj = {};
      result.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  const wrapped = {
    _db: sqlDb,
    _path: dbPath,

    prepare(sql) {
      return {
        run(params) {
          try {
            sqlDb.run(sql, params && typeof params === 'object' && !Array.isArray(params)
              ? toNamedParams(sql, params) : params);
            wrapped.save();
          } catch (e) { throw e; }
        },
        get(...args) {
          const p = args[0];
          const res = sqlDb.exec(sql, Array.isArray(p) ? p : (p !== undefined ? [p] : []));
          const rows = toObjects(res[0]);
          return rows[0] || null;
        },
        all(...args) {
          const p = args[0];
          const params = Array.isArray(p) ? p : (p !== undefined ? [p] : []);
          const res = sqlDb.exec(sql, params);
          return toObjects(res[0]);
        },
      };
    },

    exec(sql) {
      sqlDb.run(sql);
      wrapped.save();
    },

    run(sql, params) {
      sqlDb.run(sql, params);
      wrapped.save();
    },

    transaction(fn) {
      return function(args) {
        sqlDb.run('BEGIN');
        try {
          fn(args);
          sqlDb.run('COMMIT');
          wrapped.save();
        } catch (e) {
          sqlDb.run('ROLLBACK');
          throw e;
        }
      };
    },

    save() {
      try {
        const data = sqlDb.export();
        fs.writeFileSync(dbPath, Buffer.from(data));
      } catch (e) {
        console.error('[db] save error:', e.message);
      }
    },

    pragma() {}, // sql.js 不需要
  };

  // 處理具名參數（@param → ?）
  function toNamedParams(sql, obj) {
    const matches = sql.match(/@\w+/g) || [];
    return matches.map(m => {
      const key = m.slice(1);
      return obj[key] !== undefined ? obj[key] : null;
    });
  }

  // 覆寫 prepare 以支援具名參數
  wrapped.prepare = function(sql) {
    const isNamed = /@\w+/.test(sql);

    return {
      run(params) {
        try {
          if (isNamed && params && typeof params === 'object' && !Array.isArray(params)) {
            const positionalSql = sql.replace(/@\w+/g, '?');
            const matches = sql.match(/@\w+/g) || [];
            const values  = matches.map(m => {
              const key = m.slice(1);
              return params[key] !== undefined ? params[key] : null;
            });
            sqlDb.run(positionalSql, values);
          } else {
            sqlDb.run(sql, params);
          }
          wrapped.save();
        } catch (e) { throw e; }
      },

      get(...args) {
        try {
          let positionalSql = sql, values = [];
          const p = args[0];
          if (isNamed && p && typeof p === 'object' && !Array.isArray(p)) {
            positionalSql = sql.replace(/@\w+/g, '?');
            const matches = sql.match(/@\w+/g) || [];
            values = matches.map(m => { const k = m.slice(1); return p[k] !== undefined ? p[k] : null; });
          } else {
            values = Array.isArray(p) ? p : (p !== undefined ? [p] : []);
          }
          const res = sqlDb.exec(positionalSql, values);
          return toObjects(res[0])[0] || null;
        } catch { return null; }
      },

      all(...args) {
        try {
          let positionalSql = sql, values = [];
          const p = args[0];
          if (isNamed && p && typeof p === 'object' && !Array.isArray(p)) {
            positionalSql = sql.replace(/@\w+/g, '?');
            const matches = sql.match(/@\w+/g) || [];
            values = matches.map(m => { const k = m.slice(1); return p[k] !== undefined ? p[k] : null; });
          } else {
            values = Array.isArray(p) ? p : (p !== undefined ? [p] : []);
          }
          const res = sqlDb.exec(positionalSql, values);
          return toObjects(res[0]);
        } catch { return []; }
      },
    };
  };

  return wrapped;
}

module.exports = { initDB, getDbPath };
