/**
 * ระบบเช็คและวิเคราะห์แผนผลิตกระดาษลูกฟูก
 * - หน้า 1: ตรวจจับออเดอร์ที่กระดาษ M1-M5 ไม่ต่อกันและยาวรวม < เกณฑ์
 * - หน้า 2: วิเคราะห์สัดส่วน % ออเดอร์ (สั้น/กลาง/ยาว) และความหนากระดาษ (แกรมบาง/กลาง/หนา)
 * - รีเฟรชหรือเข้าใหม่จะล้างข้อมูลเก่าออกเสมอ
 */

const ALL_LAYERS = ['m5', 'm4', 'm3', 'm2', 'm1'];
const LAYER_NAMES = { m5: 'M5', m4: 'M4', m3: 'M3', m2: 'M2', m1: 'M1' };

const GRAM_GROUPS = [
  { key: 'thin', label: 'แกรมบาง', sub: '105, 125, 140 (≤140)', color: 'bg-sky-600', lightBg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', badge: 'bg-sky-100 text-sky-800 border-sky-300' },
  { key: 'medium', label: 'แกรมกลาง', sub: '150, 170 (141–174)', color: 'bg-indigo-600', lightBg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-800', badge: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  { key: 'thick', label: 'แกรมหนา', sub: '175 ขึ้นไป (≥175)', color: 'bg-purple-600', lightBg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-800', badge: 'bg-purple-100 text-purple-800 border-purple-300' }
];

const LEN_GROUPS = [
  { key: 'short', label: 'ออเดอร์สั้น', color: 'bg-rose-600', lightBg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800 border-rose-300' },
  { key: 'medium', label: 'ออเดอร์กลาง', color: 'bg-amber-500', lightBg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800 border-amber-300' },
  { key: 'long', label: 'ออเดอร์ยาว', color: 'bg-emerald-600', lightBg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
];

let state = {
  activeTab: 'check', // 'check' | 'analysis'
  planTitle: '',
  rawOrders: [],
  analyzedOrders: [],
  mode: 'anomaly_with_context',
  threshold: 300,
  sheets: {},
  config: {
    checkedLayers: { m5: true, m4: true, m3: true, m2: true, m1: true },
    checkWidthChange: true,
    fluteFilter: 'ALL'
  },
  analysis: {
    gramSource: 'max', // 'max' | 'm5' | 'all_layers'
    fluteFilter: 'ALL',
    shortMax: 300,
    longMin: 700,
    drillGram: 'ALL',
    drillLen: 'ALL',
    includeTableInImg: false
  }
};

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  bindEvents();
  // ล้างข้อมูลเก่าออกหมดเสมอเมื่อโหลดหรือรีเฟรชหน้า
  resetDashboard();
});

function bindEvents() {
  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) readExcelFile(e.target.files[0]);
  });

  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drop-active');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drop-active');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.[0]) {
      readExcelFile(e.dataTransfer.files[0]);
    }
  });

  // ปุ่มเปลี่ยนหน้า (Tab Check vs Tab Analysis)
  document.querySelectorAll('.main-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchMainTab(btn.getAttribute('data-tab'));
    });
  });

  // ปุ่มล้างข้อมูล & โหลดตัวอย่าง
  document.getElementById('btnClearData').addEventListener('click', () => {
    resetDashboard();
    notify('ล้างข้อมูลบนหน้าจอเรียบร้อยแล้ว');
  });

  document.getElementById('btnLoadSample').addEventListener('click', () => {
    loadSample();
    notify('โหลดแผนตัวอย่าง (10/11/69 PLAN 1 MC BHS) เรียบร้อย');
  });

  // แผงตั้งค่าหน้า 1
  const settingsPanel = document.getElementById('settingsPanel');
  document.getElementById('btnToggleSettings').addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });
  document.getElementById('btnCloseSettings').addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.getAttribute('data-mode');
      document.querySelectorAll('.mode-btn').forEach((b) => {
        b.className =
          b.getAttribute('data-mode') === state.mode
            ? 'mode-btn px-2.5 py-1 rounded bg-rose-600 text-white shadow-sm transition cursor-pointer'
            : 'mode-btn px-2.5 py-1 rounded text-slate-600 hover:text-slate-900 transition cursor-pointer';
      });
      renderTable();
    });
  });

  const syncThreshold = (val) => {
    if (!isNaN(val) && val > 0) {
      state.threshold = val;
      document.getElementById('thresholdInput').value = val;
      document.getElementById('cfgThreshold').value = val;
      document.querySelectorAll('.th-val').forEach((el) => (el.textContent = val));
      analyzeAndRender();
    }
  };

  document.getElementById('thresholdInput').addEventListener('input', (e) => syncThreshold(parseFloat(e.target.value)));
  document.getElementById('cfgThreshold').addEventListener('input', (e) => syncThreshold(parseFloat(e.target.value)));

  ALL_LAYERS.forEach((lk) => {
    const chk = document.getElementById(`chk${lk.toUpperCase()}`);
    if (chk) {
      chk.addEventListener('change', (e) => {
        state.config.checkedLayers[lk] = e.target.checked;
        analyzeAndRender();
      });
    }
  });

  document.getElementById('chkWidthChange').addEventListener('change', (e) => {
    state.config.checkWidthChange = e.target.checked;
    analyzeAndRender();
  });

  document.getElementById('cfgFluteFilter').addEventListener('change', (e) => {
    state.config.fluteFilter = e.target.value;
    analyzeAndRender();
  });

  document.getElementById('btnResetSettings').addEventListener('click', () => {
    syncThreshold(300);
    ALL_LAYERS.forEach((lk) => {
      state.config.checkedLayers[lk] = true;
      const el = document.getElementById(`chk${lk.toUpperCase()}`);
      if (el) el.checked = true;
    });
    state.config.checkWidthChange = true;
    document.getElementById('chkWidthChange').checked = true;
    state.config.fluteFilter = 'ALL';
    document.getElementById('cfgFluteFilter').value = 'ALL';
    analyzeAndRender();
    notify('รีเซ็ตเงื่อนไขกลับเป็นค่ามาตรฐานแล้ว');
  });

  // ตัวเลือกหน้าวิเคราะห์ (Tab 2)
  document.getElementById('anaGramSource').addEventListener('change', (e) => {
    state.analysis.gramSource = e.target.value;
    renderAnalysisView();
  });

  document.getElementById('anaFluteFilter').addEventListener('change', (e) => {
    state.analysis.fluteFilter = e.target.value;
    renderAnalysisView();
  });

  document.getElementById('anaShortMax').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0 && v < state.analysis.longMin) {
      state.analysis.shortMax = v;
      document.querySelectorAll('.ana-short-lbl').forEach((el) => (el.textContent = v));
      renderAnalysisView();
    }
  });

  document.getElementById('anaLongMin').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > state.analysis.shortMax) {
      state.analysis.longMin = v;
      document.querySelectorAll('.ana-long-lbl').forEach((el) => (el.textContent = v));
      renderAnalysisView();
    }
  });

  document.getElementById('chkIncludeAnaTableInImg').addEventListener('change', (e) => {
    state.analysis.includeTableInImg = e.target.checked;
    syncDrilldownPosition();
  });

  // ปุ่มบันทึกรูปภาพ & คัดลอกรูป (แคปตามหน้า Tab ที่เปิดอยู่)
  document.getElementById('btnSaveImg').addEventListener('click', () => {
    if (state.rawOrders.length === 0) {
      notify('ยังไม่มีข้อมูลแผนผลิต กรุณาโยนไฟล์ Excel ก่อนครับ', true);
      return;
    }
    const isAna = state.activeTab === 'analysis';
    const area = document.getElementById(isAna ? 'analysisCaptureArea' : 'captureArea');
    const cleanName = (state.planTitle || 'Plan').replace(/[^a-zA-Z0-9ก-๙_-]/g, '_');
    const prefix = isAna ? 'วิเคราะห์ออเดอร์' : 'เช็คM1M5ไม่ต่อกัน';
    exportImage(area, `${prefix}_${cleanName}.png`, false);
  });

  document.getElementById('btnCopyImg').addEventListener('click', () => {
    if (state.rawOrders.length === 0) {
      notify('ยังไม่มีข้อมูลแผนผลิต กรุณาโยนไฟล์ Excel ก่อนครับ', true);
      return;
    }
    const isAna = state.activeTab === 'analysis';
    const area = document.getElementById(isAna ? 'analysisCaptureArea' : 'captureArea');
    exportImage(area, 'clipboard.png', true);
  });
}

