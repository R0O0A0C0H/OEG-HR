// ============================================================
// OEG Fleet HR — diag-handler.js
// 系統日誌寫入 + 診斷日誌匯出
// ============================================================

const path = require('path');
const fs   = require('fs');

let _db = null;

function setDb(db) {
  _db = db;
}

function writeLog(action, detail = '') {
  try {
    if (!_db) return;
    _db.prepare(`
      INSERT INTO sys_log (action, detail, created_at)
      VALUES (?, ?, datetime('now','localtime'))
    `).run(action, detail);
  } catch (e) {
    // 日誌失敗不中斷主流程
    console.error('[diag] writeLog error:', e.message);
  }
}

function getLogs(limit = 500) {
  if (!_db) return { ok: false, error: '資料庫未初始化' };
  const rows = _db.prepare(`
    SELECT * FROM sys_log ORDER BY id DESC LIMIT ?
  `).all(limit);
  return { ok: true, logs: rows };
}

function exportLog(targetPath) {
  try {
    if (!_db) return { ok: false, error: '資料庫未初始化' };

    const rows = _db.prepare(`
      SELECT created_at, action, detail FROM sys_log ORDER BY id ASC
    `).all();

    const lines = [
      '====================================================',
      'OEG Fleet HR System — 診斷日誌',
      `匯出時間：${new Date().toLocaleString('zh-TW')}`,
      `總筆數：${rows.length}`,
      '====================================================',
      '',
      ...rows.map(r => `[${r.created_at}] ${r.action.padEnd(20)} ${r.detail}`),
      '',
      '====================================================',
      '日誌結束',
    ];

    fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8');
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function clearLogs() {
  if (!_db) return { ok: false, error: '資料庫未初始化' };
  _db.prepare('DELETE FROM sys_log').run();
  writeLog('clearLogs', '日誌已清除');
  return { ok: true };
}

module.exports = { setDb, writeLog, getLogs, exportLog, clearLogs };
