// ============================================================
// OEG Fleet HR — db-handler.js
// 所有資料庫操作 + 薪資計算核心邏輯
// ============================================================

const { writeLog } = require('./diag-handler');

let _db = null;

function setDb(db) {
  _db = db;
}

function getDb() {
  if (!_db) throw new Error('資料庫尚未初始化');
  return _db;
}

// ════════════════════════════════════════════════════════════════
// 船員主檔 CRUD
// ════════════════════════════════════════════════════════════════

function getCrew() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM crew ORDER BY vessel, rank, name_chn
  `).all();
  return { ok: true, crew: rows };
}

function saveCrew(data) {
  const db = getDb();

  // 衍生欄位自動計算
  const basicSalary  = Number(data.basic_salary)  || 0;
  const dayRate      = basicSalary > 0 ? Math.round(basicSalary / 15) : 0;
  const hourlyRate   = dayRate > 0 ? Math.round((dayRate / 12) * 100) / 100 : 0;

  const row = {
    opus_no:       data.opus_no,
    vessel:        data.vessel        || '',
    name_chn:      data.name_chn      || '',
    name_eng:      data.name_eng      || '',
    rank:          data.rank          || '',
    basic_salary:  basicSalary,
    day_rate:      dayRate,
    sail_bonus_d:  Number(data.sail_bonus_d)  || 0,
    sail_bonus_n:  Number(data.sail_bonus_n)  || 0,
    hourly_rate:   hourlyRate,
    food_per_day:  Number(data.food_per_day)  || 300,
    transport:     Number(data.transport)      || 2980,
    ot_rate:       hourlyRate,
    pos_allowance: Number(data.pos_allowance) || 0,
    active:        data.active !== false ? 1 : 0,
    updated_at:    now(),
  };

  const exists = db.prepare('SELECT opus_no FROM crew WHERE opus_no = ?').get(row.opus_no);

  if (exists) {
    db.prepare(`
      UPDATE crew SET
        vessel = @vessel, name_chn = @name_chn, name_eng = @name_eng,
        rank = @rank, basic_salary = @basic_salary, day_rate = @day_rate,
        sail_bonus_d = @sail_bonus_d, sail_bonus_n = @sail_bonus_n,
        hourly_rate = @hourly_rate, food_per_day = @food_per_day,
        transport = @transport, ot_rate = @ot_rate,
        pos_allowance = @pos_allowance, active = @active,
        updated_at = @updated_at
      WHERE opus_no = @opus_no
    `).run(row);
  } else {
    db.prepare(`
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
    `).run(row);
  }

  writeLog('saveCrew', `${row.opus_no} ${row.name_chn}`);
  return { ok: true };
}

function deleteCrew(opus_no) {
  const db = getDb();
  db.prepare('DELETE FROM crew WHERE opus_no = ?').run(opus_no);
  writeLog('deleteCrew', opus_no);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// 月份設定
// ════════════════════════════════════════════════════════════════

function getMonthConfig(year, month) {
  const db = getDb();
  const key = monthKey(year, month);
  const row = db.prepare('SELECT * FROM month_config WHERE month_key = ?').get(key);
  return { ok: true, config: row || null };
}

function saveMonthConfig(data) {
  const db = getDb();
  const { year, month } = data;
  const key = monthKey(year, month);
  const totalDays = daysInMonth(year, month);

  const row = {
    month_key:  key,
    year:       Number(year),
    month:      Number(month),
    total_days: totalDays,
    vlk_offhire: Number(data.vlk_offhire) || 0,
    wtn_offhire: Number(data.wtn_offhire) || 0,
    vln_offhire: Number(data.vln_offhire) || 0,
    wyf_offhire: Number(data.wyf_offhire) || 0,
    updated_at:  now(),
  };

  row.vlk_onhire = totalDays - row.vlk_offhire;
  row.wtn_onhire = totalDays - row.wtn_offhire;
  row.vln_onhire = totalDays - row.vln_offhire;
  row.wyf_onhire = totalDays - row.wyf_offhire;

  const exists = db.prepare('SELECT month_key FROM month_config WHERE month_key = ?').get(key);

  if (exists) {
    db.prepare(`
      UPDATE month_config SET
        total_days = @total_days,
        vlk_onhire = @vlk_onhire, vlk_offhire = @vlk_offhire,
        wtn_onhire = @wtn_onhire, wtn_offhire = @wtn_offhire,
        vln_onhire = @vln_onhire, vln_offhire = @vln_offhire,
        wyf_onhire = @wyf_onhire, wyf_offhire = @wyf_offhire,
        updated_at = @updated_at
      WHERE month_key = @month_key
    `).run(row);
  } else {
    db.prepare(`
      INSERT INTO month_config (
        month_key, year, month, total_days,
        vlk_onhire, vlk_offhire, wtn_onhire, wtn_offhire,
        vln_onhire, vln_offhire, wyf_onhire, wyf_offhire,
        updated_at
      ) VALUES (
        @month_key, @year, @month, @total_days,
        @vlk_onhire, @vlk_offhire, @wtn_onhire, @wtn_offhire,
        @vln_onhire, @vln_offhire, @wyf_onhire, @wyf_offhire,
        @updated_at
      )
    `).run(row);
  }

  writeLog('saveMonthConfig', key);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// 出勤記錄
// ════════════════════════════════════════════════════════════════

function getAttendance(year, month, vessel) {
  const db = getDb();
  const key = monthKey(year, month);
  const rows = vessel
    ? db.prepare('SELECT * FROM attendance WHERE month_key = ? AND vessel = ?').all(key, vessel)
    : db.prepare('SELECT * FROM attendance WHERE month_key = ?').all(key);

  // 把 d01~d31 整理成 days 陣列方便前端使用
  const records = rows.map(r => ({
    ...r,
    days: Array.from({ length: 31 }, (_, i) => r[`d${String(i + 1).padStart(2, '0')}`] || ''),
  }));

  return { ok: true, records };
}

function saveAttendance(data) {
  const db = getDb();
  const key = monthKey(data.year, data.month);

  // 把 days 陣列拆回 d01~d31 欄位
  const dayFields = {};
  const days = data.days || [];
  for (let i = 0; i < 31; i++) {
    dayFields[`d${String(i + 1).padStart(2, '0')}`] = days[i] || '';
  }

  const row = {
    month_key: key,
    opus_no:   data.opus_no,
    vessel:    data.vessel,
    ot_hours:  Number(data.ot_hours) || 0,
    tt_hours:  Number(data.tt_hours) || 0,
    adjust:    Number(data.adjust)   || 0,
    updated_at: now(),
    ...dayFields,
  };

  const exists = db.prepare(`
    SELECT id FROM attendance WHERE month_key = ? AND opus_no = ? AND vessel = ?
  `).get(key, data.opus_no, data.vessel);

  if (exists) {
    // 動態產生 UPDATE SET 子句
    const setCols = [
      ...Array.from({ length: 31 }, (_, i) => `d${String(i + 1).padStart(2, '0')} = @d${String(i + 1).padStart(2, '0')}`),
      'ot_hours = @ot_hours',
      'tt_hours = @tt_hours',
      'adjust = @adjust',
      'updated_at = @updated_at',
    ].join(', ');
    db.prepare(`
      UPDATE attendance SET ${setCols}
      WHERE month_key = @month_key AND opus_no = @opus_no AND vessel = @vessel
    `).run(row);
  } else {
    const dayCols = Array.from({ length: 31 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`);
    db.prepare(`
      INSERT INTO attendance (
        month_key, opus_no, vessel,
        ${dayCols.join(', ')},
        ot_hours, tt_hours, adjust, updated_at
      ) VALUES (
        @month_key, @opus_no, @vessel,
        ${dayCols.map(c => `@${c}`).join(', ')},
        @ot_hours, @tt_hours, @adjust, @updated_at
      )
    `).run(row);
  }

  writeLog('saveAttendance', `${key} ${data.opus_no} ${data.vessel}`);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// 薪資計算核心