function switchMainTab(tabName) {
  state.activeTab = tabName;
  const viewCheck = document.getElementById('viewCheck');
  const viewAnalysis = document.getElementById('viewAnalysis');
  const tabBtnCheck = document.getElementById('tabBtnCheck');
  const tabBtnAnalysis = document.getElementById('tabBtnAnalysis');

  if (tabName === 'analysis') {
    viewCheck.classList.add('hidden');
    viewAnalysis.classList.remove('hidden');
    tabBtnCheck.className = 'main-tab-btn px-3 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5 cursor-pointer';
    tabBtnAnalysis.className = 'main-tab-btn px-3 py-1.5 rounded-md bg-blue-600 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer';
    renderAnalysisView();
  } else {
    viewAnalysis.classList.add('hidden');
    viewCheck.classList.remove('hidden');
    tabBtnCheck.className = 'main-tab-btn px-3 py-1.5 rounded-md bg-slate-900 text-white shadow-sm transition flex items-center gap-1.5 cursor-pointer';
    tabBtnAnalysis.className = 'main-tab-btn px-3 py-1.5 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center gap-1.5 cursor-pointer';
  }
}

function syncDrilldownPosition() {
  const drill = document.getElementById('anaDrilldownContainer');
  const insideSlot = document.getElementById('anaOrdersInsideSlot');
  const viewAnalysis = document.getElementById('viewAnalysis');
  if (state.analysis.includeTableInImg) {
    insideSlot.appendChild(drill);
  } else {
    viewAnalysis.appendChild(drill);
  }
}

function resetDashboard() {
  state.planTitle = '';
  state.rawOrders = [];
  state.analyzedOrders = [];
  state.sheets = {};
  state.analysis.drillGram = 'ALL';
  state.analysis.drillLen = 'ALL';

  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';

  document.getElementById('fileStatusText').textContent = 'ยังไม่มีไฟล์ — กรุณาลากไฟล์แผนผลิตมาวาง';
  document.getElementById('planHeaderTitle').textContent = 'กรุณาลากไฟล์แผนการผลิต Excel (.xlsx / .csv) มาวาง';
  document.getElementById('anaPlanTitle').textContent = 'กรุณาลากไฟล์แผนการผลิต Excel (.xlsx / .csv) มาวาง';
  document.getElementById('sheetBar').classList.add('hidden');
  document.getElementById('sheetButtons').innerHTML = '';

  analyzeAndRender();
}

function loadSample() {
  if (typeof SAMPLE_PLAN_DATA !== 'undefined') {
    state.planTitle = SAMPLE_PLAN_DATA.planTitle;
    state.rawOrders = SAMPLE_PLAN_DATA.orders.map((o) => ({ ...o }));
    document.getElementById('fileStatusText').textContent = `ตัวอย่าง: ${state.planTitle} (${state.rawOrders.length} ออเดอร์)`;
    analyzeAndRender();
  }
}

function cleanCode(val) {
  if (!val) return '';
  const s = String(val).trim();
  return s === 'NaN' || s === '0' || s === '-' ? '' : s;
}

/**
 * แปลงรหัสกระดาษ (เช่น WS170, CM105, KL175) หรือคอลัมน์แกรมเป็นตัวเลข GSM
 */
function parseGramFromCode(code, explicitGram) {
  if (explicitGram && !isNaN(explicitGram) && Number(explicitGram) > 0) {
    return Number(explicitGram);
  }
  if (!code) return 0;
  const s = String(code).trim();
  const matchEnd = s.match(/(\d{2,3})(?=\D*$)/);
  if (matchEnd) return parseInt(matchEnd[1], 10);
  const matchAny = s.match(/(\d{2,3})/);
  return matchAny ? parseInt(matchAny[1], 10) : 0;
}

/**
 * จัดกลุ่มแกรมกระดาษ:
 * - บาง: 105, 125, 140 (<= 140)
 * - กลาง: 150, 170 (141 - 174)
 * - หนา: 175 ขึ้นไป (>= 175)
 */
function classifyGram(gsm) {
  if (!gsm || gsm <= 0) return 'unknown';
  if (gsm <= 140) return 'thin';
  if (gsm < 175) return 'medium';
  return 'thick';
}

/**
 * จัดกลุ่มความยาวออเดอร์:
 * - สั้น: < 300 เมตร
 * - กลาง: 300 ถึง < 700 เมตร
 * - ยาว: >= 700 เมตร
 */
function classifyLength(meters, shortMax = 300, longMin = 700) {
  if (meters < shortMax) return 'short';
  if (meters < longMin) return 'medium';
  return 'long';
}

