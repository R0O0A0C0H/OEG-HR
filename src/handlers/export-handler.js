// ============================================================
// OEG Fleet HR — export-handler.js
// 所有 Excel 匯出：工時表、船員範本、PBC 報表
// ============================================================

const XLSX = require('xlsx');
const path = require('path');
const { writeLog } = require('./diag-handler');

let _db = null;
function setDb(db) { _db = db; }

// ════════════════════════════════════════════════════════════════
// 匯出船員資料範本（給 HR 填寫後匯入）
// ════════════════════════════════════════════════════════════════
function exportCrewTemplate(targetPath) {
  try {
    const headers = [
      'OPUS編號','船別','中文姓名','英文姓名','職級',
      '基本月薪','出海獎金日班','出海獎金夜班',
      '伙食天','交通津貼','職位加給','狀態'
    ];

    // 現有船員資料一起帶出，方便對照
    const crew = _db.prepare('SELECT * FROM crew ORDER BY vessel, rank').all();
    const dataRows = crew.map(c => [
      c.opus_no, c.vessel, c.name_chn, c.name_eng, c.rank,
      c.basic_salary, c.sail_bonus_d, c.sail_bonus_n,
      c.food_per_day, c.transport, c.pos_allowance,
      c.active ? '在職' : '離職'
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

    // 欄位寬度
    ws['!cols'] = [
      {wch:10},{wch:10},{wch:12},{wch:20},{wch:8},
      {wch:12},{wch:14},{wch:14},{wch:10},{wch:10},{wch:10},{wch:8}
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '船員資料');
    XLSX.writeFile(wb, targetPath);

    writeLog('exportCrewTemplate', targetPath);
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
// 匯出工時表（系統格式，給船員填寫後匯回）
// ════════════════════════════════════════════════════════════════
function exportAttendanceSheet(year, month, vessel, targetPath) {
  try {
    const monthKey  = `${year}-${String(month).padStart(2, '0')}`;
    const totalDays = new Date(year, month, 0).getDate();

    // 取得該船在職船員
    const crew = _db.prepare(`
      SELECT * FROM crew WHERE vessel = ? AND active = 1
      ORDER BY rank, name_chn
    `).all(vessel);

    if (!crew.length) return { ok: false, error: `${vessel} 沒有在職船員` };

    // 取得已有出勤記錄
    const attRows = _db.prepare(`
      SELECT * FROM attendance WHERE month_key = ? AND vessel = ?
    `).all(monthKey, vessel);
    const attMap = {};
    attRows.forEach(r => { attMap[r.opus_no] = r; });

    // 標題行
    const dayHeaders = Array.from({ length: 31 }, (_, i) => `Day${i + 1}`);
    const headers = ['OPUS', '中文姓名', '英文姓名', '職級', ...dayHeaders, 'OT', 'TT', 'Adjust'];

    // 說明行
    const noteRow = [
      `${monthKey}|${vessel}`, // A1 存 meta 資訊（匯入時讀取）
      '出勤代碼：X=港內  D=出海日班  N=出海夜班  R=休假  R/D=休假出海日  R/N=休假出海夜',
      '', '',
      ...Array.from({ length: 31 }, (_, i) => i < totalDays ? i + 1 : ''),
      'OT時數', 'TT時數', '調整'
    ];

    // 資料行
    const dataRows = crew.map(c => {
      const att  = attMap[c.opus_no];
      const days = att
        ? Array.from({ length: 31 }, (_, i) => att[`d${String(i + 1).padStart(2, '0')}`] || '')
        : Array(31).fill('');
      return [
        c.opus_no, c.name_chn, c.name_eng, c.rank,
        ...days,
        att ? att.ot_hours : 0,
        att ? att.tt_hours : 0,
        att ? att.adjust   : 0,
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([noteRow, headers, ...dataRows]);

    // 凍結前四欄
    ws['!freeze'] = { xSplit: 4, ySplit: 2 };

    // 欄寬
    ws['!cols'] = [
      {wch:10},{wch:12},{wch:20},{wch:8},
      ...Array(31).fill({wch:5}),
      {wch:8},{wch:8},{wch:8}
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${vessel}_${monthKey}`);
    XLSX.writeFile(wb, targetPath);

    writeLog('exportAttendance', `${monthKey} ${vessel}`);
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
// 匯出 PBC 報表（完整複製原 Excel PBC 工作表格式）
// ════════════════════════════════════════════════════════════════
function exportPBC(year, month, targetPath) {
  try {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const VESSELS  = ['Wotan', 'Valkyrie', 'Valiant', 'WayFeng'];

    // 讀取薪資明細
    const salaryRows = _db.prepare(`
      SELECT * FROM salary WHERE month_key = ?
      ORDER BY vessel, rank, name_chn
    `).all(monthKey);

    if (!salaryRows.length) return { ok: false, error: `找不到 ${monthKey} 的薪資資料，請先執行計算` };

    const wb = XLSX.utils.book_new();

    // ── PBC 工作表 ─────────────────────────────────────────────
    const aoa = [];

    // 第1行：標題
    aoa.push(['Crew Salary Calculation', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

    // 第2-12行：欄位說明（對應原表格多層標題）
    aoa.push(['', 'A.', 'B.', 'C.', '', '', 'D.', 'E.', 'F.', 'G.', 'H.', 'I.', 'J.', 'K.(手動)', 'L.(手動)', 'M.(手動)', 'N.(手動)', 'O.(手動)', 'P.(手動)', '', '']);
    aoa.push(['', '', '', 'Sailing Bonus', '', '', '', '', '', 'Traveling', 'Food', 'T', 'Position', '', '', '', '', '', '', '', '']);
    aoa.push(['', 'Basic', 'Monthly', 'total exceed guaranteed days', '', '', 'subtotal', 'Over', 'Traveling', 'Time', 'Allowance', 'r', 'Allowance', 'Working', 'Other', 'Pay', 'Training', 'Other', '加菜金', '', 'GROSS']);
    aoa.push(['', 'Monthly', 'Salary.', '(ascending sailing days)', '', '', 'Salary', 'Time', 'Time', '', '', 'a', '(Dual', 'Bonus', 'Bonus', 'Leave', 'subsidy', 'Items', '', '', 'PAY.']);
    aoa.push(['', 'Salary in', '', 'Day', 'Night', '', 'incl.', '', '', '', '', 'n', 'Vessel)', '', '(Year End)', '', '', '', '', '', '']);
    aoa.push(['', 'chartered', '', 'Sailing', 'Sailing', '', 'Sailing', '', '', '', '', 's', '', '', '', '', '', '', '', '', '']);
    aoa.push(['', 'period', '', 'Bonus', 'Bonus', '', 'Bonus', '', '', '', '', '.', '', '', '', '', '', '', '', '', '']);
    aoa.push(['', '', '', '', '', 'sum(Total D.1)', '(B+D.1)', '', '', '', '', '', '(E+F+G+H+I+J)', '', '', '', '', '', '', '', '']);
    aoa.push(['', '', '', '', '', 'subtotal Day', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    aoa.push(['', '', '', '', '', 'subtotal Night', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

    // 第13行：欄位標籤
    aoa.push(['Vessel', 'No', 'Rank', 'Name',
      'Basic Monthly Salary', 'Monthly Salary.',
      'Day', 'Night', '出海獎金\n(含出海)',
      'Over Time', 'Traveling Time',
      'Food Allowance', 'Trans.', 'e',
      'Position Allowance\n(Dual Vessel)',
      'Total Salary\nincl. OT.TT.\nFood. Trans.\n(E+F+G+H+I+J)',
      'Working Bonus', 'Other Bonus\n(Year End)', 'Pay Leave', 'Training subsidy', 'Other Items', '加菜金', 'GROSS PAY.'
    ]);

    // 第14行：欄位標籤第二行
    aoa.push(['Vessel', 'No', 'Rank', 'Name',
      'Basic Monthly Salary', 'Monthly Salary.',
      'Day', 'Night', '出海獎金(含出海)',
      'Over Time', 'Traveling Time',
      'Food Allowance', 'Trans.', 'Food Allowance',
      'Position Allowance (Dual Vessel)',
      'Total Salary',
      'Working Bonus', 'Other Bonus', 'Pay Leave', 'Training subsidy', 'Other Items', '加菜金', 'GROSS PAY.'
    ]);

    let rowNum = 14;

    // 各船資料
    const vesselTotals = {};
    VESSELS.forEach(v => {
      vesselTotals[v] = {
        basic: 0, monthly: 0, sailD: 0, sailN: 0, sail: 0,
        ot: 0, tt: 0, food: 0, trans: 0, pos: 0, total: 0,
        wb: 0, ob: 0, pl: 0, tr: 0, oi: 0, jcj: 0, gross: 0
      };
    });

    VESSELS.forEach(vessel => {
      const rows = salaryRows.filter(r => r.vessel === vessel);

      rows.forEach((r, idx) => {
        aoa.push([
          vessel,
          idx + 1,
          r.rank,
          r.name_chn,
          r.basic_salary    || 0,
          r.monthly_salary  || 0,
          r.sail_bonus_d    || 0,
          r.sail_bonus_n    || 0,
          r.sail_bonus      || 0,
          r.ot_amount       || 0,
          r.tt_amount       || 0,
          r.food_amount     || 0,
          r.transport       || 0,
          '',
          r.pos_allowance   || 0,
          r.total_salary    || 0,
          r.working_bonus   || 0,
          r.other_bonus     || 0,
          r.pay_leave       || 0,
          r.training        || 0,
          r.other_items     || 0,
          r.jiaicaijin      || 0,
          r.gross_pay       || 0,
        ]);
        rowNum++;

        // 累計
        const vt = vesselTotals[vessel];
        vt.basic    += r.basic_salary    || 0;
        vt.monthly  += r.monthly_salary  || 0;
        vt.sailD    += r.sail_bonus_d    || 0;
        vt.sailN    += r.sail_bonus_n    || 0;
        vt.sail     += r.sail_bonus      || 0;
        vt.ot       += r.ot_amount       || 0;
        vt.tt       += r.tt_amount       || 0;
        vt.food     += r.food_amount     || 0;
        vt.trans    += r.transport       || 0;
        vt.pos      += r.pos_allowance   || 0;
        vt.total    += r.total_salary    || 0;
        vt.wb       += r.working_bonus   || 0;
        vt.ob       += r.other_bonus     || 0;
        vt.pl       += r.pay_leave       || 0;
        vt.tr       += r.training        || 0;
        vt.oi       += r.other_items     || 0;
        vt.jcj      += r.jiaicaijin      || 0;
        vt.gross    += r.gross_pay       || 0;
      });

      // 空行
      aoa.push([]);
      aoa.push([]);
      rowNum += 2;
    });

    // ── 下半部：各船加總 ──────────────────────────────────────
    aoa.push([]);
    aoa.push(['', '', '', '', '各船薪資合計', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

    // 加總標題
    aoa.push(['Vessel', '', '', '',
      'Basic Monthly Salary', 'Monthly Salary.',
      'Day', 'Night', '出海獎金',
      'Over Time', 'Traveling Time', 'Food', 'Trans.', '',
      'Position Allowance',
      'Total Salary',
      'Working Bonus', 'Other Bonus', 'Pay Leave', 'Training', 'Other', '加菜金', 'GROSS PAY.'
    ]);

    let grandTotal = {
      basic:0, monthly:0, sailD:0, sailN:0, sail:0,
      ot:0, tt:0, food:0, trans:0, pos:0, total:0,
      wb:0, ob:0, pl:0, tr:0, oi:0, jcj:0, gross:0
    };

    VESSELS.forEach(vessel => {
      const vt = vesselTotals[vessel];
      aoa.push([
        vessel, '', '', '',
        vt.basic, vt.monthly, vt.sailD, vt.sailN, vt.sail,
        vt.ot, vt.tt, vt.food, vt.trans, '',
        vt.pos, vt.total,
        vt.wb, vt.ob, vt.pl, vt.tr, vt.oi, vt.jcj, vt.gross
      ]);
      Object.keys(grandTotal).forEach(k => { grandTotal[k] += vt[k] || 0; });
    });

    // 總計行
    aoa.push([
      'Total', '', '', '',
      grandTotal.basic, grandTotal.monthly,
      grandTotal.sailD, grandTotal.sailN, grandTotal.sail,
      grandTotal.ot, grandTotal.tt, grandTotal.food, grandTotal.trans, '',
      grandTotal.pos, grandTotal.total,
      grandTotal.wb, grandTotal.ob, grandTotal.pl, grandTotal.tr,
      grandTotal.oi, grandTotal.jcj, grandTotal.gross
    ]);

    // ── 個人薪資卡片（下方小表格）────────────────────────────
    aoa.push([]);
    aoa.push([]);
    aoa.push(['', '', '', '', '', '', '個人薪資總表（換船合計）']);

    const summaryRows = _db.prepare(`
      SELECT * FROM salary_summary WHERE month_key = ? ORDER BY name_chn
    `).all(monthKey);

    aoa.push(['', 'A.', 'B.', '', 'C.', 'D.', '', 'a', 'b', 'c', 'd', '', '', '', '', 'Gross Pay']);
    aoa.push(['',
      'Basic Monthly Salary',
      'Monthly Salary (incl year-end. rest.)',
      'work on shore',
      'Sailing Bonus (D/N)',
      'Total Sailing bonus (A+B+C)',
      'Subtotal',
      'Over time Amount',
      'Travel time Amount',
      'Food allowance (NTD to HH) per day)',
      'Responsibility Allowance',
      'Total Amount incl. Bonus: OT,TT Food. Bous: (D+a+b+c+d)',
      'Working Bonus',
      'Other Bonus (Year End)',
      'Other Items',
      '船年加班費',
      '(G+b+i+j)'
    ]);

    summaryRows.forEach(r => {
      aoa.push(['',
        r.basic_salary    || 0,
        r.monthly_salary  || 0,
        '',
        r.sail_bonus      || 0,
        r.subtotal        || 0,
        '',
        r.ot_amount       || 0,
        r.tt_amount       || 0,
        r.food_amount     || 0,
        r.transport       || 0,
        r.total_salary    || 0,
        '',
        '',
        '',
        '',
        r.gross_pay       || 0,
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // 欄寬設定
    ws['!cols'] = [
      {wch:10},{wch:4},{wch:8},{wch:14},
      {wch:14},{wch:14},{wch:10},{wch:10},{wch:12},
      {wch:10},{wch:10},{wch:10},{wch:8},{wch:6},
      {wch:14},{wch:14},
      {wch:10},{wch:10},{wch:8},{wch:10},{wch:8},{wch:8},{wch:12}
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'PBC');
    XLSX.writeFile(wb, targetPath);

    writeLog('exportPBC', `${monthKey} → ${targetPath}`);
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  setDb,
  exportCrewTemplate,
  exportAttendanceSheet,
  exportPBC,
};