// ════════════════════════════════════════════════════════════════

function calcSalary(year, month) {
  const db = getDb();
  const key = monthKey(year, month);

  // 讀取月份設定
  const cfg = db.prepare('SELECT * FROM month_config WHERE month_key = ?').get(key);
  if (!cfg) throw new Error(`找不到 ${key} 月份設定，請先設定各船出海天數`);

  // 各船保底天數對照
  const guarantee = {
    Valkyrie: Math.round(cfg.vlk_onhire / 5),
    Wotan:    Math.round(cfg.wtn_onhire / 5),
    Valiant:  Math.round(cfg.vln_onhire / 5),
    WayFeng:  Math.round(cfg.wyf_onhire / 5),
  };

  // 讀取船員主檔（建立 map）
  const crewRows = db.prepare('SELECT * FROM crew WHERE active = 1').all();
  const crewMap = {};
  crewRows.forEach(c => { crewMap[c.opus_no] = c; });

  // 讀取出勤記錄
  const attRows = db.prepare('SELECT * FROM attendance WHERE month_key = ?').all(key);

  if (!attRows.length) throw new Error(`找不到 ${key} 的出勤記錄，請先輸入出勤資料`);

  // 清除本月舊計算結果
  db.prepare('DELETE FROM salary WHERE month_key = ?').run(key);
  db.prepare('DELETE FROM salary_summary WHERE month_key = ?').run(key);

  const results = [];

  for (const att of attRows) {
    const c = crewMap[att.opus_no];
    if (!c) continue; // 找不到主檔就跳過

    // 取出31天出勤碼
    const days = Array.from({ length: 31 }, (_, i) => att[`d${String(i + 1).padStart(2, '0')}`] || '');

    // 出勤統計
    const cntX  = days.filter(d => d === 'X').length;
    const cntD  = days.filter(d => d === 'D').length;
    const cntN  = days.filter(d => d === 'N').length;
    const cntR  = days.filter(d => d === 'R').length;
    const cntRD = days.filter(d => d === 'R/D').length;
    const cntRN = days.filter(d => d === 'R/N').length;

    const totalDuty   = cntX + cntD + cntN;       // 出勤天數（不含休假）
    const totalAttend = totalDuty + cntR;           // 含休假天數（用於伙食）

    // A. 月薪按比例
    const basicSalary   = Number(c.basic_salary) || 0;
    const monthlySalary = basicSalary > 0
      ? Math.round((basicSalary / 15) * totalAttend)
      : 0;

    // C. 出海獎金（含保底邏輯）
    const g        = guarantee[att.vessel] || 0;
    const sailD    = Number(c.sail_bonus_d) || 0;
    const sailN    = Number(c.sail_bonus_n) || 0;
    const actualD  = cntD + cntRD;
    const actualN  = cntN + cntRN;

    const actualAmt   = actualD * sailD + actualN * sailN;
    const guaranteeAmt = g * sailD;

    let sailBonus = 0;
    if (actualAmt < guaranteeAmt) {
      // 未達保底：日班單價補差額
      sailBonus = guaranteeAmt + (actualN * (sailN - sailD));
    } else {
      sailBonus = actualAmt;
    }
    sailBonus += Number(att.adjust) || 0;

    const sailBonusDay   = actualD * sailD;
    const sailBonusNight = actualN * sailN;

    // D. 小計
    const subtotal = monthlySalary + sailBonus;

    // F. 加班費（ROUNDUP）
    const otAmount = Math.ceil((Number(c.ot_rate) || 0) * (att.ot_hours || 0));

    // G. 交通時間費（ROUNDUP）
    const ttAmount = Math.ceil((Number(c.ot_rate) || 0) * (att.tt_hours || 0));

    // H. 伙食津貼
    const foodAmount = (Number(c.food_per_day) || 300) * totalAttend;

    // I. 交通津貼（固定）
    const transport = Number(c.transport) || 2980;

    // J. 職位加給
    const posAllowance = Number(c.pos_allowance) || 0;

    // Total Salary
    const totalSalary = subtotal + otAmount + ttAmount + foodAmount + transport + posAllowance;

    // Gross Pay（手動項目預設為 0，HR 事後在明細表填入）
    const grossPay = totalSalary;

    results.push({
      month_key:      key,
      opus_no:        att.opus_no,
      vessel:         att.vessel,
      name_chn:       c.name_chn,
      name_eng:       c.name_eng,
      rank:           c.rank,
      basic_salary:   basicSalary,
      monthly_salary: monthlySalary,
      sail_bonus_d:   sailBonusDay,
      sail_bonus_n:   sailBonusNight,
      sail_bonus:     sailBonus,
      subtotal,
      ot_amount:      otAmount,
      tt_amount:      ttAmount,
      food_amount:    foodAmount,
      transport,
      pos_allowance:  posAllowance,
      total_salary:   totalSalary,
      working_bonus:  0,
      other_bonus:    0,
      pay_leave:      0,
      training:       0,
      other_items:    0,
      jiaicaijin:     0,
      gross_pay:      grossPay,
      cnt_x:          cntX,
      cnt_d:          cntD,
      cnt_n:          cntN,
      cnt_r:          cntR,
      cnt_rd:         cntRD,
      cnt_rn:         cntRN,
      ot_hours:       att.ot_hours || 0,
      tt_hours:       att.tt_hours || 0,
      calculated_at:  now(),
    });
  }

  // 批次寫入薪資結果
  const insertSalary = db.prepare(`
    INSERT INTO salary (
      month_key, opus_no, vessel, name_chn, name_eng, rank,
      basic_salary, monthly_salary, sail_bonus_d, sail_bonus_n, sail_bonus,
      subtotal, ot_amount, tt_amount, food_amount, transport, pos_allowance,
      total_salary, working_bonus, other_bonus, pay_leave, training,
      other_items, jiaicaijin, gross_pay,
      cnt_x, cnt_d, cnt_n, cnt_r, cnt_rd, cnt_rn,
      ot_hours, tt_hours, calculated_at
    ) VALUES (
      @month_key, @opus_no, @vessel, @name_chn, @name_eng, @rank,
      @basic_salary, @monthly_salary, @sail_bonus_d, @sail_bonus_n, @sail_bonus,
      @subtotal, @ot_amount, @tt_amount, @food_amount, @transport, @pos_allowance,
      @total_salary, @working_bonus, @other_bonus, @pay_leave, @training,
      @other_items, @jiaicaijin, @gross_pay,
      @cnt_x, @cnt_d, @cnt_n, @cnt_r, @cnt_rd, @cnt_rn,
      @ot_hours, @tt_hours, @calculated_at
    )
  `);

  const insertMany = db.transaction(rows => {
    for (const r of rows) insertSalary.run(r);
  });
  insertMany(results);

  // 產生個人月薪總表（跨船合計）
  buildSummary(key, results);

  writeLog('calcSalary', `${key} 共 ${results.length} 筆`);
  return { ok: true, count: results.length };
}