function analyzeOrders(orders, threshold, config) {
  const n = orders.length;
  if (n === 0) return [];

  const list = orders.map((o, idx) => {
    const m5 = cleanCode(o.m5);
    const m4 = cleanCode(o.m4);
    const m3 = cleanCode(o.m3);
    const m2 = cleanCode(o.m2);
    const m1 = cleanCode(o.m1);

    const grams = {
      m5: parseGramFromCode(m5, o.m5Gram),
      m4: parseGramFromCode(m4, o.m4Gram),
      m3: parseGramFromCode(m3, o.m3Gram),
      m2: parseGramFromCode(m2, o.m2Gram),
      m1: parseGramFromCode(m1, o.m1Gram)
    };
    const activeGrams = Object.values(grams).filter((g) => g > 0);
    const maxGram = activeGrams.length > 0 ? Math.max(...activeGrams) : 0;

    return {
      ...o,
      idx,
      m5, m4, m3, m2, m1,
      grams,
      maxGram,
      m5GramVal: grams.m5,
      totalMeters: Number(o.totalMeters) || 0,
      widthMm: Number(o.widthMm) || 0,
      widthInch: Number(o.widthInch) || 0,
      layers: {}
    };
  });

  ALL_LAYERS.forEach((lk) => {
    let i = 0;
    while (i < n) {
      const code = list[i][lk];
      const width = list[i].widthMm;

      if (!code) {
        list[i].layers[lk] = { code: '', active: false };
        i++;
        continue;
      }

      let j = i;
      let runMeters = list[i].totalMeters;
      while (j + 1 < n && list[j + 1][lk] === code && list[j + 1].widthMm === width) {
        j++;
        runMeters += list[j].totalMeters;
      }

      for (let k = i; k <= j; k++) {
        const prev = k > 0 ? list[k - 1] : null;
        const next = k + 1 < n ? list[k + 1] : null;

        const diffPrev = !prev || prev[lk] !== code || prev.widthMm !== width;
        const diffNext = !next || next[lk] !== code || next.widthMm !== width;

        list[k].layers[lk] = {
          code,
          active: true,
          runMeters,
          diffPrev,
          diffNext,
          prevCode: prev ? prev[lk] || '-' : 'ต้นแผน',
          nextCode: next ? next[lk] || '-' : 'ท้ายแผน',
          isBrokenShort: runMeters < threshold && list[k].totalMeters < threshold
        };
      }
      i = j + 1;
    }
  });

  list.forEach((o, idx) => {
    const prev = idx > 0 ? list[idx - 1] : null;
    const next = idx + 1 < n ? list[idx + 1] : null;

    const brokenLayers = [];
    ALL_LAYERS.forEach((lk) => {
      if (config.checkedLayers[lk]) {
        const info = o.layers[lk];
        if (info && info.active && info.isBrokenShort) {
          brokenLayers.push({
            key: lk,
            name: LAYER_NAMES[lk],
            code: info.code,
            prevCode: info.prevCode,
            nextCode: info.nextCode,
            runMeters: info.runMeters
          });
        }
      }
    });

    const widthChangedBothSides =
      config.checkWidthChange &&
      (!prev || prev.widthMm !== o.widthMm) &&
      (!next || next.widthMm !== o.widthMm);

    o.brokenLayers = brokenLayers;
    o.widthChangedBothSides = widthChangedBothSides;

    const matchFlute =
      config.fluteFilter === 'ALL' ||
      (o.flute && o.flute.toUpperCase() === config.fluteFilter.toUpperCase());

    o.isAnomaly = matchFlute && o.totalMeters < threshold && (brokenLayers.length > 0 || widthChangedBothSides);
    o.matchFlute = matchFlute;
  });

  return list;
}

function syncFluteDropdownOptions(orders) {
  const defaultFlutes = ['BC', 'B', 'C'];
  const foundSet = new Set(defaultFlutes);
  orders.forEach((o) => {
    if (o.flute) foundSet.add(o.flute.toUpperCase());
  });

  ['cfgFluteFilter', 'anaFluteFilter'].forEach((selectId) => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const prevVal = sel.value || 'ALL';
    const isCfg = selectId === 'cfgFluteFilter';
    let html = `<option value="ALL">${isCfg ? 'ทุกลอน (BC, B, C, etc.)' : 'ทุกลอน'}</option>`;
    foundSet.forEach((f) => {
      html += `<option value="${esc(f)}">เฉพาะลอน ${esc(f)}</option>`;
    });
    sel.innerHTML = html;
    sel.value = foundSet.has(prevVal) ? prevVal : 'ALL';
    if (isCfg) state.config.fluteFilter = sel.value;
    else state.analysis.fluteFilter = sel.value;
  });
}

function analyzeAndRender() {
  state.analyzedOrders = analyzeOrders(state.rawOrders, state.threshold, state.config);
  syncFluteDropdownOptions(state.analyzedOrders);
  updateActiveRulesSummary();
  renderTable();
  renderAnalysisView();
}

function updateActiveRulesSummary() {
  const activeLayers = ALL_LAYERS.filter((lk) => state.config.checkedLayers[lk])
    .map((lk) => lk.toUpperCase())
    .join(',');

  const fluteStr = state.config.fluteFilter === 'ALL' ? 'ทุกลอน' : `ลอน ${state.config.fluteFilter}`;
  const widthStr = state.config.checkWidthChange ? '+หน้ากว้าง' : '';

  const summary = `ตรวจ [${activeLayers || 'ไม่มี'}${widthStr}] • ${fluteStr} • เกณฑ์ &lt; ${state.threshold} ม.`;
  document.getElementById('activeRulesSummary').innerHTML = summary;
}

/**
 * Render หน้า 1: ตารางเช็ค M1-M5 ไม่ต่อกัน
 */
