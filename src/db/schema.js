const path = require('path');
const fs   = require('fs');
const { app } = require('electron');

function getDbPath() {
  return app
    ? path.join(app.getPath('userData'), 'oeg_hr.db')
    : path.join(__dirname, '../../oeg_hr.db');
}

function getWasmPath() {
  if (app) {
    const wasmInAsar = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules/sql.js/dist/sql-wasm.wasm'
    );
    if (fs.existsSync(wasmInAsar)) return wasmInAsar;
  }
  return path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
}

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: () => getWasmPath() });

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let db;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS crew (
    opus_no TEXT PRIMARY KEY, vessel TEXT NOT NULL DEFAULT '',
    name_chn TEXT NOT NULL DEFAULT '', name_eng TEXT NOT NULL DEFAULT '',
    rank TEXT NOT NULL DEFAULT '', basic_salary REAL NOT NULL DEFAULT 0,
    day_rate REAL NOT NULL DEFAULT 0, sail_bonus_d REAL NOT NULL DEFAULT 0,
    sail_bonus_n REAL NOT NULL DEFAULT 0, hourly_rate REAL NOT NULL DEFAULT 0,
    food_per_day REAL NOT NULL DEFAULT 300, transport REAL NOT NULL DEFAULT 2980,
    ot_rate REAL NOT NULL DEFAULT 0, pos_allowance REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    remind_date TEXT NOT NULL DEFAULT '', remind_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS month_config (
    month_key TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL,
    total_days INTEGER NOT NULL,
    vlk_onhire INTEGER NOT NULL DEFAULT 0, vlk_offhire INTEGER NOT NULL DEFAULT 0,
    wtn_onhire INTEGER NOT NULL DEFAULT 0, wtn_offhire INTEGER NOT NULL DEFAULT 0,
    vln_onhire INTEGER NOT NULL DEFAULT 0, vln_offhire INTEGER NOT NULL DEFAULT 0,
    wyf_onhire INTEGER NOT NULL DEFAULT 0, wyf_offhire INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  const dayCols = Array.from({length:31},(_,i)=>`d${String(i+1).padStart(2,'0')} TEXT DEFAULT ''`).join(',');
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL, opus_no TEXT NOT NULL, vessel TEXT NOT NULL,
    ${dayCols},
    ot_hours REAL NOT NULL DEFAULT 0, tt_hours REAL NOT NULL DEFAULT 0,
    adjust REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(month_key, opus_no, vessel)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS salary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL, opus_no TEXT NOT NULL, vessel TEXT NOT NULL,
    name_chn TEXT NOT NULL DEFAULT '', name_eng TEXT NOT NULL DEFAULT '',
    rank TEXT NOT NULL DEFAULT '',
    basic_salary REAL NOT NULL DEFAULT 0, monthly_salary REAL NOT NULL DEFAULT 0,
    sail_bonus_d REAL NOT NULL DEFAULT 0, sail_bonus_n REAL NOT NULL DEFAULT 0,
    sail_bonus REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL DEFAULT 0,
    ot_amount REAL NOT NULL DEFAULT 0, tt_amount REAL NOT NULL DEFAULT 0,
    food_amount REAL NOT NULL DEFAULT 0, transport REAL NOT NULL DEFAULT 0,
    pos_allowance REAL NOT NULL DEFAULT 0, total_salary REAL NOT NULL DEFAULT 0,
    working_bonus REAL NOT NULL DEFAULT 0, other_bonus REAL NOT NULL DEFAULT 0,
    pay_leave REAL NOT NULL DEFAULT 0, training REAL NOT NULL DEFAULT 0,
    other_items REAL NOT NULL DEFAULT 0, jiaicaijin REAL NOT NULL DEFAULT 0,
    gross_pay REAL NOT NULL DEFAULT 0,
    cnt_x INTEGER NOT NULL DEFAULT 0, cnt_d INTEGER NOT NULL DEFAULT 0,
    cnt_n INTEGER NOT NULL DEFAULT 0, cnt_r INTEGER NOT NULL DEFAULT 0,
    cnt_rd INTEGER NOT NULL DEFAULT 0, cnt_rn INTEGER NOT NULL DEFAULT 0,
    ot_hours REAL NOT NULL DEFAULT 0, tt_hours REAL NOT NULL DEFAULT 0,
    calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(month_key, opus_no, vessel)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS salary_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month_key TEXT NOT NULL, opus_no TEXT NOT NULL,
    vessels TEXT NOT NULL DEFAULT '', name_chn TEXT NOT NULL DEFAULT '',
    name_eng TEXT NOT NULL DEFAULT '', rank TEXT NOT NULL DEFAULT '',
    basic_salary REAL NOT NULL DEFAULT 0, monthly_salary REAL NOT NULL DEFAULT 0,
    sail_bonus_d REAL NOT NULL DEFAULT 0, sail_bonus_n REAL NOT NULL DEFAULT 0,
    sail_bonus REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL DEFAULT 0,
    ot_amount REAL NOT NULL DEFAULT 0, tt_amount REAL NOT NULL DEFAULT 0,
    food_amount REAL NOT NULL DEFAULT 0, transport REAL NOT NULL DEFAULT 0,
    pos_allowance REAL NOT NULL DEFAULT 0, total_salary REAL NOT NULL DEFAULT 0,
    gross_pay REAL NOT NULL DEFAULT 0,
    calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(month_key, opus_no)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sys_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS import_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, filename TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  try { db.run(`ALTER TABLE crew ADD COLUMN remind_date TEXT NOT NULL DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE crew ADD COLUMN remind_note TEXT NOT NULL DEFAULT ''`); } catch(e) {}

  return wrapDb(db, dbPath);
}

function wrapDb(sqlDb, dbPath) {
  function toObjects(result) {
    if (!result || !result.columns) return [];
    return result.values.map(row => {
      const obj = {};
      result.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  function toPositional(sql, params) {
    if (!params || Array.isArray(params)) return { sql, values: params || [] };
    const matches = sql.match(/@\w+/g) || [];
    const values = matches.map(m => {
      const k = m.slice(1);
      return params[k] !== undefined ? params[k] : null;
    });
    return { sql: sql.replace(/@\w+/g, '?'), values };
  }

  const wrapped = {
    _db: sqlDb,
    _path: dbPath,
    pragma() {},

    prepare(sql) {
      return {
        run(params) {
          const { sql: s, values } = toPositional(sql, params);
          sqlDb.run(s, values);
          wrapped.save();
        },
        get(params) {
          const input = Array.isArray(params) ? params : (params !== undefined ? params : {});
          const { sql: s, values } = toPositional(sql, input);
          const res = sqlDb.exec(s, values);
          return toObjects(res[0])[0] || null;
        },
        all(params) {
          const input = Array.isArray(params) ? params : (params !== undefined ? params : {});
          const { sql: s, values } = toPositional(sql, input);
          const res = sqlDb.exec(s, values);
          return toObjects(res[0]);
        },
      };
    },

    run(sql, params) {
      sqlDb.run(sql, params);
      wrapped.save();
    },

    exec(sql) {
      sqlDb.run(sql);
      wrapped.save();
    },

    transaction(fn) {
      return function(args) {
        sqlDb.run('BEGIN');
        try { fn(args); sqlDb.run('COMMIT'); wrapped.save(); }
        catch (e) { sqlDb.run('ROLLBACK'); throw e; }
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
  };

  return wrapped;
}

module.exports = { initDB, getDbPath };