// 跨船合計：同一個 opus_no 的多船記錄加總成一列
function buildSummary(key, results) {
  const db = getDb();
  const map = {};

  for (const r of results) {
    if (!map[r.opus_no]) {
      map[r.opus_no] = {
        month_key:      key,
        opus_no:        r.opus_no,
        vessels:        [],
        name_chn:       r.name_chn,
        name_eng:       r.name_eng,
        rank:           r.rank,
        basic_salary:   0,
        monthly_salary: 0,
        sail_bonus_d:   0,
        sail_bonus_n:   0,
        sail_bonus:     0,
        subtotal:       0,
        ot_amount:      0,
        tt_amount:      0,
        food_amount:    0,
        transport:      0,
        pos_allowance:  0,
        total_salary:   0,
        gross_pay:      0,
        calculated_at:  now(),
      };
    }
    const m = map[r.opus_no];
    m.vessels.push(r.vessel);
    m.basic_salary   += r.basic_salary;
    m.monthly_salary += r.monthly_salary;
    m.sail_bonus_d   += r.sail_bonus_d;
    m.sail_bonus_n   += r.sail_bonus_n;
    m.sail_bonus     += r.sail_bonus;
    m.subtotal       += r.subtotal;
    m.ot_amount      += r.ot_amount;
    m.tt_amount      += r.tt_amount;
    m.food_amount    += r.food_amount;
    m.transport      += r.transport;
    m.pos_allowance  += r.pos_allowance;
    m.total_salary   += r.total_salary;
    m.gross_pay      += r.gross_pay;
  }

  const insertSummary = db.prepare(`
    INSERT INTO salary_summary (
      month_key, opus_no, vessels, name_chn, name_eng, rank,
      basic_salary, monthly_salary, sail_bonus_d, sail_bonus_n, sail_bonus,
      subtotal, ot_amount, tt_amount, food_amount, transport, pos_allowance,
      total_salary, gross_pay, calculated_at
    ) VALUES (
      @month_key, @opus_no, @vessels, @name_chn, @name_eng, @rank,
      @basic_salary, @monthly_salary, @sail_bonus_d, @sail_bonus_n, @sail_bonus,
      @subtotal, @ot_amount, @tt_amount, @food_amount, @transport, @pos_allowance,
      @total_salary, @gross_pay, @calculated_at
    )
  `);

  const insertMany = db.transaction(rows => {
    for (const r of rows) insertSummary.run(r);
  });

  const summaryRows = Object.values(map).map(m => ({
    ...m,
    vessels: m.vessels.join(' / '),
  }));

  insertMany(summaryRows);
}