function renderTable() {
  const all = state.analyzedOrders;
  const threshold = state.threshold;
  const anomalies = all.filter((o) => o.isAnomaly);

  document.getElementById('anomalyCountBadge').textContent = anomalies.length;
  document.getElementById('allOrderCountBadge').textContent = all.length;
  document.getElementById('totalCountText').textContent = all.length;
  document.getElementById('tabBadgeAnomaly').textContent = anomalies.length;
  document.getElementById('tabBadgeTotal').textContent = all.length;

  if (state.planTitle) {
    document.getElementById('planHeaderTitle').textContent = state.planTitle;
  }

  const tbody = document.getElementById('planTableBody');
  const emptyBox = document.getElementById('emptyBox');

  if (all.length === 0) {
    tbody.innerHTML = '';
    emptyBox.classList.remove('hidden');
    emptyBox.innerHTML = `
      <div class="py-8 text-center text-slate-400 space-y-1">
        <i data-lucide="file-up" class="w-8 h-8 mx-auto text-slate-300 mb-1"></i>
        <div class="text-sm font-bold text-slate-600">ยังไม่มีข้อมูลแผนการผลิต</div>
        <div class="text-xs text-slate-400">กรุณาลากไฟล์ Excel หรือกด "โยน/เลือกไฟล์ Excel" ด้านบนเพื่อเริ่มตรวจสอบ</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let rowsToRender = [];

  if (state.mode === 'anomaly_only') {
    rowsToRender = anomalies.map((o) => ({ type: 'order', order: o, isContext: false }));
  } else if (state.mode === 'all') {
    rowsToRender = all.map((o) => ({ type: 'order', order: o, isContext: false }));
  } else {
    const includedIdx = new Set();
    anomalies.forEach((a) => {
      if (a.idx > 0) includedIdx.add(a.idx - 1);
      includedIdx.add(a.idx);
      if (a.idx + 1 < all.length) includedIdx.add(a.idx + 1);
    });

    const sortedIndices = Array.from(includedIdx).sort((a, b) => a - b);
    sortedIndices.forEach((idx, pos) => {
      if (pos > 0 && sortedIndices[pos - 1] !== idx - 1) {
        rowsToRender.push({ type: 'divider' });
      }
      const ord = all[idx];
      rowsToRender.push({
        type: 'order',
        order: ord,
        isContext: !ord.isAnomaly
      });
    });
  }

  if (rowsToRender.length === 0) {
    tbody.innerHTML = '';
    emptyBox.classList.remove('hidden');
    emptyBox.innerHTML = `
      <div class="py-6 text-center text-emerald-600 font-bold text-xs">
        ✅ ไม่พบออเดอร์ที่ผิดปกติตามเกณฑ์นี้ (ทุกลำดับผ่านเกณฑ์เรียบร้อย)
      </div>
    `;
    return;
  }
  emptyBox.classList.add('hidden');

  tbody.innerHTML = rowsToRender
    .map((item) => {
      if (item.type === 'divider') {
        return `
          <tr class="bg-slate-100 border-y border-slate-300">
            <td colspan="12" class="text-center py-0.5 text-[10px] font-bold text-slate-400">
              ••• ข้ามช่วงออเดอร์ปกติ •••
            </td>
          </tr>
        `;
      }

      const o = item.order;
      const isAnom = o.isAnomaly;
      const isCtx = item.isContext;

      let trClass = 'border-b border-slate-200';
      if (isAnom) trClass = 'bg-rose-50 border-y-2 border-rose-500 font-bold';
      else if (isCtx) trClass = 'bg-slate-50 text-slate-500';
      else trClass = 'bg-white hover:bg-slate-50';

      const seqHtml = isAnom
        ? `<span class="inline-block px-1.5 py-0.5 rounded bg-rose-600 text-white font-black text-xs">${o.seq}</span>`
        : `<span class="text-slate-600 font-bold">${o.seq}</span>`;

      const mCells = ALL_LAYERS.map((lk) => {
        const lInfo = o.layers[lk];
        const isCheckedLayer = state.config.checkedLayers[lk];

        if (!lInfo || !lInfo.active) {
          return `<td class="text-center border-r border-slate-200 text-slate-300 ${!isCheckedLayer ? 'opacity-40' : ''}">-</td>`;
        }

        if (isAnom && lInfo.isBrokenShort && isCheckedLayer) {
          return `
            <td class="text-center border-r border-rose-300 bg-rose-200 text-rose-950 font-black">
              <span class="bg-rose-600 text-white px-1 py-0.2 rounded text-[11px] leading-tight block">${esc(lInfo.code)}</span>
            </td>
          `;
        }

        return `
          <td class="text-center border-r border-slate-200 ${isAnom ? 'text-slate-900 font-bold' : 'text-slate-600'} ${!isCheckedLayer ? 'opacity-50' : ''}">
            ${esc(lInfo.code)}
          </td>
        `;
      }).join('');

      const metersHtml = isAnom
        ? `<strong class="text-rose-600 font-black text-xs sm:text-sm">${o.totalMeters.toLocaleString()}</strong>`
        : `<span class="font-bold ${o.totalMeters < threshold ? 'text-amber-700' : 'text-slate-700'}">${o.totalMeters.toLocaleString()}</span>`;

      let detailHtml = '';
      if (isAnom) {
        const brokenNames = o.brokenLayers.map((b) => `${b.name}(${b.code})`).join(', ');
        detailHtml = `<span class="text-rose-700 font-bold text-[11px]">⚠️ เปลี่ยน ${brokenNames || 'หน้ากว้าง'} ไม่ต่อกัน (วิ่ง ${o.totalMeters} ม.)</span>`;
      } else if (isCtx) {
        detailHtml = `<span class="text-slate-400 text-[10px]">ออเดอร์ข้างเคียง (เทียบลำดับ)</span>`;
      } else {
        detailHtml =
          o.totalMeters < threshold
            ? `<span class="text-emerald-700 text-[10px]">🔗 พ่วงต่อกัน (${o.layers.m5?.runMeters || o.totalMeters} ม.)</span>`
            : `<span class="text-slate-400 text-[10px]">ปกติ</span>`;
      }

      return `
        <tr class="${trClass}">
          <td class="text-center border-r border-slate-200">${seqHtml}</td>
          <td class="border-r border-slate-200 whitespace-nowrap font-bold ${isAnom ? 'text-slate-950' : 'text-slate-700'}">${esc(o.pdr)}</td>
          <td class="border-r border-slate-200 truncate max-w-[160px] ${isAnom ? 'text-slate-900 font-semibold' : 'text-slate-500'}" title="${esc(o.customer)}">${esc(o.customer)}</td>
          <td class="text-center border-r border-slate-200 font-bold">${esc(o.flute)}</td>
          <td class="text-center border-r border-slate-200 font-bold">${o.widthMm}</td>
          ${mCells}
          <td class="text-right border-r border-slate-200 ${isAnom ? 'bg-rose-100/70' : ''}">${metersHtml}</td>
          <td class="truncate max-w-[220px]">${detailHtml}</td>
        </tr>
      `;
    })
    .join('');
}

/**
 * ============================================================================
 * หน้า 2: วิเคราะห์ออเดอร์ (สัดส่วน % ความยาว สั้น/กลาง/ยาว และ แกรม บาง/กลาง/หนา)
 * ============================================================================
 */
function renderAnalysisView() {
  const anaEmptyBox = document.getElementById('anaEmptyBox');
  const anaContent = document.getElementById('anaContent');
  const drillContainer = document.getElementById('anaDrilldownContainer');

  const ordersAll = state.analyzedOrders;
  const fluteFilter = state.analysis.fluteFilter;
  const orders = ordersAll.filter(
    (o) => fluteFilter === 'ALL' || (o.flute && o.flute.toUpperCase() === fluteFilter.toUpperCase())
  );

  document.getElementById('anaPlanTitle').textContent = state.planTitle
    ? `${state.planTitle}${fluteFilter !== 'ALL' ? ` (ลอน ${fluteFilter})` : ''}`
    : 'กรุณาลากไฟล์แผนการผลิต Excel (.xlsx / .csv) มาวาง';

  if (orders.length === 0) {
    anaEmptyBox.classList.remove('hidden');
    anaContent.classList.add('hidden');
    drillContainer.classList.add('hidden');
    document.getElementById('anaTotalOrders').textContent = '0';
    document.getElementById('anaTotalMeters').textContent = '0';
    document.getElementById('anaAvgMeters').textContent = '0';
    lucide.createIcons();
    return;
  }

  anaEmptyBox.classList.add('hidden');
  anaContent.classList.remove('hidden');
  drillContainer.classList.remove('hidden');

  const shortMax = state.analysis.shortMax;
  const longMin = state.analysis.longMin;
  const gramSource = state.analysis.gramSource;

  const totalOrders = orders.length;
  const totalMeters = orders.reduce((s, o) => s + o.totalMeters, 0);
  const avgMeters = totalOrders > 0 ? Math.round(totalMeters / totalOrders) : 0;

  document.getElementById('anaTotalOrders').textContent = totalOrders.toLocaleString();
  document.getElementById('anaTotalMeters').textContent = Math.round(totalMeters).toLocaleString();
  document.getElementById('anaAvgMeters').textContent = avgMeters.toLocaleString();

  // 1) จัดกลุ่มตามความยาวออเดอร์ (สั้น / กลาง / ยาว)
  const lenStats = {
    short: { count: 0, meters: 0 },
    medium: { count: 0, meters: 0 },
    long: { count: 0, meters: 0 }
  };

  // 2) จัดกลุ่มตามแกรมกระดาษ (บาง / กลาง / หนา) + นับแจกแจงแกรมย่อย
  const gramStats = {
    thin: { count: 0, meters: 0, subMap: {} },
    medium: { count: 0, meters: 0, subMap: {} },
    thick: { count: 0, meters: 0, subMap: {} }
  };
  let gramTotalItems = 0;
  let gramTotalMeters = 0;

  // 3) Cross Matrix (Gram x Length) ในระดับออเดอร์
  const matrix = {
    thin: { short: { c: 0, m: 0 }, medium: { c: 0, m: 0 }, long: { c: 0, m: 0 }, total: { c: 0, m: 0 } },
    medium: { short: { c: 0, m: 0 }, medium: { c: 0, m: 0 }, long: { c: 0, m: 0 }, total: { c: 0, m: 0 } },
    thick: { short: { c: 0, m: 0 }, medium: { c: 0, m: 0 }, long: { c: 0, m: 0 }, total: { c: 0, m: 0 } }
  };

  // คำนวณค่าแต่ละออเดอร์
  const enrichedOrders = orders.map((o) => {
    const lenKey = classifyLength(o.totalMeters, shortMax, longMin);
    lenStats[lenKey].count += 1;
    lenStats[lenKey].meters += o.totalMeters;

    // แกรมประจำออเดอร์ (สำหรับตารางไขว้ & รายชื่อออเดอร์)
    const orderGsm = gramSource === 'm5' ? o.m5GramVal : o.maxGram;
    const orderGramKey = classifyGram(orderGsm);

    if (orderGramKey !== 'unknown') {
      matrix[orderGramKey][lenKey].c += 1;
      matrix[orderGramKey][lenKey].m += o.totalMeters;
      matrix[orderGramKey].total.c += 1;
      matrix[orderGramKey].total.m += o.totalMeters;
    }

    if (gramSource === 'all_layers') {
      ALL_LAYERS.forEach((lk) => {
        if (!o[lk]) return;
        const gVal = o.grams[lk];
        const gKey = classifyGram(gVal);
        if (gKey !== 'unknown') {
          gramStats[gKey].count += 1;
          gramStats[gKey].meters += o.totalMeters;
          gramStats[gKey].subMap[gVal] = (gramStats[gKey].subMap[gVal] || 0) + 1;
          gramTotalItems += 1;
          gramTotalMeters += o.totalMeters;
        }
      });
    } else {
      if (orderGramKey !== 'unknown') {
        gramStats[orderGramKey].count += 1;
        gramStats[orderGramKey].meters += o.totalMeters;
        gramStats[orderGramKey].subMap[orderGsm] = (gramStats[orderGramKey].subMap[orderGsm] || 0) + 1;
        gramTotalItems += 1;
        gramTotalMeters += o.totalMeters;
      }
    }

    return {
      ...o,
      lenKey,
      orderGsm,
      orderGramKey
    };
  });

  // --- สรุปผลแผนการผลิต (Verdict Banner) ---
  const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);

  const lenSummaryList = LEN_GROUPS.map((g) => ({
    ...g,
    count: lenStats[g.key].count,
    meters: lenStats[g.key].meters,
    countPct: pct(lenStats[g.key].count, totalOrders),
    meterPct: pct(lenStats[g.key].meters, totalMeters)
  }));

  const sortedByCount = [...lenSummaryList].sort((a, b) => b.count - a.count);
  const sortedByMeters = [...lenSummaryList].sort((a, b) => b.meters - a.meters);
  const topLenByCount = sortedByCount[0];
  const topLenByMeters = sortedByMeters[0];

  const gramSummaryList = GRAM_GROUPS.map((g) => ({
    ...g,
    count: gramStats[g.key].count,
    meters: gramStats[g.key].meters,
    countPct: pct(gramStats[g.key].count, gramTotalItems),
    meterPct: pct(gramStats[g.key].meters, gramTotalMeters),
    subMap: gramStats[g.key].subMap
  }));
  const topGram = [...gramSummaryList].sort((a, b) => b.count - a.count)[0];

  // Styling for Verdict Box based on dominant length category
  const verdictBox = document.getElementById('anaVerdictBox');
  const verdictBadge = document.getElementById('anaMainVerdictBadge');
  verdictBox.className = `rounded-xl border-2 p-3.5 flex flex-wrap items-center justify-between gap-3 ${topLenByCount.lightBg} ${topLenByCount.border}`;
  verdictBadge.className = `text-sm sm:text-base font-black px-2.5 py-0.5 rounded-md text-white ${topLenByCount.color}`;
  verdictBadge.textContent = `แผนนี้เน้น "${topLenByCount.label}" (${topLenByCount.countPct.toFixed(1)}%)`;

  document.getElementById('anaVerdictDetail').innerHTML =
    `สัดส่วนจำนวนใบ: <strong class="text-rose-700">สั้น ${lenSummaryList[0].countPct.toFixed(1)}%</strong> (${lenSummaryList[0].count} ใบ) • ` +
    `<strong class="text-amber-700">กลาง ${lenSummaryList[1].countPct.toFixed(1)}%</strong> (${lenSummaryList[1].count} ใบ) • ` +
    `<strong class="text-emerald-700">ยาว ${lenSummaryList[2].countPct.toFixed(1)}%</strong> (${lenSummaryList[2].count} ใบ)`;

  document.getElementById('anaVerdictMeterNote').innerHTML =
    `ด้านความยาวเมตรวิ่งเครื่อง: กลุ่ม <strong>${topLenByMeters.label}</strong> กินระยะทางมากที่สุด <strong>${topLenByMeters.meterPct.toFixed(1)}%</strong> (${Math.round(topLenByMeters.meters).toLocaleString()} ม. จากทั้งหมด ${Math.round(totalMeters).toLocaleString()} ม.)`;

  document.getElementById('anaGramVerdictText').innerHTML =
    `${topGram.label} <span class="text-xs font-bold text-slate-600">(${topGram.countPct.toFixed(1)}%)</span>`;

  // --- Render Stacked Bars สำหรับความยาว (สั้น/กลาง/ยาว) ---
  renderStackedBar('lenCountBar', 'lenCountBarLabels', lenSummaryList, 'countPct', (g) => `${g.label} ${g.countPct.toFixed(1)}%`);
  renderStackedBar('lenMeterBar', 'lenMeterBarLabels', lenSummaryList, 'meterPct', (g) => `${g.label} ${g.meterPct.toFixed(1)}%`);

  // --- Render 3 Cards ความยาว ---
  const lenSubLabels = {
    short: `ต่ำกว่า ${shortMax} เมตร`,
    medium: `${shortMax} – ${longMin - 1} เมตร`,
    long: `${longMin} เมตรขึ้นไป`
  };
  document.getElementById('lenCardsGrid').innerHTML = lenSummaryList
    .map((g) => {
      const avg = g.count > 0 ? Math.round(g.meters / g.count) : 0;
      return `
        <div onclick="setAnalysisDrillFilter('ALL','${g.key}')" class="bg-white rounded-xl border ${g.border} p-3 shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-400 transition">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-extrabold text-sm ${g.text}">${g.label}</div>
              <div class="text-[11px] text-slate-500 font-medium">${lenSubLabels[g.key]}</div>
            </div>
            <div class="text-right">
              <div class="text-xl font-black ${g.text}">${g.countPct.toFixed(1)}%</div>
              <div class="text-[10px] text-slate-400">ของจำนวนใบ</div>
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-1 text-center text-[11px]">
            <div class="bg-slate-50 rounded p-1">
              <div class="text-slate-400 text-[10px]">จำนวน</div>
              <div class="font-extrabold text-slate-800">${g.count} ใบ</div>
            </div>
            <div class="bg-slate-50 rounded p-1">
              <div class="text-slate-400 text-[10px]">รวมเมตร</div>
              <div class="font-extrabold text-slate-800">${Math.round(g.meters).toLocaleString()} ม.</div>
            </div>
            <div class="bg-slate-50 rounded p-1">
              <div class="text-slate-400 text-[10px]">% เมตร</div>
              <div class="font-extrabold ${g.text}">${g.meterPct.toFixed(1)}%</div>
            </div>
          </div>
          <div class="mt-1.5 text-[10px] text-slate-400 text-right">เฉลี่ย ${avg.toLocaleString()} ม./ใบ</div>
        </div>
      `;
    })
    .join('');

  // --- Render Stacked Bar & 3 Cards สำหรับแกรม (บาง/กลาง/หนา) ---
  const gramModeTitles = {
    max: 'แกรมสูงสุดในออเดอร์ (M5-M1)',
    m5: 'แกรมกระดาษหน้า (M5)',
    all_layers: 'นับรวมทุกชั้นม้วนกระดาษ (M5-M1)'
  };
  document.getElementById('anaGramModeTitle').textContent = gramModeTitles[gramSource];
  document.getElementById('gramBarTitle').textContent =
    gramSource === 'all_layers' ? 'สัดส่วนกลุ่มแกรม (% ของจำนวนม้วนที่ใช้ทั้งหมด)' : 'สัดส่วนกลุ่มแกรม (% ของจำนวนออเดอร์)';

  renderStackedBar('gramCountBar', 'gramBarLabels', gramSummaryList, 'countPct', (g) => `${g.label} ${g.countPct.toFixed(1)}%`);

  const unitLabel = gramSource === 'all_layers' ? 'ชั้น/ม้วน' : 'ใบ';
  document.getElementById('gramCardsGrid').innerHTML = gramSummaryList
    .map((g) => {
      const subBadges = Object.entries(g.subMap)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([gsm, cnt]) => `<span class="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[10px]">${gsm}g: ${cnt}</span>`)
        .join(' ');

      return `
        <div onclick="setAnalysisDrillFilter('${g.key}','ALL')" class="bg-white rounded-xl border ${g.border} p-3 shadow-sm cursor-pointer hover:ring-2 hover:ring-blue-400 transition flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <div>
                <div class="font-extrabold text-sm ${g.text}">${g.label}</div>
                <div class="text-[11px] text-slate-500 font-medium">${g.sub}</div>
              </div>
              <div class="text-right">
                <div class="text-xl font-black ${g.text}">${g.countPct.toFixed(1)}%</div>
                <div class="text-[10px] text-slate-400">${g.count} ${unitLabel}</div>
              </div>
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <span class="text-slate-500">ระยะวิ่งรวม: <strong class="text-slate-800">${Math.round(g.meters).toLocaleString()} ม.</strong></span>
              <span class="font-bold ${g.text}">(${g.meterPct.toFixed(1)}% เมตร)</span>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap gap-1">
            ${subBadges || '<span class="text-[10px] text-slate-300">-</span>'}
          </div>
        </div>
      `;
    })
    .join('');

  // --- Render Cross Matrix 3x3 ---
  const matrixRowsHtml = GRAM_GROUPS.map((gg) => {
    const row = matrix[gg.key];
    const cellsHtml = LEN_GROUPS.map((lg) => {
      const cell = row[lg.key];
      const cellPct = pct(cell.c, totalOrders);
      const isZero = cell.c === 0;
      return `
        <td onclick="setAnalysisDrillFilter('${gg.key}','${lg.key}')" class="py-2 px-2 border-r border-slate-200 cursor-pointer hover:bg-blue-50 transition ${isZero ? 'text-slate-300' : ''}">
          <div class="font-extrabold text-xs ${isZero ? 'text-slate-300' : 'text-slate-900'}">
            ${cell.c} ใบ <span class="text-[10px] font-bold ${isZero ? 'text-slate-300' : gg.text}">(${cellPct.toFixed(1)}%)</span>
          </div>
          <div class="text-[10px] ${isZero ? 'text-slate-300' : 'text-slate-500'}">${Math.round(cell.m).toLocaleString()} ม.</div>
        </td>
      `;
    }).join('');

    const rowPct = pct(row.total.c, totalOrders);
    return `
      <tr class="hover:bg-slate-50">
        <td class="py-2 px-3 text-left border-r border-slate-200 font-bold ${gg.text} ${gg.lightBg}">
          ${gg.label} <span class="block text-[10px] font-normal text-slate-500">${gg.sub}</span>
        </td>
        ${cellsHtml}
        <td onclick="setAnalysisDrillFilter('${gg.key}','ALL')" class="py-2 px-2 bg-slate-100 font-extrabold text-slate-900 cursor-pointer hover:bg-slate-200">
          <div>${row.total.c} ใบ (${rowPct.toFixed(1)}%)</div>
          <div class="text-[10px] font-normal text-slate-600">${Math.round(row.total.m).toLocaleString()} ม.</div>
        </td>
      </tr>
    `;
  }).join('');

  const totalRowCells = LEN_GROUPS.map((lg) => {
    const ls = lenStats[lg.key];
    const p = pct(ls.count, totalOrders);
    return `
      <td onclick="setAnalysisDrillFilter('ALL','${lg.key}')" class="py-2 px-2 border-r border-slate-300 cursor-pointer hover:bg-slate-300">
        <div>${ls.count} ใบ (${p.toFixed(1)}%)</div>
        <div class="text-[10px] font-normal text-slate-600">${Math.round(ls.meters).toLocaleString()} ม.</div>
      </td>
    `;
  }).join('');

  document.getElementById('crossMatrixBody').innerHTML =
    matrixRowsHtml +
    `
    <tr class="bg-slate-200 font-extrabold text-slate-900 border-t-2 border-slate-300">
      <td class="py-2 px-3 text-left border-r border-slate-300">รวมทั้งหมด</td>
      ${totalRowCells}
      <td onclick="setAnalysisDrillFilter('ALL','ALL')" class="py-2 px-2 bg-slate-800 text-white cursor-pointer">
        <div>${totalOrders} ใบ (100%)</div>
        <div class="text-[10px] font-normal text-amber-300">${Math.round(totalMeters).toLocaleString()} ม.</div>
      </td>
    </tr>
    `;

  // --- Render Drill-down Order Table ---
  state._lastEnrichedAnalysisOrders = enrichedOrders;
  renderAnalysisDrillTable();
  syncDrilldownPosition();
  lucide.createIcons();
}

function renderStackedBar(barId, labelId, items, pctKey, labelFormatter) {
  const barEl = document.getElementById(barId);
  const lblEl = document.getElementById(labelId);

  barEl.innerHTML = items
    .map((item) => {
      const val = item[pctKey];
      if (val <= 0) return '';
      return `
        <div style="width: ${val.toFixed(2)}%" class="${item.color} flex items-center justify-center border-r border-white/30 last:border-r-0 overflow-hidden whitespace-nowrap px-1" title="${item.label}: ${val.toFixed(1)}%">
          ${val >= 9 ? `${val.toFixed(1)}%` : ''}
        </div>
      `;
    })
    .join('');

  lblEl.innerHTML = items.map((item) => labelFormatter(item)).join(' • ');
}

window.setAnalysisDrillFilter = function (gramKey, lenKey) {
  state.analysis.drillGram = gramKey;
  state.analysis.drillLen = lenKey;
  renderAnalysisDrillTable();
};

function renderAnalysisDrillTable() {
  const list = state._lastEnrichedAnalysisOrders || [];
  const fg = state.analysis.drillGram;
  const fl = state.analysis.drillLen;

  const filtered = list.filter((o) => {
    const matchG = fg === 'ALL' || o.orderGramKey === fg;
    const matchL = fl === 'ALL' || o.lenKey === fl;
    return matchG && matchL;
  });

  const gLabelMap = { ALL: 'ทุกแกรม', thin: 'แกรมบาง', medium: 'แกรมกลาง', thick: 'แกรมหนา' };
  const lLabelMap = { ALL: 'ทุกความยาว', short: 'ออเดอร์สั้น', medium: 'ออเดอร์กลาง', long: 'ออเดอร์ยาว' };
  document.getElementById('anaDrillFilterBadge').textContent =
    `${gLabelMap[fg]} • ${lLabelMap[fl]} (${filtered.length} ใบ)`;

  const gBadgeMap = Object.fromEntries(GRAM_GROUPS.map((g) => [g.key, g]));
  const lBadgeMap = Object.fromEntries(LEN_GROUPS.map((l) => [l.key, l]));

  document.getElementById('anaDrillTableBody').innerHTML = filtered
    .map((o) => {
      const gg = gBadgeMap[o.orderGramKey];
      const lg = lBadgeMap[o.lenKey];
      const layersStr = ALL_LAYERS.map((lk) => o[lk]).filter(Boolean).join(' / ');

      return `
        <tr class="hover:bg-slate-50">
          <td class="text-center border-r border-slate-200 font-bold text-slate-600">${o.seq}</td>
          <td class="border-r border-slate-200 font-bold text-slate-900 whitespace-nowrap">${esc(o.pdr)}</td>
          <td class="border-r border-slate-200 truncate max-w-[170px]" title="${esc(o.customer)}">${esc(o.customer)}</td>
          <td class="text-center border-r border-slate-200 font-bold">${esc(o.flute)}</td>
          <td class="text-center border-r border-slate-200 font-bold">${o.widthMm}</td>
          <td class="border-r border-slate-200 text-[11px] text-slate-600 font-medium">${esc(layersStr)}</td>
          <td class="text-center border-r border-slate-200 font-extrabold text-slate-900">${o.orderGsm > 0 ? `${o.orderGsm} g` : '-'}</td>
          <td class="text-center border-r border-slate-200">
            ${gg ? `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${gg.badge}">${gg.label}</span>` : '-'}
          </td>
          <td class="text-right border-r border-slate-200 font-extrabold text-slate-900">${o.totalMeters.toLocaleString()}</td>
          <td class="text-center">
            ${lg ? `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${lg.badge}">${lg.label}</span>` : '-'}
          </td>
        </tr>
      `;
    })
    .join('');
}

function readExcelFile(file) {
  const reader = new FileReader();
  const isCsv = file.name.toLowerCase().endsWith('.csv');

  reader.onload = (e) => {
    try {
      let wb;
      if (isCsv) {
        const txt = new TextDecoder('utf-8').decode(e.target.result);
        wb = XLSX.read(txt, { type: 'string', raw: false });
      } else {
        wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', raw: false });
      }

      state.sheets = {};
      const validNames = [];

      wb.SheetNames.forEach((name) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
        const parsed = extractPlanFromRows(rows, `${file.name} (${name})`);
        if (parsed && parsed.orders.length > 0) {
          state.sheets[name] = parsed;
          validNames.push(name);
        }
      });

      if (validNames.length === 0) {
        notify('ไม่พบตารางแผนผลิตที่มีคอลัมน์ M5–M1 และ ยาวรวม (เมตร)', true);
        return;
      }

      const sheetBar = document.getElementById('sheetBar');
      const sheetButtons = document.getElementById('sheetButtons');
      if (validNames.length > 1) {
        sheetBar.classList.remove('hidden');
        sheetButtons.innerHTML = validNames
          .map(
            (n, idx) =>
              `<button type="button" onclick="switchSheet('${esc(n)}')" class="sh-btn px-2 py-0.5 rounded text-xs font-bold ${
                idx === 0 ? 'bg-amber-600 text-white' : 'bg-white text-amber-900 border border-amber-300'
              }" data-sheet="${esc(n)}">${esc(n)} (${state.sheets[n].orders.length})</button>`
          )
          .join('');
      } else {
        sheetBar.classList.add('hidden');
      }

      switchSheet(validNames[0], file.name);
      notify(`โหลดไฟล์ "${file.name}" สำเร็จ!`);
    } catch (err) {
      console.error(err);
      notify('อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบไฟล์ Excel', true);
    }
  };

  reader.readAsArrayBuffer(file);
}

