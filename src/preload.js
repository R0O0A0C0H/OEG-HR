// ============================================================
// OEG Fleet HR — preload.js
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // 船員主檔
  getCrew:    ()     => ipcRenderer.invoke('crew:get'),
  saveCrew:   (data) => ipcRenderer.invoke('crew:save', data),
  deleteCrew: (opus) => ipcRenderer.invoke('crew:delete', opus),

  // 月份設定
  getMonthConfig:  (year, month) => ipcRenderer.invoke('month:get', year, month),
  saveMonthConfig: (data)        => ipcRenderer.invoke('month:save', data),

  // 出勤記錄
  getAttendance:  (year, month, vessel) => ipcRenderer.invoke('att:get', year, month, vessel),
  saveAttendance: (data)                => ipcRenderer.invoke('att:save', data),

  // 薪資計算
  calcSalary:    (year, month)         => ipcRenderer.invoke('salary:calc', year, month),
  getSalary:     (year, month, vessel) => ipcRenderer.invoke('salary:get', year, month, vessel),
  getSalSummary: (year, month)         => ipcRenderer.invoke('salary:summary', year, month),
  updateManual:  (data)                => ipcRenderer.invoke('salary:updateManual', data),
  getReport:     (year, month)         => ipcRenderer.invoke('salary:report', year, month),

  // 提醒
  getReminders: (days) => ipcRenderer.invoke('remind:get', days),

  // 備份
  backupDb:      () => ipcRenderer.invoke('backup:do'),
  restoreDb:     () => ipcRenderer.invoke('backup:restore'),
  getLastBackup: () => ipcRenderer.invoke('backup:lastTime'),

  // 診斷
  getLogs:   () => ipcRenderer.invoke('diag:getLogs'),
  exportLog: () => ipcRenderer.invoke('diag:export'),
  clearLogs: () => ipcRenderer.invoke('diag:clear'),

  // 匯入
  previewCrewImport:  ()      => ipcRenderer.invoke('import:previewCrew'),
  confirmCrewImport:  (items) => ipcRenderer.invoke('import:confirmCrew', items),
  importAttendance:   ()      => ipcRenderer.invoke('import:attendance'),
  importDb:           ()      => ipcRenderer.invoke('import:db'),

  // 匯出
  exportCrewTemplate: ()                     => ipcRenderer.invoke('export:crewTemplate'),
  exportAttendance:   (year, month, vessel)  => ipcRenderer.invoke('export:attendance', year, month, vessel),
  exportPBC:          (year, month)          => ipcRenderer.invoke('export:pbc', year, month),

  // 系統
  getVersion: () => ipcRenderer.invoke('app:version'),
  getDbPath:  () => ipcRenderer.invoke('app:dbPath'),

  // 主程序推播
  onOpenBackupPage: (cb) => ipcRenderer.on('open-backup-page', cb),
});