// ════════════════════════════════════════════════════════════════
// 查詢
// ════════════════════════════════════════════════════════════════

function getSalary(year, month, vessel) {
  const db = getDb();
  const key = monthKey(year, month);
  const rows = vessel
    ? db.prepare('SELECT * FROM salary WHERE month_key = ? AND vessel = ? ORDER BY vessel, rank, name_chn').all(key, vessel)
    : db.prepare('SELECT * FROM salary WHERE month_key = ? ORDER BY vessel, rank, name_chn').all(key);
  return { ok: true, data: rows };
}

function getSummary(year, month) {
  const db = getDb();
  const key = monthKey(year, month);
  const rows = db.prepare('SELECT * FROM salary_summary WHERE month_key = ? ORDER BY name_chn').all(key);
  return { ok: true, data: rows };
}

// 更新手動薪資項目（working_bonus, other_bonus, pay_leave, training, other_items, jiaicaijin）
function updateManualItems(data) {
  const db = getDb();
  const key = monthKey(data.year, data.month);

  const manualSum = (Number(data.working_bonus)  || 0)
                  + (Number(data.other_bonus)     || 0)
                  + (Number(data.pay_leave)        || 0)
                  + (Number(data.training)         || 0)
                  + (Number(data.other_items)      || 0)
                  + (Number(data.jiaicaijin)       || 0);

  // 重算 gross_pay
  const base = db.prepare(`
    SELECT total_salary FROM salary
    WHERE month_key = ? AND opus_no = ? AND vessel = ?
  `).get(key, data.opus_no, data.vessel);

  if (!base) return { ok: false, error: '找不到薪資記錄' };

  const grossPay = base.total_salary + manualSum;

  db.prepare(`
    UPDATE salary SET
      working_bonus = @working_bonus,
      other_bonus   = @other_bonus,
      pay_leave     = @pay_leave,
      training      = @training,
      other_items   = @other_items,
      jiaicaijin    = @jiaicaijin,
      gross_pay     = @gross_pay
    WHERE month_key = @month_key AND opus_no = @opus_no AND vessel = @vessel
  `).run({
    month_key:     key,
    opus_no:       data.opus_no,
    vessel:        data.vessel,
    working_bonus: Number(data.working_bonus)  || 0,
    other_bonus:   Number(data.other_bonus)    || 0,
    pay_leave:     Number(data.pay_leave)       || 0,
    training:      Number(data.training)        || 0,
    other_items:   Number(data.other_items)     || 0,
    jiaicaijin:    Number(data.jiaicaijin)      || 0,
    gross_pay:     grossPay,
  });

  // 同步更新 salary_summary 的 gross_pay（重新加總）
  const allSalary = db.prepare(`
    SELECT SUM(gross_pay) as total FROM salary
    WHERE month_key = ? AND opus_no = ?
  `).get(key, data.opus_no);

  db.prepare(`
    UPDATE salary_summary SET gross_pay = ?
    WHERE month_key = ? AND opus_no = ?
  `).run(allSalary.total, key, data.opus_no);

  writeLog('updateManualItems', `${key} ${data.opus_no}`);
  return { ok: true, gross_pay: grossPay };
}

