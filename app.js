/**
 * ระบบเช็คแผนผลิตกระดาษลูกฟูก (แบบช่องกะทัดรัด แคบ ไม่กินที่)
 */

const LAYERS = ['m5', 'm4', 'm3', 'm2', 'm1'];
const LAYER_NAMES = { m5: 'M5', m4: 'M4', m3: 'M3', m2: 'M2', m1: 'M1' };

let state = {
  planTitle: '',
  rawOrders: [],
  analyzedOrders: [],
  mode: 'anomaly_with_context', // 'anomaly_with_context' | 'anomaly_only' | 'all'
  threshold: 300,
  sheets: {}
};

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  bindEvents();
  loadSample();
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

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.getAttribute('data-mode');
      document.querySelectorAll('.mode-btn').forEach((b) => {
        if (b.getAttribute('data-mode') === state.mode) {
          b.className = 'mode-btn px-2.5 py-1 rounded bg-rose-600 text-white shadow-sm transition';
        } else {
          b.className = 'mode-btn px-2.5 py-1 rounded text-slate-600 hover:text-slate-900 transition';
        }
      });
      renderTable();
    });
  });

  document.getElementById('thresholdInput').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) {
      state.threshold = val;
      document.querySelectorAll('.th-val').forEach((el) => (el.textContent = val));
      analyzeAndRender();
    }
  });

  document.getElementById('btnSaveImg').addEventListener('click', () => {
    const area = document.getElementById('captureArea');
    const cleanName = (state.planTitle || 'Plan').replace(/[^a-zA-Z0-9ก-๙_-]/g, '_');
    exportImage(area, `สรุปแผนผลิต_${cleanName}.png`, false);
  });

  document.getElementById('btnCopyImg').addEventListener('click', () => {
    const area = document.getElementById('captureArea');
    exportImage(area, 'clipboard.png', true);
  });
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

function analyzeOrders(orders, threshold) {
  const n = orders.length;
  const list = orders.map((o, idx) => ({
    ...o,
    idx,
    m5: cleanCode(o.m5),
    m4: cleanCode(o.m4),
    m3: cleanCode(o.m3),
    m2: cleanCode(o.m2),
    m1: cleanCode(o.m1),
    totalMeters: Number(o.totalMeters) || 0,
    widthMm: Number(o.widthMm) || 0,
    widthInch: Number(o.widthInch) || 0,
    layers: {}
  }));

  LAYERS.forEach((lk) => {
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
    LAYERS.forEach((lk) => {
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
    });

    const widthChangedBothSides =
      (!prev || prev.widthMm !== o.widthMm) && (!next || next.widthMm !== o.widthMm);

    o.brokenLayers = brokenLayers;
    o.widthChangedBothSides = widthChangedBothSides;
    o.isAnomaly = o.totalMeters < threshold && (brokenLayers.length > 0 || widthChangedBothSides);
  });

  return list;
}

function analyzeAndRender() {
  state.analyzedOrders = analyzeOrders(state.rawOrders, state.threshold);
  renderTable();
}

function renderTable() {
  const all = state.analyzedOrders;
  const threshold = state.threshold;
  const anomalies = all.filter((o) => o.isAnomaly);

  document.getElementById('planHeaderTitle').textContent = state.planTitle || 'แผนการผลิตกระดาษลูกฟูก';
  document.getElementById('anomalyCountBadge').textContent = anomalies.length;
  document.getElementById('allOrderCountBadge').textContent = all.length;
  document.getElementById('totalCountText').textContent = all.length;

  const tbody = document.getElementById('planTableBody');
  const emptyBox = document.getElementById('emptyBox');

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
      if (isAnom) {
        trClass = 'bg-rose-50 border-y-2 border-rose-500 font-bold';
      } else if (isCtx) {
        trClass = 'bg-slate-50 text-slate-500';
      } else {
        trClass = 'bg-white hover:bg-slate-50';
      }

      // ลำดับ
      const seqHtml = isAnom
        ? `<span class="inline-block px-1.5 py-0.5 rounded bg-rose-600 text-white font-black text-xs">${o.seq}</span>`
        : `<span class="text-slate-600 font-bold">${o.seq}</span>`;

      // M5 - M1 ขนาดแคบกะทัดรัด
      const mCells = LAYERS.map((lk) => {
        const lInfo = o.layers[lk];
        if (!lInfo || !lInfo.active) {
          return `<td class="text-center border-r border-slate-200 text-slate-300">-</td>`;
        }

        if (isAnom && lInfo.isBrokenShort) {
          return `
            <td class="text-center border-r border-rose-300 bg-rose-200 text-rose-950 font-black">
              <span class="bg-rose-600 text-white px-1 py-0.2 rounded text-[11px] leading-tight block">${esc(lInfo.code)}</span>
            </td>
          `;
        }

        return `
          <td class="text-center border-r border-slate-200 ${isAnom ? 'text-slate-900 font-bold' : 'text-slate-600'}">
            ${esc(lInfo.code)}
          </td>
        `;
      }).join('');

      // เมตร
      const metersHtml = isAnom
        ? `<strong class="text-rose-600 font-black text-xs sm:text-sm">${o.totalMeters.toLocaleString()}</strong>`
        : `<span class="font-bold ${o.totalMeters < threshold ? 'text-amber-700' : 'text-slate-700'}">${o.totalMeters.toLocaleString()}</span>`;

      // สาเหตุแบบสั้นกระชับ
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
