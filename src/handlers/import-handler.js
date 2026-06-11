// ============================================================
// OEG Fleet HR — import-handler.js
// 處理所有匯入：Excel 船員資料、Excel 工時表、.db 還原
// ============================================================

const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { writeLog } = require('./diag-handler');

let _db = null;
let _dbPath = null;

function setDb(db)       { _db = db; }
function setDbPath(p)    { _dbPath = p; }

// ════════════════════════════════════════════════════════════════
// 預覽 Excel 船員資料（匯入前比對）
// ════════════════════════════════════════════════════════════════
function previewCrewImport(filePath) {
  try {
    const wb   = XLSX.readFile(filePath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) return { ok: false, error: 'Excel 檔案沒有資料' };

    // 讀取現有船員
    const existing = _db.prepare('SELECT * FROM crew').all();
    const existMap = {};
    existing.forEach(c => { existMap[c.opus_no] = c; });

    const preview = rows.map(r => {
      const opus = String(r['OPUS編號'] || r['opus_no'] || '').trim();
      if (!opus) return null;

      const incoming = {
        opus_no:       opus,
        vessel:        String(r['船別'] || r['vessel'] || '').trim(),
        name_chn:      String(r['中文姓名'] || r['name_chn'] || '').trim(),
        name_eng:      String(r['英文姓名'] || r['name_eng'] || '').trim(),
        rank:          String(r['職級'] || r['rank'] || '').trim(),
        basic_salary:  Number(r['基本月薪'] || r['basic_salary'] || 0),
        sail_bonus_d:  Number(r['出海獎金日班'] || r['sail_bonus_d'] || 0),
        sail_bonus_n:  Number(r['出海獎金夜班'] || r['sail_bonus_n'] || 0),
        food_per_day:  Number(r['伙食天'] || r['food_per_day'] || 300),
        transport:     Number(r['交通津貼'] || r['transport'] || 2980),
        pos_allowance: Number(r['職位加給'] || r['pos_allowance'] || 0),
        active:        String(r['狀態'] || r['active'] || '在職').trim() !== '離職' ? 1 : 0,
      };

      const old = existMap[opus];
      let status = 'new'; // new / duplicate / resigned_conflict

      if (old) {
        if (old.active === 0) {
          status = 'resigned_conflict'; // 舊資料是離職
        } else {
          status = 'duplicate';
        }
      }

      return { incoming, old: old || null, status };
    }).filter(Boolean);

    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
// 確認匯入船員（選擇要匯入的項目）
// ════════════════════════════════════════════════════════════════
function confirmCrewImport(items) {
  // items: [{ opus_no, action }] action = 'import' | 'skip'
  try {
    let imported = 0, skipped = 0;

    const upsert = _db.prepare(`
      INSERT INTO crew (
        opus_no, vessel, name_chn, name_eng, rank,
        basic_salary, day_rate, sail_bonus_d, sail_bonus_n,
        hourly_rate, food_per_day, transport, ot_rate,
        pos_allowance, active, updated_at
      ) VALUES (
        @opus_no, @vessel, @name_chn, @name_eng, @rank,
        @basic_salary, @day_rate, @sail_bonus_d, @sail_bonus_n,
        @hourly_rate, @food_per_day, @transport, @ot_rate,
        @pos_allowance, @active, @updated_at
      )
      ON CONFLICT(opus_no) DO UPDATE SET
        vessel = @vessel, name_chn = @name_chn, name_eng = @name_eng,
        rank = @rank, basic_salary = @basic_salary, day_rate = @day_rate,
        sail_bonus_d = @sail_bonus_d, sail_bonus_n = @sail_bonus_n,
        hourly_rate = @hourly_rate, food_per_day = @food_per_day,
        transport = @transport, ot_rate = @ot_rate,
        pos_allowance = @pos_allowance, active = @active,
        updated_at = @updated_at
    `);

    const run = _db.transaction(() => {
      for (const item of items) {
        if (item.action !== 'import') { skipped++; continue; }
        const d = item.data;
        const dayRate    = d.basic_salary > 0 ? Math.round(d.basic_salary / 15) : 0;
        const hourlyRate = dayRate > 0 ? Math.round((dayRate / 12) * 100) / 100 : 0;
        upsert.run({
          ...d,
          day_rate:    dayRate,
          hourly_rate: hourlyRate,
          ot_rate:     hourlyRate,
          updated_at:  new Date().toLocaleString('zh-TW'),
        });
        imported++;
      }
    });

    run();

    // 記錄匯入日誌
    _db.prepare(`
      INSERT INTO import_log (type, total, imported, skipped)
      VALUES ('crew', ?, ?, ?)
    `).run(items.length, imported, skipped);

    writeLog('importCrew', `匯入 ${imported} 筆，跳過 ${skipped} 筆`);
    return { ok: true, imported, skipped };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
// 匯入工時表 Excel（系統自己的格式）
// ════════════════════════════════════════════════════════════════
function importAttendance(filePath) {
  try {
    const wb   = XLSX.readFile(filePath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) return { ok: false, error: '工時表沒有資料' };

    // 讀取表頭資訊（第一欄應有 month_key 和 vessel）
    const meta = wb.Sheets[wb.SheetNames[0]]['A1']?.v || '';
    // 格式：2026-06|Valkyrie
    const [monthKey, vessel] = String(meta).split('|');
    if (!monthKey || !vessel) return { ok: false, error: '工時表格式錯誤，請使用系統匯出的範本' };

    const DAY_COLS = Array.from({ length: 31 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`);

    const upsert = _db.prepare(`
      INSERT INTO attendance (
        month_key, opus_no, vessel,
        ${DAY_COLS.join(', ')},
        ot_hours, tt_hours, adjust, updated_at
      ) VALUES (
        @month_key, @opus_no, @vessel,
        ${DAY_COLS.map(c => `@${c}`).join(', ')},
        @ot_hours, @tt_hours, @adjust, @updated_at
      )
      ON CONFLICT(month_key, opus_no, vessel) DO UPDATE SET
        ${DAY_COLS.map(c => `${c} = @${c}`).join(', ')},
        ot_hours = @ot_hours, tt_hours = @tt_hours,
        adjust = @adjust, updated_at = @updated_at
    `);

    let count = 0;
    const run = _db.transaction(() => {
      for (const r of rows) {
        const opus = String(r['OPUS'] || r['opus_no'] || '').trim();
        if (!opus || opus === 'OPUS') continue;

        const dayFields = {};
        for (let i = 0; i < 31; i++) {
          const key = `d${String(i + 1).padStart(2, '0')}`;
          const val = String(r[`Day${i + 1}`] || r[key] || '').trim().toUpperCase();
          // 驗證合法代碼
          dayFields[key] = ['X','D','N','R','R/D','R/N'].includes(val) ? val : '';
        }

        upsert.run({
          month_key: monthKey.trim(),
          opus_no:   opus,
          vessel:    vessel.trim(),
          ...dayFields,
          ot_hours:  Number(r['OT'] || r['ot_hours'] || 0),
          tt_hours:  Number(r['TT'] || r['tt_hours'] || 0),
          adjust:    Number(r['Adjust'] || r['adjust'] || 0),
          updated_at: new Date().toLocaleString('zh-TW'),
        });
        count++;
      }
    });
    run();

    writeLog('importAttendance', `${monthKey} ${vessel} 共 ${count} 筆`);
    return { ok: true, count, monthKey: monthKey.trim(), vessel: vessel.trim() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
// 匯入 .db（換電腦：取代現有資料庫）
// ════════════════════════════════════════════════════════════════
function importDb(sourcePath) {
  try {
    if (!_dbPath) return { ok: false, error: '找不到資料庫路徑' };
    if (!fs.existsSync(sourcePath)) return { ok: false, error: '找不到來源 .db 檔案' };

    // 先備份現有 db
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeCopy = _dbPath.replace('.db', `_before_import_${ts}.db`);
    if (fs.existsSync(_dbPath)) fs.copyFileSync(_dbPath, safeCopy);

    // 覆蓋
    fs.copyFileSync(sourcePath, _dbPath);

    writeLog('importDb', sourcePath);
    return { ok: true, message: '資料庫已取代，請重新啟動系統以套用新資料' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  setDb, setDbPath,
  previewCrewImport, confirmCrewImport,
  importAttendance, importDb,
};