// 報表
function getReport(year, month) {
  const db = getDb();
  const key = monthKey(year, month);

  const vessels = ['Valkyrie', 'Wotan', 'Valiant', 'WayFeng'];
  const allData = db.prepare('SELECT * FROM salary WHERE month_key = ?').all(key);

  const byVessel = vessels.map(v => {
    const rows = allData.filter(r => r.vessel === v);
    return {
      vessel:       v,
      headcount:    rows.length,
      total_salary: rows.reduce((s, r) => s + (r.total_salary || 0), 0),
      gross_pay:    rows.reduce((s, r) => s + (r.gross_pay    || 0), 0),
    };
  });

  const summary = db.prepare('SELECT * FROM salary_summary WHERE month_key = ? ORDER BY name_chn').all(key);

  return { ok: true, byVessel, byCrew: summary };
}

// ════════════════════════════════════════════════════════════════
// 工具函式
// ════════════════════════════════════════════════════════════════

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function now() {
  return new Date().toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

module.exports = {
  setDb,
  getCrew, saveCrew, deleteCrew,
  getMonthConfig, saveMonthConfig,
  getAttendance, saveAttendance,
  calcSalary, getSalary, getSummary,
  updateManualItems, getReport,
};

// ── 晉升/轉正提醒查詢 ─────────────────────────────────────────
function getReminders(daysAhead = 30) {
  const db = getDb();
  const today = new Date();
  const limit = new Date();
  limit.setDate(today.getDate() + daysAhead);

  const todayStr = today.toISOString().slice(0, 10);
  const limitStr = limit.toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT opus_no, vessel, name_chn, name_eng, rank,
           remind_date, remind_note
    FROM crew
    WHERE active = 1
      AND remind_date != ''
      AND remind_date >= ?
      AND remind_date <= ?
    ORDER BY remind_date ASC
  `).all(todayStr, limitStr);

  return { ok: true, reminders: rows };
}

module.exports = {
  ...module.exports,
  getReminders,
};