window.switchSheet = function (sheetName, fileLabel = '') {
  const data = state.sheets[sheetName];
  if (!data) return;

  state.planTitle = data.planTitle;
  state.rawOrders = data.orders;
  document.getElementById('fileStatusText').textContent = `ไฟล์: ${fileLabel || sheetName} — ${data.planTitle} (${data.orders.length} ออเดอร์)`;

  document.querySelectorAll('.sh-btn').forEach((b) => {
    b.className =
      b.getAttribute('data-sheet') === sheetName
        ? 'sh-btn px-2 py-0.5 rounded text-xs font-bold bg-amber-600 text-white'
        : 'sh-btn px-2 py-0.5 rounded text-xs font-bold bg-white text-amber-900 border border-amber-300';
  });

  analyzeAndRender();
};

function extractPlanFromRows(rows, fallbackTitle) {
  let hIdx = -1;
  let map = {};
  let title = '';

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    for (let c = 0; c < Math.min(row.length, 40); c++) {
      const txt = String(row[c] || '').trim();
      if (txt.includes('PLAN') && (txt.includes('วันที่') || txt.includes('MC'))) {
        title = txt;
      }
    }

    const cells = row.map((c) => String(c || '').replace(/\s+/g, ' ').trim());
    const hasM5 = cells.some((t) => /^M5\.?$/i.test(t));
    const hasM1 = cells.some((t) => /^M1\.?$/i.test(t));
    const hasMeters = cells.some((t) => t.includes('ยาวรวม') && t.includes('เมตร'));

    if (hasM5 && hasM1 && hasMeters) {
      hIdx = r;
      cells.forEach((col, i) => {
        if (!col) return;
        const low = col.toLowerCase();
        if (col === 'ลำดับที่' && map.seq === undefined) map.seq = i;
        else if (low.includes('prod') && low.includes('order') && map.pdr === undefined) map.pdr = i;
        else if (col.includes('ชื่อลูกค้า') && map.customer === undefined) map.customer = i;
        else if (col === 'ลอน' && map.flute === undefined) map.flute = i;
        else if (/^M5\.?$/i.test(col) && map.m5 === undefined) map.m5 = i;
        else if (/^M4\.?$/i.test(col) && map.m4 === undefined) map.m4 = i;
        else if (/^M3\.?$/i.test(col) && map.m3 === undefined) map.m3 = i;
        else if (/^M2\.?$/i.test(col) && map.m2 === undefined) map.m2 = i;
        else if (/^M1\.?$/i.test(col) && map.m1 === undefined) map.m1 = i;
        else if (col === 'M5 แกรม' && map.m5Gram === undefined) map.m5Gram = i;
        else if (col === 'M4 แกรม' && map.m4Gram === undefined) map.m4Gram = i;
        else if (col === 'M3 แกรม' && map.m3Gram === undefined) map.m3Gram = i;
        else if (col === 'M2 แกรม' && map.m2Gram === undefined) map.m2Gram = i;
        else if (col === 'M1 แกรม' && map.m1Gram === undefined) map.m1Gram = i;
        else if (col.includes('กว้าง') && col.includes('นิ้ว') && map.widthInch === undefined) map.widthInch = i;
        else if ((col === 'กว้าง W' || col === 'หน้ากว้าง') && map.widthMm === undefined) map.widthMm = i;
        else if (col.includes('ยาวรวม') && col.includes('เมตร') && map.totalMeters === undefined) map.totalMeters = i;
      });
      break;
    }
  }

  if (hIdx === -1) return null;

  const orders = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const rawSeq = String(row[map.seq] ?? '').trim();
    const rawPdr = String(row[map.pdr] ?? '').trim();

    if (rawSeq.includes('ผู้จัดทำ') || rawSeq.includes('ปริมาณการใช้') || rawSeq === 'Code' || rawSeq === 'Gen Tag') {
      break;
    }

    const seq = parseFloat(rawSeq);
    if (isNaN(seq) || seq <= 0 || !rawPdr || rawPdr === '0' || rawPdr === 'NaN') continue;

    orders.push({
      seq,
      pdr: rawPdr,
      customer: String(row[map.customer] ?? '').trim(),
      flute: String(row[map.flute] ?? '').trim(),
      m5: String(row[map.m5] ?? '').trim(),
      m4: String(row[map.m4] ?? '').trim(),
      m3: String(row[map.m3] ?? '').trim(),
      m2: String(row[map.m2] ?? '').trim(),
      m1: String(row[map.m1] ?? '').trim(),
      m5Gram: toNum(row[map.m5Gram]),
      m4Gram: toNum(row[map.m4Gram]),
      m3Gram: toNum(row[map.m3Gram]),
      m2Gram: toNum(row[map.m2Gram]),
      m1Gram: toNum(row[map.m1Gram]),
      widthInch: toNum(row[map.widthInch]),
      widthMm: toNum(row[map.widthMm]),
      totalMeters: toNum(row[map.totalMeters])
    });
  }

  return { planTitle: title || fallbackTitle, orders };
}

