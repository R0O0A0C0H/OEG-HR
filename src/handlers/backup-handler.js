// ============================================================
// OEG Fleet HR — backup-handler.js
// 備份 / 還原 SQLite .db 檔案
// ============================================================

const fs   = require('fs');
const path = require('path');
const { writeLog } = require('./diag-handler');

let _dbPath = null;

function setDbPath(p) {
  _dbPath = p;
}

// 備份：把 .db 複製到使用者選擇的目標資料夾
function backupDb(targetDir) {
  try {
    if (!_dbPath) return { ok: false, error: '找不到資料庫路徑' };
    if (!fs.existsSync(_dbPath)) return { ok: false, error: '資料庫檔案不存在' };
    if (!fs.existsSync(targetDir)) return { ok: false, error: '目標資料夾不存在' };

    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `oeg_hr_backup_${ts}.db`;
    const dest     = path.join(targetDir, fileName);

    fs.copyFileSync(_dbPath, dest);

    // 更新最後備份時間
    setLastBackupTime(new Date().toISOString());

    writeLog('backup', dest);
    return { ok: true, path: dest, fileName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 還原：把選擇的 .db 覆蓋回目前的資料庫（需重啟才生效）
function restoreDb(sourcePath) {
  try {
    if (!_dbPath) return { ok: false, error: '找不到資料庫路徑' };
    if (!fs.existsSync(sourcePath)) return { ok: false, error: '備份檔案不存在' };

    // 先把目前的 db 備份一份
    const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeCopy = _dbPath.replace('.db', `_before_restore_${ts}.db`);
    fs.copyFileSync(_dbPath, safeCopy);

    // 覆蓋
    fs.copyFileSync(sourcePath, _dbPath);

    writeLog('restore', sourcePath);
    return { ok: true, message: '還原成功，請重新啟動系統以套用' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 7天提醒：判斷是否超過 7 天未備份
function shouldRemindBackup() {
  const last = getLastBackupTime();
  if (!last) return true; // 從未備份過
  const diff = Date.now() - new Date(last).getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  return days >= 7;
}

// 用簡單的 JSON 檔記錄最後備份時間（存在 db 同目錄）
function getLastBackupTime() {
  try {
    const metaPath = getMetaPath();
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return meta.lastBackup || null;
  } catch {
    return null;
  }
}

function setLastBackupTime(isoStr) {
  try {
    const metaPath = getMetaPath();
    const meta = fs.existsSync(metaPath)
      ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      : {};
    meta.lastBackup = isoStr;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch (e) {
    console.error('[backup] setLastBackupTime error:', e.message);
  }
}

function getMetaPath() {
  if (!_dbPath) throw new Error('dbPath 未設定');
  return _dbPath.replace('.db', '_meta.json');
}

module.exports = {
  setDbPath,
  backupDb,
  restoreDb,
  shouldRemindBackup,
  getLastBackupTime,
};
