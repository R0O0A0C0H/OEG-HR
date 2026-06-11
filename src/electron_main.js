// ============================================================
// OEG Fleet HR — electron_main.js v3
// 改用 sql.js（純 JS，不需要 native 編譯）
// ============================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const { initDB, getDbPath }  = require('./db/schema');
const db_handler     = require('./handlers/db-handler');
const diag_handler   = require('./handlers/diag-handler');
const backup_handler = require('./handlers/backup-handler');
const import_handler = require('./handlers/import-handler');
const export_handler = require('./handlers/export-handler');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 1024, minHeight: 680,
    title: 'OEG Fleet HR System',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (e) => {
    if (backup_handler.shouldRemindBackup()) {
      e.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'warning', title: '備份提醒',
        message: '距離上次備份已超過 7 天',
        detail: '建議在關閉前備份資料到 USB 或行動硬碟。',
        buttons: ['立即備份', '忽略並關閉'], defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) mainWindow.webContents.send('open-backup-page');
        else mainWindow.destroy();
      });
    }
  });
}

app.whenReady().then(async () => {
  createWindow();
  try {
    const db = await initDB();
    db_handler.setDb(db);
    diag_handler.setDb(db);
    backup_handler.setDbPath(getDbPath());
    import_handler.setDb(db);
    import_handler.setDbPath(getDbPath());
    export_handler.setDb(db);
    diag_handler.writeLog('app_start', `v${app.getVersion()}`);
    mainWindow.show();
    mainWindow.webContents.send('db-ready');
  } catch (e) {
    dialog.showErrorBox('資料庫初始化失敗', e.message);
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return fn(...args); }
    catch (e) {
      diag_handler.writeLog('ERROR:' + channel, e.message);
      return { ok: false, error: e.message };
    }
  });
}

handle('crew:get',    ()     => db_handler.getCrew());
handle('crew:save',   (data) => db_handler.saveCrew(data));
handle('crew:delete', (opus) => db_handler.deleteCrew(opus));
handle('month:get',  (y, m) => db_handler.getMonthConfig(y, m));
handle('month:save', (data) => db_handler.saveMonthConfig(data));
handle('att:get',  (y, m, v) => db_handler.getAttendance(y, m, v));
handle('att:save', (data)    => db_handler.saveAttendance(data));
handle('salary:calc',         (y, m)    => db_handler.calcSalary(y, m));
handle('salary:get',          (y, m, v) => db_handler.getSalary(y, m, v));
handle('salary:summary',      (y, m)    => db_handler.getSummary(y, m));
handle('salary:updateManual', (data)    => db_handler.updateManualItems(data));
handle('salary:report',       (y, m)    => db_handler.getReport(y, m));
handle('remind:get', (days) => db_handler.getReminders(days));

handle('backup:do', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: '選擇備份目標資料夾', properties: ['openDirectory'] });
  if (!filePaths?.length) return { ok: false, error: '取消' };
  return backup_handler.backupDb(filePaths[0]);
});
handle('backup:restore', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: '選擇備份檔', filters: [{ name: 'SQLite DB', extensions: ['db'] }], properties: ['openFile'] });
  if (!filePaths?.length) return { ok: false, error: '取消' };
  return backup_handler.restoreDb(filePaths[0]);
});
handle('backup:lastTime', () => ({ ok: true, time: backup_handler.getLastBackupTime() }));
handle('diag:getLogs', () => diag_handler.getLogs(500));
handle('diag:export', async () => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { title: '匯出診斷日誌', defaultPath: `oeg_hr_diag_${new Date().toISOString().slice(0,10)}.log`, filters: [{ name: 'Log', extensions: ['log'] }] });
  if (!filePath) return { ok: false, error: '取消' };
  return diag_handler.exportLog(filePath);
});
handle('diag:clear', () => diag_handler.clearLogs());

handle('import:previewCrew', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: '選擇船員資料 Excel', filters: [{ name: 'Excel', extensions: ['xlsx','xls'] }], properties: ['openFile'] });
  if (!filePaths?.length) return { ok: false, error: '取消' };
  return import_handler.previewCrewImport(filePaths[0]);
});
handle('import:confirmCrew', (items) => import_handler.confirmCrewImport(items));
handle('import:attendance', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: '選擇工時表 Excel', filters: [{ name: 'Excel', extensions: ['xlsx','xls'] }], properties: ['openFile'] });
  if (!filePaths?.length) return { ok: false, error: '取消' };
  return import_handler.importAttendance(filePaths[0]);
});
handle('import:db', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: '選擇 .db 檔案', filters: [{ name: 'SQLite DB', extensions: ['db'] }], properties: ['openFile'] });
  if (!filePaths?.length) return { ok: false, error: '取消' };
  return import_handler.importDb(filePaths[0]);
});

handle('export:crewTemplate', async () => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { title: '匯出船員範本', defaultPath: `OEG_船員資料_${new Date().toISOString().slice(0,10)}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (!filePath) return { ok: false, error: '取消' };
  return export_handler.exportCrewTemplate(filePath);
});
handle('export:attendance', async (y, m, v) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { title: '匯出工時表', defaultPath: `OEG_工時表_${v}_${y}-${String(m).padStart(2,'0')}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (!filePath) return { ok: false, error: '取消' };
  return export_handler.exportAttendanceSheet(y, m, v, filePath);
});
handle('export:pbc', async (y, m) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, { title: '匯出 PBC', defaultPath: `OEG_PBC_${y}-${String(m).padStart(2,'0')}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (!filePath) return { ok: false, error: '取消' };
  return export_handler.exportPBC(y, m, filePath);
});

handle('app:version', () => ({ ok: true, version: app.getVersion() }));
handle('app:dbPath',  () => ({ ok: true, path: getDbPath() }));