function toNum(v) {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

async function exportImage(el, filename, copyClipboard) {
  try {
    notify('กำลังสร้างรูปภาพคมชัดสูง...');
    const canvas = await html2canvas(el, {
      scale: 3,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    if (copyClipboard && navigator.clipboard && window.ClipboardItem) {
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          notify('✅ คัดลอกรูปแล้ว! กด Ctrl+V วางใน LINE ได้เลย');
        } catch {
          downloadCanvas(canvas, 'สรุปแผนผลิต.png');
        }
      }, 'image/png');
    } else {
      downloadCanvas(canvas, filename);
      notify(`✅ บันทึกรูปภาพ "${filename}" เรียบร้อย!`);
    }
  } catch (e) {
    console.error(e);
    notify('เกิดข้อผิดพลาดในการสร้างรูปภาพ', true);
  }
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = canvas.toDataURL('image/png', 1.0);
  a.click();
}

function notify(msg, isErr = false) {
  const toast = document.getElementById('toast');
  const box = document.getElementById('toastBox');
  document.getElementById('toastText').textContent = msg;
  box.className = isErr
    ? 'bg-rose-700 text-white px-3 py-1.5 rounded shadow text-xs font-bold flex items-center gap-1.5'
    : 'bg-slate-900 text-white px-3 py-1.5 rounded shadow text-xs font-bold flex items-center gap-1.5';
  toast.classList.remove('hidden');
  clearTimeout(window._t);
  window._t = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
