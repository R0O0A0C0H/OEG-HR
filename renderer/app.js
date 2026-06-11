// ============================================================
// OEG Fleet HR — app.js
// 前端邏輯：呼叫 window.electronAPI，渲染各頁面
// ============================================================

const api = window.electronAPI;

// ── State ───────────────────────────────────────────────────
const S = {
  crew: [],
  attDays: Array(31).fill(''),
  attCurrent: null, // { opus_no, vessel, year, month, totalDays }
};

const ATT_CODES = ['', 'X', 'D', 'N', 'R', 'R/D', 'R/N'];

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  initYearSelects();
  initMonthConfigForm();
  loadDashboard();
  loadCrewData();

  const ver = await api.getVersion();
  if (ver.ok) document.getElementById('app-version').textContent = 'v' + ver.version;

  const dbp = await api.getDbPath();
  if (dbp.ok) {
    document.getElementById('db-path-label').textContent = dbp.path;
    document.getElementById('db-path-display').textContent = dbp.path;
  }

  // 備份提醒觸發
  api.onOpenBackupPage(() => goPage('backup'));

  // Sidebar nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => goPage(el.dataset.page));
  });
});

// ════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════
function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (nav) nav.classList.add('active');

  if (name === 'dashboard') loadDashboard();
  if (name === 'backup')    loadBackupInfo();
  if (name === 'diag')      loadLogs();
}

// ════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function fmt(n) {
  const v = Number(n) || 0;
  return v === 0 ? '—' : Math.round(v).toLocaleString();
}

function vBadge(v) {
  const map = { Valkyrie:'b-vlk', Wotan:'b-wtn', Valiant:'b-vln', WayFeng:'b-wyf' };
  return `<span class="badge ${map[v]||''}">${v||'—'}</span>`;
}

function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function initYearSelects() {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  ['mc-year','att-year','sal-year'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let i = y - 1; i <= y + 1; i++) {
      el.insertAdjacentHTML('beforeend', `<option value="${i}" ${i===y?'selected':''}>${i}年</option>`);
    }
  });
  ['att-month','sal-month','mc-month'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = m;
  });
}

// ════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════
async function loadDashboard() {
  const now = new Date();
  document.getElementById('dash-period').textContent = `${now.getFullYear()}年${now.getMonth()+1}月`;

  const crew = S.crew.length ? S.crew : (await loadCrewData());
  const active = crew.filter(c => c.active === 1);
  document.getElementById('ds-crew').textContent = active.length;

  const yr = now.getFullYear(), mo = now.getMonth() + 1;
  const [salRes, sumRes] = await Promise.all([
    api.getSalary(yr, mo, ''),
    api.getSalSummary(yr, mo),
  ]);

  document.getElementById('ds-att').textContent = salRes.ok ? salRes.data.length : '—';
  document.getElementById('ds-sal').textContent = sumRes.ok ? sumRes.data.length : '—';
  if (salRes.ok) {
    const total = salRes.data.reduce((s, r) => s + (r.gross_pay || 0), 0);
    document.getElementById('ds-total').textContent = total > 0 ? Math.round(total).toLocaleString() : '—';
  }

  // 各船分布
  const vm = {};
  active.forEach(c => { vm[c.vessel] = (vm[c.vessel]||0) + 1; });
  document.getElementById('dash-vessels').innerHTML = ['Valkyrie','Wotan','Valiant','WayFeng'].map(v =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-light)">
      <span>${vBadge(v)}</span><strong>${vm[v]||0} 人</strong>
    </div>`
  ).join('');

  // 職級分布
  const rm = {};
  active.forEach(c => { rm[c.rank] = (rm[c.rank]||0) + 1; });
  document.getElementById('dash-ranks').innerHTML = Object.entries(rm).sort((a,b)=>b[1]-a[1]).map(([r,n]) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-light)">
      <span class="badge" style="background:var(--sea-pale);color:var(--sea)">${r}</span><strong>${n} 人</strong>
    </div>`
  ).join('');
}

// ════════════════════════════════════════════════════════════
// CREW
// ════════════════════════════════════════════════════════════
async function loadCrewData() {
  const res = await api.getCrew();
  if (res.ok) { S.crew = res.crew; renderCrew(); return res.crew; }
  toast(res.error, 'error');
  return [];
}

function renderCrew() {
  const vessel = document.getElementById('crew-f-vessel').value;
  const rank   = document.getElementById('crew-f-rank').value;
  const search = (document.getElementById('crew-search').value || '').toLowerCase();

  let rows = S.crew.filter(c => {
    if (vessel && c.vessel !== vessel) return false;
    if (rank   && c.rank   !== rank)   return false;
    if (search && !c.name_chn.toLowerCase().includes(search) &&
        !c.name_eng.toLowerCase().includes(search) &&
        !c.opus_no.toLowerCase().includes(search)) return false;
    return true;
  });

  if (!rows.length) {
    document.getElementById('crew-table').innerHTML =
      `<div class="empty-state"><div class="empty-icon">👤</div><div class="empty-title">沒有符合的船員</div></div>`;
    return;
  }

  document.getElementById('crew-table').innerHTML = `
    <table>
      <thead><tr>
        <th>OPUS</th><th>姓名</th><th>船別</th><th>職級</th>
        <th class="td-num">基本月薪</th><th class="td-num">出海獎金(日/夜)</th>
        <th class="td-num">時薪</th><th>狀態</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${rows.map(c => `
          <tr>
            <td class="td-muted">${c.opus_no}</td>
            <td><div style="font-weight:500">${c.name_chn}</div><div style="font-size:11px;color:var(--text-light)">${c.name_eng}</div></td>
            <td>${vBadge(c.vessel)}</td>
            <td><span class="badge" style="background:var(--sea-pale);color:var(--sea)">${c.rank}</span></td>
            <td class="td-num">${fmt(c.basic_salary)}</td>
            <td class="td-num">${fmt(c.sail_bonus_d)} / ${fmt(c.sail_bonus_n)}</td>
            <td class="td-num">${Number(c.hourly_rate||0).toFixed(1)}</td>
            <td><span class="badge ${c.active?'b-active':'b-inactive'}">${c.active?'在職':'離職'}</span></td>
            <td><button class="btn-icon btn-sm" onclick='openCrewModal(${JSON.stringify(c)})'>✏</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function openCrewModal(crew) {
  const isNew = !crew;
  document.getElementById('crew-modal-title').textContent = isNew ? '新增船員' : '編輯船員';
  document.getElementById('fm-opus').value   = isNew ? '' : crew.opus_no;
  document.getElementById('fm-chn').value    = isNew ? '' : crew.name_chn;
  document.getElementById('fm-eng').value    = isNew ? '' : crew.name_eng;
  document.getElementById('fm-vessel').value = isNew ? '' : crew.vessel;
  document.getElementById('fm-rank').value   = isNew ? '' : crew.rank;
  document.getElementById('fm-salary').value = isNew ? '' : crew.basic_salary;
  document.getElementById('fm-sailD').value  = isNew ? '' : crew.sail_bonus_d;
  document.getElementById('fm-sailN').value  = isNew ? '' : crew.sail_bonus_n;
  document.getElementById('fm-food').value   = isNew ? 300  : crew.food_per_day;
  document.getElementById('fm-trans').value  = isNew ? 2980 : crew.transport;
  document.getElementById('fm-pos').value    = isNew ? 0    : crew.pos_allowance;
  document.getElementById('fm-active').value = isNew ? '1'  : String(crew.active);
  document.getElementById('fm-opus').disabled = !isNew;
  calcHint();
  openModal('crew-modal');
}

function calcHint() {
  const s = Number(document.getElementById('fm-salary').value) || 0;
  const d = s > 0 ? Math.round(s / 15) : 0;
  const h = d > 0 ? (d / 12).toFixed(2) : '—';
  document.getElementById('fm-hint').textContent = s > 0 ? `日薪 ${d.toLocaleString()} | 時薪 ${h}` : '';
}

async function saveCrew() {
  const data = {
    opus_no:       document.getElementById('fm-opus').value.trim(),
    name_chn:      document.getElementById('fm-chn').value.trim(),
    name_eng:      document.getElementById('fm-eng').value.trim(),
    vessel:        document.getElementById('fm-vessel').value,
    rank:          document.getElementById('fm-rank').value,
    basic_salary:  document.getElementById('fm-salary').value,
    sail_bonus_d:  document.getElementById('fm-sailD').value,
    sail_bonus_n:  document.getElementById('fm-sailN').value,
    food_per_day:  document.getElementById('fm-food').value,
    transport:     document.getElementById('fm-trans').value,
    pos_allowance: document.getElementById('fm-pos').value,
    active:        document.getElementById('fm-active').value === '1',
  };
  if (!data.opus_no || !data.name_chn || !data.rank) {
    toast('請填寫 OPUS編號、姓名、職級', 'error'); return;
  }
  const res = await api.saveCrew(data);
  if (res.ok) { toast('船員資料已儲存', 'success'); closeModal('crew-modal'); loadCrewData(); }
  else toast(res.error, 'error');
}

// ════════════════════════════════════════════════════════════
// MONTH CONFIG
// ════════════════════════════════════════════════════════════
function initMonthConfigForm() {
  const vessels = ['Valkyrie','Wotan','Valiant','WayFeng'];
  const keys    = ['vlk','wtn','vln','wyf'];
  document.getElementById('mc-form').innerHTML = vessels.map((v, i) => `
    <div class="form-group">
      <label>${v} 停航天數</label>
      <input type="number" id="mc-${keys[i]}" value="0" min="0" max="31" oninput="updateMcPreview()">
    </div>`).join('');
  updateMcPreview();
}

function updateMcPreview() {
  const yr = Number(document.getElementById('mc-year').value);
  const mo = Number(document.getElementById('mc-month').value);
  const total = new Date(yr, mo, 0).getDate();
  const rows = [
    ['Valkyrie','vlk'],['Wotan','wtn'],['Valiant','vln'],['WayFeng','wyf']
  ].map(([v, k]) => {
    const off    = Number(document.getElementById('mc-' + k)?.value) || 0;
    const on     = Math.max(0, total - off);
    const guar   = Math.round(on / 5);
    return `<span>${vBadge(v)} on <strong>${on}</strong>天 → 保底 <strong>${guar}</strong>天</span>`;
  });
  document.getElementById('mc-preview').innerHTML = rows.join('　');
}

async function loadMonthConfig() {
  const yr = Number(document.getElementById('mc-year').value);
  const mo = Number(document.getElementById('mc-month').value);
  const res = await api.getMonthConfig(yr, mo);
  if (res.ok && res.config) {
    const c = res.config;
    document.getElementById('mc-vlk').value = c.vlk_offhire || 0;
    document.getElementById('mc-wtn').value = c.wtn_offhire || 0;
    document.getElementById('mc-vln').value = c.vln_offhire || 0;
    document.getElementById('mc-wyf').value = c.wyf_offhire || 0;
    updateMcPreview();
    toast('設定已載入', 'info');
  } else {
    toast('尚未設定此月份', 'info');
  }
}

async function saveMonthConfig() {
  const data = {
    year:        Number(document.getElementById('mc-year').value),
    month:       Number(document.getElementById('mc-month').value),
    vlk_offhire: Number(document.getElementById('mc-vlk').value) || 0,
    wtn_offhire: Number(document.getElementById('mc-wtn').value) || 0,
    vln_offhire: Number(document.getElementById('mc-vln').value) || 0,
    wyf_offhire: Number(document.getElementById('mc-wyf').value) || 0,
  };
  const res = await api.saveMonthConfig(data);
  if (res.ok) toast('月份設定已儲存', 'success');
  else toast(res.error, 'error');
}

// ════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════
async function loadAttCrew() {
  const yr     = Number(document.getElementById('att-year').value);
  const mo     = Number(document.getElementById('att-month').value);
  const vessel = document.getElementById('att-vessel').value;
  const total  = new Date(yr, mo, 0).getDate();

  const crewOnVessel = S.crew.filter(c => c.vessel === vessel && c.active === 1);
  if (!crewOnVessel.length) {
    document.getElementById('att-list').innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚓</div><div class="empty-title">${vessel} 目前沒有在職船員</div></div>`;
    return;
  }

  const attRes = await api.getAttendance(yr, mo, vessel);
  const attMap = {};
  if (attRes.ok) attRes.records.forEach(r => { attMap[r.opus_no] = r; });

  document.getElementById('att-list').innerHTML = crewOnVessel.map(c => {
    const rec  = attMap[c.opus_no];
    const days = rec ? rec.days : Array(31).fill('');
    const stat = calcAttStat(days, total);
    return `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div>
            <strong>${c.name_chn}</strong>
            <span style="color:var(--text-muted);font-size:12px;margin:0 8px">${c.opus_no}</span>
            <span class="badge" style="background:var(--sea-pale);color:var(--sea)">${c.rank}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--text-muted)">${stat}</span>
            <button class="btn btn-sea btn-sm" onclick="openAttModal('${c.opus_no}','${vessel}',${yr},${mo},${total})">
              ${rec ? '✏ 編輯' : '＋ 輸入'}
            </button>
          </div>
        </div>
        <div style="display:flex;gap:2px;flex-wrap:wrap">
          ${days.slice(0, total).map((code, i) =>
            `<div style="width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;${attStyle(code)}" title="${i+1}日">${code||'—'}</div>`
          ).join('')}
        </div>
      </div>`;
  }).join('');
}

function attStyle(code) {
  return ({
    X:   'background:#DBEAFE;color:#1D4ED8',
    D:   'background:#D1FAE5;color:#065F46',
    N:   'background:#1E293B;color:#94A3B8',
    R:   'background:#FEF9C3;color:#854D0E',
    'R/D':'background:#ECFDF5;color:#166534',
    'R/N':'background:#374151;color:#D1D5DB',
  }[code] || 'background:#F3F4F6;color:#9CA3AF');
}

function calcAttStat(days, total) {
  const d = days.slice(0, total);
  return `港${d.filter(v=>v==='X').length} 日${d.filter(v=>v==='D').length} 夜${d.filter(v=>v==='N').length} 休${d.filter(v=>v==='R').length}`;
}

function openAttModal(opus, vessel, yr, mo, total) {
  S.attCurrent = { opus_no: opus, vessel, year: yr, month: mo, totalDays: total };
  S.attDays = Array(31).fill('');

  document.getElementById('att-modal-title').textContent = `出勤輸入 — ${opus} (${vessel}) ${yr}年${mo}月`;
  document.getElementById('att-ot').value = 0;
  document.getElementById('att-tt').value = 0;
  document.getElementById('att-adj').value = 0;

  renderAttCal();
  openModal('att-modal');

  // 載入已有記錄
  api.getAttendance(yr, mo, vessel).then(res => {
    if (res.ok) {
      const rec = res.records.find(r => r.opus_no === opus);
      if (rec) {
        S.attDays = [...rec.days];
        document.getElementById('att-ot').value  = rec.ot_hours || 0;
        document.getElementById('att-tt').value  = rec.tt_hours || 0;
        document.getElementById('att-adj').value = rec.adjust   || 0;
        renderAttCal();
      }
    }
  });
}

function renderAttCal() {
  const { totalDays } = S.attCurrent;
  const codeMap = { '':'—', X:'X', D:'D', N:'N', R:'R', 'R/D':'R/D', 'R/N':'R/N' };
  const classMap = { '':'', X:'cX', D:'cD', N:'cN', R:'cR', 'R/D':'cRD', 'R/N':'cRN' };

  let html = '<div class="att-grid">';
  for (let i = 0; i < 31; i++) {
    const code = S.attDays[i] || '';
    const dis  = i >= totalDays ? 'disabled' : '';
    html += `<div class="att-cell ${classMap[code]||''} ${dis}" onclick="cycleAtt(${i})">
      <span class="dn">${i+1}</span>
      <span class="dc">${codeMap[code]||'—'}</span>
    </div>`;
  }
  html += '</div>';

  const X  = S.attDays.filter(v=>v==='X').length;
  const D  = S.attDays.filter(v=>v==='D').length;
  const N  = S.attDays.filter(v=>v==='N').length;
  const R  = S.attDays.filter(v=>v==='R').length;
  const RD = S.attDays.filter(v=>v==='R/D').length;
  const RN = S.attDays.filter(v=>v==='R/N').length;

  document.getElementById('att-cal').innerHTML = html;
  document.getElementById('att-stats').innerHTML =
    `<span>港內 <strong>${X}</strong></span>
     <span>出海日 <strong>${D}</strong></span>
     <span>出海夜 <strong>${N}</strong></span>
     <span>休假 <strong>${R}</strong></span>
     <span>休+日 <strong>${RD}</strong></span>
     <span>休+夜 <strong>${RN}</strong></span>
     <span style="color:var(--navy);font-weight:600">出勤 ${X+D+N} 天</span>`;
}

function cycleAtt(idx) {
  const cur  = S.attDays[idx] || '';
  S.attDays[idx] = ATT_CODES[(ATT_CODES.indexOf(cur) + 1) % ATT_CODES.length];
  renderAttCal();
}

async function saveAtt() {
  const { opus_no, vessel, year, month } = S.attCurrent;
  const data = {
    opus_no, vessel, year, month,
    days:     S.attDays,
    ot_hours: Number(document.getElementById('att-ot').value)  || 0,
    tt_hours: Number(document.getElementById('att-tt').value)  || 0,
    adjust:   Number(document.getElementById('att-adj').value) || 0,
  };
  const res = await api.saveAttendance(data);
  if (res.ok) {
    toast('出勤記錄已儲存', 'success');
    closeModal('att-modal');
    loadAttCrew();
  } else {
    toast(res.error, 'error');
  }
}

// ════════════════════════════════════════════════════════════
// SALARY
// ════════════════════════════════════════════════════════════
async function runCalc() {
  const yr = Number(document.getElementById('sal-year').value);
  const mo = Number(document.getElementById('sal-month').value);
  const btn = document.getElementById('btn-calc');
  btn.disabled = true; btn.textContent = '計算中...';
  const res = await api.calcSalary(yr, mo);
  btn.disabled = false; btn.textContent = '⚙ 執行計算';
  if (res.ok) { toast(`計算完成，共 ${res.count} 筆`, 'success'); loadSalary(); }
  else toast(res.error, 'error');
}

async function loadSalary() {
  const yr     = Number(document.getElementById('sal-year').value);
  const mo     = Number(document.getElementById('sal-month').value);
  const vessel = document.getElementById('sal-vessel').value;

  const [salRes, sumRes] = await Promise.all([
    api.getSalary(yr, mo, vessel),
    api.getSalSummary(yr, mo),
  ]);

  // 各船卡片
  const vessels = ['Valkyrie','Wotan','Valiant','WayFeng'];
  const colors  = ['c-sea','c-amber','c-green','c-red'];
  document.getElementById('sal-cards').innerHTML = vessels.map((v, i) => {
    const rows  = salRes.ok ? salRes.data.filter(r => r.vessel === v) : [];
    const total = rows.reduce((s, r) => s + (r.gross_pay || 0), 0);
    return `<div class="stat-card ${colors[i]}">
      <div class="stat-label">${v}</div>
      <div class="stat-value" style="font-size:17px">${total > 0 ? Math.round(total).toLocaleString() : '—'}</div>
      <div class="stat-sub">${rows.length} 人</div>
    </div>`;
  }).join('');

  // 個人總表
  if (sumRes.ok && sumRes.data.length) {
    document.getElementById('sal-summary').innerHTML = `
      <table>
        <thead><tr>
          <th>OPUS</th><th>姓名</th><th>服務船別</th><th>職級</th>
          <th class="td-num">月薪</th><th class="td-num">出海獎金</th>
          <th class="td-num">OT</th><th class="td-num">伙食</th>
          <th class="td-num">薪資合計</th>
          <th class="td-num" style="color:var(--amber)">Gross Pay</th>
        </tr></thead>
        <tbody>
          ${sumRes.data.map(r => `
            <tr>
              <td class="td-muted">${r.opus_no}</td>
              <td><strong>${r.name_chn}</strong></td>
              <td>${(r.vessels||'').split('/').map(v=>vBadge(v.trim())).join(' ')}</td>
              <td><span class="badge" style="background:var(--sea-pale);color:var(--sea)">${r.rank}</span></td>
              <td class="td-num">${fmt(r.monthly_salary)}</td>
              <td class="td-num">${fmt(r.sail_bonus)}</td>
              <td class="td-num">${fmt(r.ot_amount)}</td>
              <td class="td-num">${fmt(r.food_amount)}</td>
              <td class="td-num">${fmt(r.total_salary)}</td>
              <td class="td-num" style="font-weight:700;color:var(--navy)">${fmt(r.gross_pay)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="4" style="text-align:right">合計</td>
          <td class="td-num">${fmt(sumRes.data.reduce((s,r)=>s+Number(r.monthly_salary||0),0))}</td>
          <td class="td-num">${fmt(sumRes.data.reduce((s,r)=>s+Number(r.sail_bonus||0),0))}</td>
          <td class="td-num">${fmt(sumRes.data.reduce((s,r)=>s+Number(r.ot_amount||0),0))}</td>
          <td class="td-num">${fmt(sumRes.data.reduce((s,r)=>s+Number(r.food_amount||0),0))}</td>
          <td class="td-num">${fmt(sumRes.data.reduce((s,r)=>s+Number(r.total_salary||0),0))}</td>
          <td class="td-num" style="font-weight:700">${fmt(sumRes.data.reduce((s,r)=>s+Number(r.gross_pay||0),0))}</td>
        </tr></tfoot>
      </table>`;
  } else {
    document.getElementById('sal-summary').innerHTML =
      `<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">請先執行計算</div></div>`;
  }

  // 明細
  if (salRes.ok && salRes.data.length) {
    document.getElementById('sal-detail').innerHTML = `
      <table>
        <thead><tr>
          <th>船別</th><th>OPUS</th><th>姓名</th><th>職級</th>
          <th class="td-num">月薪</th><th class="td-num">出海獎金</th>
          <th class="td-num">OT</th><th class="td-num">伙食</th><th class="td-num">交通</th>
          <th class="td-num">Gross Pay</th>
          <th style="font-size:11px">X/D/N/R</th>
        </tr></thead>
        <tbody>
          ${salRes.data.map(r => `
            <tr>
              <td>${vBadge(r.vessel)}</td>
              <td class="td-muted">${r.opus_no}</td>
              <td>${r.name_chn}</td>
              <td><span class="badge" style="background:var(--sea-pale);color:var(--sea)">${r.rank}</span></td>
              <td class="td-num">${fmt(r.monthly_salary)}</td>
              <td class="td-num">${fmt(r.sail_bonus)}</td>
              <td class="td-num">${fmt(r.ot_amount)}</td>
              <td class="td-num">${fmt(r.food_amount)}</td>
              <td class="td-num">${fmt(r.transport)}</td>
              <td class="td-num" style="font-weight:600">${fmt(r.gross_pay)}</td>
              <td style="font-size:11px;color:var(--text-muted)">${r.cnt_x}/${r.cnt_d}/${r.cnt_n}/${r.cnt_r}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } else {
    document.getElementById('sal-detail').innerHTML =
      `<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-title">尚無資料</div></div>`;
  }
}

// ════════════════════════════════════════════════════════════
// BACKUP
// ════════════════════════════════════════════════════════════
async function loadBackupInfo() {
  const res = await api.getLastBackup();
  document.getElementById('last-backup-time').textContent =
    res.ok && res.time ? new Date(res.time).toLocaleString('zh-TW') : '從未備份';
}

async function doBackup() {
  const res = await api.backupDb();
  if (res.ok) { toast(`備份成功：${res.fileName}`, 'success'); loadBackupInfo(); }
  else if (res.error !== '取消') toast(res.error, 'error');
}

async function doRestore() {
  const confirmed = confirm('還原後系統需要重新啟動，確定要還原嗎？');
  if (!confirmed) return;
  const res = await api.restoreDb();
  if (res.ok) toast(res.message, 'success');
  else if (res.error !== '取消') toast(res.error, 'error');
}

// ════════════════════════════════════════════════════════════
// DIAG
// ════════════════════════════════════════════════════════════
async function loadLogs() {
  const res = await api.getLogs();
  if (!res.ok) { toast(res.error, 'error'); return; }

  if (!res.logs.length) {
    document.getElementById('diag-table').innerHTML =
      `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">日誌為空</div></div>`;
    return;
  }

  document.getElementById('diag-table').innerHTML = `
    <table>
      <thead><tr><th>時間</th><th>操作</th><th>詳情</th></tr></thead>
      <tbody>
        ${res.logs.map(r => `
          <tr>
            <td class="td-muted" style="white-space:nowrap;font-size:12px">${r.created_at}</td>
            <td><span class="badge" style="background:var(--sea-pale);color:var(--sea)">${r.action}</span></td>
            <td style="font-size:12px">${r.detail}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function doExportLog() {
  const res = await api.exportLog();
  if (res.ok) toast('日誌已匯出：' + res.path, 'success');
  else if (res.error !== '取消') toast(res.error, 'error');
}

async function doClearLog() {
  if (!confirm('確定要清除所有日誌嗎？')) return;
  const res = await api.clearLogs();
  if (res.ok) { toast('日誌已清除', 'success'); loadLogs(); }
}

// ════════════════════════════════════════════════════════════════
// 晉升/轉正提醒
// ════════════════════════════════════════════════════════════════
async function loadReminders(showModal = false) {
  const res = await api.getReminders(30);
  if (!res.ok || !res.reminders.length) {
    document.getElementById('dash-remind')?.remove();
    return;
  }

  const items = res.reminders;
  const html = `
    <div class="card" id="dash-remind" style="border-left:4px solid var(--amber);margin-bottom:14px">
      <div class="card-title" style="color:var(--amber)">⏰ 晉升 / 轉正提醒（30天內）</div>
      ${items.map(r => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-light)">
          <div>
            <strong>${r.name_chn}</strong>
            <span style="color:var(--text-muted);font-size:12px;margin:0 8px">${r.opus_no}</span>
            ${vBadge(r.vessel)}
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;font-weight:600;color:var(--red)">${r.remind_date}</div>
            <div style="font-size:11px;color:var(--text-muted)">${r.remind_note}</div>
          </div>
        </div>`).join('')}
    </div>`;

  // 插入到總覽頁 vessel-strip 之前
  const strip = document.querySelector('.vessel-strip');
  if (strip && !document.getElementById('dash-remind')) {
    strip.insertAdjacentHTML('beforebegin', html);
  }

  // 薪資計算頁也顯示
  if (showModal && items.length) {
    document.getElementById('remind-modal-body').innerHTML = `
      <p style="margin-bottom:12px;color:var(--text-muted);font-size:13px">以下船員有晉升或轉正事項，請確認薪資是否已依級距調整：</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>姓名</th><th>OPUS</th><th>船別</th><th>職級</th><th>提醒日期</th><th>說明</th></tr></thead>
          <tbody>
            ${items.map(r => `
              <tr>
                <td><strong>${r.name_chn}</strong></td>
                <td class="td-muted">${r.opus_no}</td>
                <td>${vBadge(r.vessel)}</td>
                <td><span class="badge" style="background:var(--sea-pale);color:var(--sea)">${r.rank}</span></td>
                <td style="color:var(--red);font-weight:600">${r.remind_date}</td>
                <td style="font-size:12px">${r.remind_note}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    openModal('remind-modal');
  }
}

// 在 loadDashboard 裡呼叫提醒
const _origLoadDashboard = loadDashboard;
window.loadDashboard = async function() {
  await _origLoadDashboard();
  await loadReminders(false);
};

// 在 runCalc 前檢查提醒
const _origRunCalc = runCalc;
window.runCalc = async function() {
  await loadReminders(true);
  await _origRunCalc();
};

// ════════════════════════════════════════════════════════════════
// 船員主檔：提醒欄位
// ════════════════════════════════════════════════════════════════
// 在 openCrewModal 後補上提醒欄位（動態插入）
const _origOpenCrewModal = openCrewModal;
window.openCrewModal = function(crew) {
  _origOpenCrewModal(crew);
  // 確保 modal-body 有提醒欄位
  const body = document.querySelector('#crew-modal .modal-body');
  if (!body.querySelector('#fm-remind-date')) {
    body.insertAdjacentHTML('beforeend', `
      <div class="divider"></div>
      <div class="form-row">
        <div class="form-group">
          <label>晉升/轉正提醒日期</label>
          <input type="date" id="fm-remind-date">
        </div>
        <div class="form-group">
          <label>提醒說明</label>
          <input type="text" id="fm-remind-note" placeholder="例：升職調薪至 MS 等級">
        </div>
      </div>`);
  }
  document.getElementById('fm-remind-date').value = crew?.remind_date || '';
  document.getElementById('fm-remind-note').value = crew?.remind_note || '';
};

// 覆寫 saveCrew 補上提醒欄位
const _origSaveCrew = saveCrew;
window.saveCrew = async function() {
  const remindDate = document.getElementById('fm-remind-date')?.value || '';
  const remindNote = document.getElementById('fm-remind-note')?.value || '';
  // patch api call by temporarily augmenting the form
  const origSaveCrew2 = api.saveCrew.bind(api);
  api.saveCrew = async (data) => origSaveCrew2({ ...data, remind_date: remindDate, remind_note: remindNote });
  await _origSaveCrew();
  api.saveCrew = origSaveCrew2;
};

// ════════════════════════════════════════════════════════════════
// 匯入功能
// ════════════════════════════════════════════════════════════════
let _importPreviewData = [];

async function doPreviewCrew() {
  const res = await api.previewCrewImport();
  if (!res.ok) { if (res.error !== '取消') toast(res.error, 'error'); return; }

  _importPreviewData = res.preview;

  const statusLabel = { new: '新增', duplicate: '重複（已存在）', resigned_conflict: '⚠ 舊資料已離職' };
  const statusColor = { new: 'var(--green)', duplicate: 'var(--amber)', resigned_conflict: 'var(--red)' };

  document.getElementById('crew-import-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      共 ${res.preview.length} 筆。勾選要匯入的項目，重複或衝突項目請手動確認。
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th><input type="checkbox" id="import-check-all" onchange="toggleAllImport(this.checked)"></th>
          <th>狀態</th><th>OPUS</th><th>姓名</th><th>船別</th><th>職級</th>
          <th class="td-num">月薪</th><th>原資料</th>
        </tr></thead>
        <tbody>
          ${res.preview.map((item, i) => `
            <tr>
              <td><input type="checkbox" class="import-chk" data-idx="${i}" ${item.status === 'new' ? 'checked' : ''}></td>
              <td><span style="font-size:11px;font-weight:600;color:${statusColor[item.status]}">${statusLabel[item.status]}</span></td>
              <td class="td-muted">${item.incoming.opus_no}</td>
              <td>${item.incoming.name_chn}</td>
              <td>${vBadge(item.incoming.vessel)}</td>
              <td>${item.incoming.rank}</td>
              <td class="td-num">${fmt(item.incoming.basic_salary)}</td>
              <td style="font-size:11px;color:var(--text-muted)">${item.old ? `原：${item.old.name_chn} / ${item.old.active ? '在職' : '離職'}` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  openModal('crew-import-modal');
}

function toggleAllImport(checked) {
  document.querySelectorAll('.import-chk').forEach(el => { el.checked = checked; });
}

async function confirmCrewImport() {
  const items = _importPreviewData.map((item, i) => {
    const chk = document.querySelector(`.import-chk[data-idx="${i}"]`);
    return { action: chk?.checked ? 'import' : 'skip', data: item.incoming };
  });
  const res = await api.confirmCrewImport(items);
  if (res.ok) {
    toast(`匯入完成：${res.imported} 筆，跳過 ${res.skipped} 筆`, 'success');
    closeModal('crew-import-modal');
    loadCrewData();
  } else {
    toast(res.error, 'error');
  }
}

async function doImportAttendance() {
  const res = await api.importAttendance();
  if (!res.ok) { if (res.error !== '取消') toast(res.error, 'error'); return; }
  toast(`工時表匯入完成：${res.vessel} ${res.monthKey} 共 ${res.count} 筆`, 'success');
}

async function doImportDb() {
  const confirmed = confirm('匯入後系統需要重新啟動，現有資料會被取代（系統會先自動備份）。確定繼續？');
  if (!confirmed) return;
  const res = await api.importDb();
  if (res.ok) toast(res.message, 'success');
  else if (res.error !== '取消') toast(res.error, 'error');
}

// ════════════════════════════════════════════════════════════════
// 匯出功能
// ════════════════════════════════════════════════════════════════
async function doExportCrewTemplate() {
  const res = await api.exportCrewTemplate();
  if (res.ok) toast('範本已匯出：' + res.path, 'success');
  else if (res.error !== '取消') toast(res.error, 'error');
}

async function doExportAttendance() {
  const year   = Number(document.getElementById('exp-att-year').value);
  const month  = Number(document.getElementById('exp-att-month').value);
  const vessel = document.getElementById('exp-att-vessel').value;
  const res = await api.exportAttendance(year, month, vessel);
  if (res.ok) toast('工時表已匯出', 'success');
  else if (res.error !== '取消') toast(res.error, 'error');
}

async function doExportPBC() {
  const year  = Number(document.getElementById('exp-pbc-year').value);
  const month = Number(document.getElementById('exp-pbc-month').value);
  const res = await api.exportPBC(year, month);
  if (res.ok) toast('PBC 報表已匯出', 'success');
  else if (res.error !== '取消') toast(res.error, 'error');
}

// 初始化匯出頁面的年份選單
window.addEventListener('DOMContentLoaded', () => {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  ['exp-att-year','exp-pbc-year'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let i = y - 1; i <= y + 1; i++) {
      el.insertAdjacentHTML('beforeend', `<option value="${i}" ${i===y?'selected':''}>${i}年</option>`);
    }
  });
  ['exp-att-month','exp-pbc-month'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = m;
  });
});
