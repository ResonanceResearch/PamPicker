import { parseGenBankText } from './parser.js';
import { findPamSites } from './pam.js';

const state = {
  records: [],
  currentRecordIndex: 0,
  currentSites: [],
  filteredSites: [],
  selectedIds: new Set(),
  zoom: 1.2,
  demoLoaded: false,
  viewStart: 1,
};

const el = {
  fileInput: document.getElementById('fileInput'),
  loadDemoBtn: document.getElementById('loadDemoBtn'),
  recordSelect: document.getElementById('recordSelect'),
  allowGAtW: document.getElementById('allowGAtW'),
  prefer21G: document.getElementById('prefer21G'),
  showNumbers: document.getElementById('showNumbers'),
  showPlus: document.getElementById('showPlus'),
  showMinus: document.getElementById('showMinus'),
  showPattern1: document.getElementById('showPattern1'),
  showPattern2: document.getElementById('showPattern2'),
  featureNameFilter: document.getElementById('featureNameFilter'),
  tableFilter: document.getElementById('tableFilter'),
  zoomRange: document.getElementById('zoomRange'),
  zoomValue: document.getElementById('zoomValue'),
  scanBtn: document.getElementById('scanBtn'),
  resetViewBtn: document.getElementById('resetViewBtn'),
  clearSelectionBtn: document.getElementById('clearSelectionBtn'),
  exportAllCsvBtn: document.getElementById('exportAllCsvBtn'),
  exportAllTsvBtn: document.getElementById('exportAllTsvBtn'),
  copySelectedBtn: document.getElementById('copySelectedBtn'),
  exportSelectedBtn: document.getElementById('exportSelectedBtn'),
  viewerContainer: document.getElementById('viewerContainer'),
  viewerInner: document.getElementById('viewerInner'),
  genomeSvg: document.getElementById('genomeSvg'),
  recordSummary: document.getElementById('recordSummary'),
  legend: document.getElementById('legend'),
  statsGrid: document.getElementById('statsGrid'),
  resultsTableBody: document.querySelector('#resultsTable tbody'),
  selectedList: document.getElementById('selectedList'),
  pairSummary: document.getElementById('pairSummary'),
};

function init() {
  bindEvents();
  renderEmptyState();
  populateRecordSelect();
}

function bindEvents() {
  el.fileInput.addEventListener('change', onFilesUploaded);
  el.loadDemoBtn.addEventListener('click', loadDemo);
  el.recordSelect.addEventListener('change', () => {
    state.currentRecordIndex = Number(el.recordSelect.value) || 0;
    resetView();
    rescan();
  });
  el.scanBtn.addEventListener('click', rescan);
  el.featureNameFilter.addEventListener('input', applyFilters);
  el.tableFilter.addEventListener('input', renderResultsTable);
  el.zoomRange.addEventListener('input', onZoomChanged);
  el.resetViewBtn.addEventListener('click', resetView);
  el.clearSelectionBtn.addEventListener('click', () => {
    state.selectedIds.clear();
    renderAll();
  });
  el.exportAllCsvBtn.addEventListener('click', () => exportSites(state.filteredSites, 'csv'));
  el.exportAllTsvBtn.addEventListener('click', () => exportSites(state.filteredSites, 'tsv'));
  el.exportSelectedBtn.addEventListener('click', exportSelectedSites);
  el.copySelectedBtn.addEventListener('click', copySelectedSpacers);

  [
    el.allowGAtW,
    el.prefer21G,
    el.showNumbers,
    el.showPlus,
    el.showMinus,
    el.showPattern1,
    el.showPattern2,
  ].forEach(control => control.addEventListener('change', rescan));

  enableDragPanning(el.viewerContainer);
  enableWheelZoom(el.viewerContainer);
}

async function onFilesUploaded(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const records = [];
  for (const file of files) {
    const text = await file.text();
    records.push(...parseGenBankText(text, file.name));
  }

  if (!records.length) {
    window.alert('No GenBank records could be parsed from the uploaded files.');
    return;
  }

  state.records = records;
  state.currentRecordIndex = 0;
  state.selectedIds.clear();
  populateRecordSelect();
  resetView();
  rescan();
}

async function loadDemo() {
  const response = await fetch('./data/demo_phage.gb');
  const text = await response.text();
  state.records = parseGenBankText(text, 'demo_phage.gb');
  state.currentRecordIndex = 0;
  state.selectedIds.clear();
  state.demoLoaded = true;
  populateRecordSelect();
  resetView();
  rescan();
}

function populateRecordSelect() {
  el.recordSelect.innerHTML = '';
  if (!state.records.length) {
    const option = document.createElement('option');
    option.textContent = 'Upload or load a GenBank file';
    option.value = '0';
    el.recordSelect.appendChild(option);
    return;
  }

  state.records.forEach((record, idx) => {
    const option = document.createElement('option');
    option.value = String(idx);
    option.textContent = `${record.locus} (${record.length.toLocaleString()} bp)`;
    el.recordSelect.appendChild(option);
  });

  el.recordSelect.value = String(state.currentRecordIndex);
}

function rescan() {
  const record = state.records[state.currentRecordIndex];
  if (!record) {
    renderEmptyState();
    return;
  }

  state.currentSites = findPamSites(record, {
    allowGAtW: el.allowGAtW.checked,
    prefer21G: el.prefer21G.checked,
    showPlus: el.showPlus.checked,
    showMinus: el.showMinus.checked,
    showPattern1: el.showPattern1.checked,
    showPattern2: el.showPattern2.checked,
  });

  constrainView();
  applyFilters();
}

function applyFilters() {
  const record = state.records[state.currentRecordIndex];
  if (!record) return;

  const featureFilter = el.featureNameFilter.value.trim().toLowerCase();
  state.filteredSites = state.currentSites.filter(site => {
    if (!featureFilter) return true;
    const haystack = [site.featureName, site.featureType, site.featureSpan, site.spacerSeq5to3, site.pamSeq5to3]
      .join(' ')
      .toLowerCase();
    return haystack.includes(featureFilter);
  });

  const allowedIds = new Set(state.currentSites.map(site => site.id));
  state.selectedIds = new Set([...state.selectedIds].filter(id => allowedIds.has(id)));

  constrainView();
  renderAll();
}

function renderAll() {
  renderSummary();
  renderStats();
  renderLegend();
  renderGenome();
  renderResultsTable();
  renderSelectedList();
}

function renderEmptyState() {
  el.recordSummary.innerHTML = '<span class="muted">No sequence loaded.</span>';
  el.statsGrid.innerHTML = '';
  el.genomeSvg.innerHTML = '';
  el.resultsTableBody.innerHTML = '<tr><td colspan="8" class="muted">Upload a GenBank file to begin.</td></tr>';
  el.selectedList.innerHTML = 'No PAM sites selected yet.';
  el.selectedList.className = 'selected-list empty-state';
  el.pairSummary.innerHTML = 'Select one or more PAM sites to assemble a candidate set for export.';
  el.legend.innerHTML = '';
}

function renderSummary() {
  const record = state.records[state.currentRecordIndex];
  const view = getViewRange(record);
  const chips = [
    chip(record.locus),
    chip(`${record.length.toLocaleString()} bp`),
    chip(`View: ${view.start.toLocaleString()}..${view.end.toLocaleString()}`),
    record.accession ? chip(`Accession: ${record.accession}`) : '',
    record.definition ? chip(record.definition) : '',
  ].filter(Boolean).join('');
  el.recordSummary.innerHTML = chips;
}

function chip(label) {
  return `<span class="record-chip">${escapeHtml(label)}</span>`;
}

function renderStats() {
  const total = state.filteredSites.length;
  const plus = state.filteredSites.filter(s => s.strand === '+').length;
  const minus = state.filteredSites.filter(s => s.strand === '-').length;
  const pattern1 = state.filteredSites.filter(s => s.patternKey === 'NNAGAAW').length;
  const pattern2 = state.filteredSites.filter(s => s.patternKey === 'NNGGAA').length;
  const selected = getSelectedSites().length;

  const cards = [
    ['Filtered PAMs', total.toLocaleString()],
    ['+ strand', plus.toLocaleString()],
    ['− strand', minus.toLocaleString()],
    ['NNAGAAW', pattern1.toLocaleString()],
    ['NNGGAA', pattern2.toLocaleString()],
    ['Selected', selected.toLocaleString()],
  ];

  el.statsGrid.innerHTML = cards.map(([label, value]) => `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>`).join('');
}

function renderLegend() {
  el.legend.innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:${cssVar('--plus')}"></span>+ strand PAM</span>
    <span class="legend-item"><span class="legend-swatch" style="background:${cssVar('--minus')}"></span>− strand PAM</span>
    <span class="legend-item"><span class="legend-swatch" style="background:${cssVar('--accent-2')}"></span>NNAGAAW family</span>
    <span class="legend-item"><span class="legend-swatch" style="background:${cssVar('--green')}"></span>NNGGAA</span>
    <span class="legend-item"><span class="legend-swatch" style="background:${cssVar('--gold')}"></span>Forward feature</span>
    <span class="legend-item"><span class="legend-swatch" style="background:${cssVar('--danger')}"></span>Reverse feature</span>
  `;
}

function renderGenome() {
  const record = state.records[state.currentRecordIndex];
  if (!record) return;

  const width = Math.max(960, el.viewerContainer.clientWidth - 2);
  const height = 390;
  const leftPad = 70;
  const rightPad = 40;
  const drawable = width - leftPad - rightPad;
  const axisY = 82;
  const geneTrackY = 120;
  const pamTopY = 210;
  const pamBottomY = 320;
  const { start: viewStart, end: viewEnd, span: viewSpan } = getViewRange(record);
  const bpScale = drawable / viewSpan;

  const features = (record.features || []).filter(f => f.type !== 'source');
  const visibleFeatures = features.filter(f => rangesOverlap(f.start, f.end, viewStart, viewEnd));
  const visibleSites = state.filteredSites.filter(site => rangesOverlap(site.pamStart, site.pamEnd, viewStart, viewEnd));
  const geneLanes = allocateFeatureLanes(visibleFeatures);

  el.viewerInner.style.width = '100%';
  el.genomeSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.genomeSvg.setAttribute('width', String(width));
  el.genomeSvg.setAttribute('height', String(height));

  const axis = `
    <line x1="${leftPad}" y1="${axisY}" x2="${leftPad + drawable}" y2="${axisY}" stroke="rgba(255,255,255,0.22)" stroke-width="2" />
    ${buildTicks(viewStart, viewEnd, leftPad, axisY, drawable)}
  `;

  const featureSvg = visibleFeatures.map((feature, idx) => {
    const lane = geneLanes[idx];
    return drawFeature(feature, lane, leftPad, geneTrackY, bpScale, viewStart, viewEnd);
  }).join('');

  const pamSvg = visibleSites.map(site => drawPamMarker(site, leftPad, pamTopY, pamBottomY, bpScale, viewStart, state.selectedIds.has(site.id), el.showNumbers.checked)).join('');

  el.genomeSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    ${axis}
    <text x="${leftPad}" y="30" class="axis-label">Genome coordinates</text>
    <text x="${leftPad}" y="104" class="axis-label">Annotated features</text>
    <text x="${leftPad}" y="194" class="axis-label">PAM sites and indexed candidates</text>
    ${featureSvg}
    ${pamSvg}
  `;

  el.genomeSvg.querySelectorAll('.pam-marker').forEach(node => {
    node.addEventListener('click', () => toggleSelection(node.dataset.siteId));
  });
}

function buildTicks(viewStart, viewEnd, leftPad, axisY, drawable) {
  const length = viewEnd - viewStart + 1;
  const roughStep = length / 8;
  const step = niceTick(roughStep);
  const ticks = [];
  const first = Math.ceil(viewStart / step) * step;
  for (let pos = first; pos <= viewEnd; pos += step) {
    const x = leftPad + ((pos - viewStart) / Math.max(1, length - 1)) * drawable;
    ticks.push(`
      <line x1="${x}" y1="${axisY - 8}" x2="${x}" y2="${axisY + 8}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
      <text x="${x}" y="${axisY - 14}" text-anchor="middle" class="axis-label">${formatBp(pos)}</text>
    `);
  }
  return ticks.join('');
}

function niceTick(value) {
  const powers = [1, 2, 5, 10];
  const exponent = Math.floor(Math.log10(Math.max(1, value)));
  const base = 10 ** exponent;
  const scaled = value / base;
  const chosen = powers.find(p => scaled <= p) || 10;
  return chosen * base;
}

function drawFeature(feature, lane, leftPad, geneTrackY, scale, viewStart, viewEnd) {
  const y = geneTrackY + lane * 34;
  const clippedStart = Math.max(feature.start, viewStart);
  const clippedEnd = Math.min(feature.end, viewEnd);
  const x1 = leftPad + (clippedStart - viewStart) * scale;
  const x2 = leftPad + (clippedEnd - viewStart + 1) * scale;
  const width = Math.max(10, x2 - x1);
  const color = feature.strand >= 0 ? cssVar('--gold') : cssVar('--danger');
  const arrowSize = Math.min(18, width * 0.45);
  const label = escapeHtml(feature.name || feature.type);
  const title = `${feature.type}: ${feature.name} (${feature.start}..${feature.end}, ${feature.strand >= 0 ? '+' : '-'})`;
  const labelX = Math.max(x1 + 5, Math.min((x1 + x2) / 2, x2 - 5));

  let points;
  if (feature.strand >= 0) {
    points = `${x1},${y} ${x2 - arrowSize},${y} ${x2},${y + 10} ${x2 - arrowSize},${y + 20} ${x1},${y + 20}`;
  } else {
    points = `${x2},${y} ${x1 + arrowSize},${y} ${x1},${y + 10} ${x1 + arrowSize},${y + 20} ${x2},${y + 20}`;
  }

  return `
    <g class="feature-box">
      <title>${escapeHtml(title)}</title>
      <polygon points="${points}" fill="${color}" opacity="0.9"></polygon>
      <text x="${labelX}" y="${y - 4}" text-anchor="middle" class="feature-label">${label}</text>
    </g>
  `;
}

function allocateFeatureLanes(features) {
  const lanes = [];
  const laneEnds = [];
  features.forEach((feature, index) => {
    let assigned = 0;
    while (laneEnds[assigned] && feature.start <= laneEnds[assigned] + 120) assigned += 1;
    laneEnds[assigned] = feature.end;
    lanes[index] = assigned;
  });
  return lanes;
}

function drawPamMarker(site, leftPad, topY, bottomY, scale, viewStart, selected, showNumbers) {
  const x = leftPad + (((site.pamStart + site.pamEnd) / 2) - viewStart + 1) * scale;
  const color = site.strand === '+' ? cssVar('--plus') : cssVar('--minus');
  const y = site.strand === '+' ? topY : bottomY;
  const lineY2 = site.strand === '+' ? topY + 56 : bottomY - 56;
  const shape = site.patternKey === 'NNAGAAW'
    ? `<circle cx="${x}" cy="${y}" r="8" fill="${color}" stroke="${cssVar('--accent-2')}" stroke-width="2"></circle>`
    : `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="4" fill="${color}" stroke="${cssVar('--green')}" stroke-width="2"></rect>`;

  return `
    <g class="pam-marker ${selected ? 'selected' : ''}" data-site-id="${site.id}">
      <title>#${site.index} | ${site.pamLabel} | ${site.strand} | PAM ${site.pamStart}-${site.pamEnd} | Spacer ${site.spacerSeq5to3}</title>
      <line x1="${x}" y1="${topY + 12}" x2="${x}" y2="${bottomY - 12}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
      <line x1="${x}" y1="${y}" x2="${x}" y2="${lineY2}" stroke="${color}" stroke-width="2.3"></line>
      ${shape}
      ${showNumbers ? `<text x="${x}" y="${site.strand === '+' ? y - 13 : y + 24}" text-anchor="middle" class="marker-label">${site.index}</text>` : ''}
    </g>
  `;
}

function renderResultsTable() {
  const filter = el.tableFilter.value.trim().toLowerCase();
  const rows = state.filteredSites.filter(site => {
    if (!filter) return true;
    const haystack = [
      site.index,
      site.pamLabel,
      site.strand,
      site.pamStart,
      site.pamEnd,
      site.spacerSeq5to3,
      site.featureName,
      site.featureType,
      site.protoStart,
      site.protoEnd,
    ].join(' ').toLowerCase();
    return haystack.includes(filter);
  });

  if (!rows.length) {
    el.resultsTableBody.innerHTML = '<tr><td colspan="8" class="muted">No PAM candidates match the current filters.</td></tr>';
    return;
  }

  el.resultsTableBody.innerHTML = rows.map(site => `
    <tr data-site-id="${site.id}" class="${state.selectedIds.has(site.id) ? 'selected-row' : ''}">
      <td>${site.index}</td>
      <td>
        <div class="badge ${site.patternKey === 'NNAGAAW' ? 'pattern1' : 'pattern2'}">${site.pamLabel}</div>
        <div class="small-mono wrap-mono">${site.pamSeq5to3}</div>
      </td>
      <td><span class="badge ${site.strand === '+' ? 'plus' : 'minus'}">${site.strand}</span></td>
      <td>${site.pamStart}..${site.pamEnd}</td>
      <td class="small-mono wrap-mono spacer-cell" title="${escapeHtml(site.spacerSeq5to3)}">${site.spacerSeq5to3}</td>
      <td>${site.protospacerLength}</td>
      <td class="feature-cell" title="${escapeHtml(site.featureName || '—')}">${escapeHtml(site.featureName || '—')}</td>
      <td>${state.selectedIds.has(site.id) ? '✓' : ''}</td>
    </tr>
  `).join('');

  el.resultsTableBody.querySelectorAll('tr[data-site-id]').forEach(row => {
    row.addEventListener('click', () => toggleSelection(row.dataset.siteId));
  });
}

function renderSelectedList() {
  const selected = getSelectedSites();
  if (!selected.length) {
    el.selectedList.innerHTML = 'No PAM sites selected yet.';
    el.selectedList.className = 'selected-list empty-state';
    el.pairSummary.innerHTML = 'Select one or more PAM sites to assemble a candidate set for export.';
    return;
  }

  el.selectedList.className = 'selected-list';
  el.selectedList.innerHTML = selected.map(site => `
    <div class="selection-item">
      <div class="selection-header">
        <div>
          <div class="selection-title">#${site.index} · ${site.pamLabel} · ${site.strand} strand</div>
          <div class="selection-meta">PAM ${site.pamStart}..${site.pamEnd} · protospacer ${site.protoStart}..${site.protoEnd} · ${escapeHtml(site.featureName || 'intergenic')}</div>
        </div>
        <button class="button ghost remove-selection" data-site-id="${site.id}">Remove</button>
      </div>
      <div><strong>Spacer (guide-ready 5'→3'):</strong></div>
      <div class="selection-seq">${site.spacerSeq5to3}</div>
      <div class="selection-meta">Genomic protospacer: ${site.protospacerGenomeSeq} · GC ${site.gcPct}% · starts with G: ${site.guideStartsWithG ? 'yes' : 'no'}</div>
    </div>
  `).join('');

  el.selectedList.querySelectorAll('.remove-selection').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSelection(btn.dataset.siteId);
    });
  });

  el.pairSummary.innerHTML = buildPairSummary(selected);
}

function buildPairSummary(selected) {
  if (selected.length === 1) {
    const site = selected[0];
    return `One PAM selected. Spacer <span class="small-mono">${site.spacerSeq5to3}</span> is ready for copying or export.`;
  }

  const ordered = selected.slice().sort((a, b) => a.pamStart - b.pamStart);
  const firstTwo = ordered.slice(0, 2);
  const span = firstTwo[1].pamStart - firstTwo[0].pamEnd;
  const orientation = `${firstTwo[0].strand}/${firstTwo[1].strand}`;
  const sameFeature = firstTwo[0].featureName && firstTwo[0].featureName === firstTwo[1].featureName;

  return `
    <strong>First candidate pair:</strong> #${firstTwo[0].index} and #${firstTwo[1].index}. 
    Separation between PAMs: <strong>${span} bp</strong>. Orientation: <strong>${orientation}</strong>. 
    ${sameFeature ? `Both map to <strong>${escapeHtml(firstTwo[0].featureName)}</strong>.` : 'They map to different or no annotated features.'}
    ${selected.length > 2 ? ` ${selected.length - 2} additional selected PAM sites are also queued for export.` : ''}
  `;
}

function toggleSelection(siteId) {
  if (state.selectedIds.has(siteId)) state.selectedIds.delete(siteId);
  else state.selectedIds.add(siteId);
  renderAll();
  highlightSelectedMarker(siteId);
}

function highlightSelectedMarker(siteId) {
  const row = el.resultsTableBody.querySelector(`tr[data-site-id="${CSS.escape(siteId)}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function getSelectedSites() {
  return state.filteredSites.filter(site => state.selectedIds.has(site.id));
}

function onZoomChanged() {
  const record = state.records[state.currentRecordIndex];
  if (!record) return;
  const previous = getViewRange(record);
  state.zoom = Number(el.zoomRange.value);
  el.zoomValue.textContent = `${state.zoom.toFixed(1)}×`;
  const nextSpan = getVisibleSpan(record.length, state.zoom);
  const center = previous.start + previous.span / 2;
  state.viewStart = Math.round(center - nextSpan / 2);
  constrainView();
  renderGenome();
  renderSummary();
}

function resetView() {
  const record = state.records[state.currentRecordIndex];
  state.viewStart = 1;
  el.viewerContainer.scrollLeft = 0;
  el.viewerContainer.scrollTop = 0;
  el.zoomRange.value = '1.2';
  state.zoom = 1.2;
  el.zoomValue.textContent = '1.2×';
  constrainView(record);
  if (record) {
    renderGenome();
    renderSummary();
  }
}

function enableDragPanning(container) {
  let isDragging = false;
  let startX = 0;
  let startView = 1;

  container.addEventListener('pointerdown', (event) => {
    const record = state.records[state.currentRecordIndex];
    if (!record) return;
    isDragging = true;
    startX = event.clientX;
    startView = state.viewStart;
    container.classList.add('dragging');
    container.setPointerCapture(event.pointerId);
  });

  container.addEventListener('pointermove', (event) => {
    const record = state.records[state.currentRecordIndex];
    if (!isDragging || !record) return;
    const drawable = Math.max(300, el.viewerContainer.clientWidth - 110);
    const view = getViewRange(record);
    const bpPerPixel = view.span / drawable;
    const dx = event.clientX - startX;
    state.viewStart = Math.round(startView - dx * bpPerPixel);
    constrainView();
    renderGenome();
    renderSummary();
  });

  const stop = () => {
    isDragging = false;
    container.classList.remove('dragging');
  };

  container.addEventListener('pointerup', stop);
  container.addEventListener('pointerleave', stop);
}

function enableWheelZoom(container) {
  container.addEventListener('wheel', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const record = state.records[state.currentRecordIndex];
    if (!record) return;
    event.preventDefault();

    const rect = container.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const view = getViewRange(record);
    const anchorBp = view.start + (x / Math.max(1, rect.width)) * view.span;

    const delta = event.deltaY < 0 ? 0.2 : -0.2;
    state.zoom = clamp(state.zoom + delta, 0.1, 20);
    el.zoomRange.value = String(state.zoom);
    el.zoomValue.textContent = `${state.zoom.toFixed(1)}×`;

    const nextSpan = getVisibleSpan(record.length, state.zoom);
    state.viewStart = Math.round(anchorBp - (x / Math.max(1, rect.width)) * nextSpan);
    constrainView();
    renderGenome();
    renderSummary();
  }, { passive: false });
}

function getVisibleSpan(recordLength, zoom) {
  return clamp(Math.round(recordLength / Math.max(1, zoom)), 80, recordLength);
}

function getViewRange(record) {
  const span = getVisibleSpan(record.length, state.zoom);
  const maxStart = Math.max(1, record.length - span + 1);
  const start = clamp(Math.round(state.viewStart || 1), 1, maxStart);
  const end = Math.min(record.length, start + span - 1);
  return { start, end, span };
}

function constrainView(record = state.records[state.currentRecordIndex]) {
  if (!record) return;
  const span = getVisibleSpan(record.length, state.zoom);
  state.viewStart = clamp(Math.round(state.viewStart || 1), 1, Math.max(1, record.length - span + 1));
}

function rangesOverlap(a1, a2, b1, b2) {
  return a1 <= b2 && b1 <= a2;
}

function exportSelectedSites() {
  const selected = getSelectedSites();
  if (!selected.length) {
    window.alert('Select at least one PAM site first.');
    return;
  }
  exportSites(selected, 'csv', 'selected_spacers');
}

function copySelectedSpacers() {
  const selected = getSelectedSites();
  if (!selected.length) {
    window.alert('Select at least one PAM site first.');
    return;
  }

  const text = selected.map(site => `#${site.index}\t${site.spacerSeq5to3}\t${site.pamLabel}\t${site.strand}\t${site.pamStart}..${site.pamEnd}\t${site.featureName || 'intergenic'}`).join('\n');
  navigator.clipboard.writeText(text)
    .then(() => window.alert('Selected spacers copied to the clipboard.'))
    .catch(() => window.alert('Clipboard copy failed in this browser. Use export instead.'));
}

function exportSites(sites, format = 'csv', baseName = 'pam_sites') {
  if (!sites.length) {
    window.alert('There are no PAM sites to export under the current filters.');
    return;
  }
  const sep = format === 'tsv' ? '\t' : ',';
  const ext = format === 'tsv' ? 'tsv' : 'csv';
  const headers = [
    'index', 'record', 'pam_label', 'strand', 'pam_start', 'pam_end', 'pam_seq_5to3',
    'protospacer_start', 'protospacer_end', 'protospacer_length', 'spacer_seq_5to3',
    'genomic_protospacer_seq', 'guide_starts_with_G', 'gc_pct', 'feature_name',
    'feature_type', 'feature_span'
  ];
  const lines = [headers.join(sep)];
  for (const site of sites) {
    lines.push([
      site.index,
      state.records[state.currentRecordIndex]?.locus || '',
      site.pamLabel,
      site.strand,
      site.pamStart,
      site.pamEnd,
      site.pamSeq5to3,
      site.protoStart,
      site.protoEnd,
      site.protospacerLength,
      site.spacerSeq5to3,
      site.protospacerGenomeSeq,
      site.guideStartsWithG,
      site.gcPct,
      site.featureName || '',
      site.featureType || '',
      site.featureSpan || '',
    ].map(value => escapeCsv(String(value), sep)).join(sep));
  }
  downloadText(lines.join('\n'), `${baseName}.${ext}`);
}

function escapeCsv(value, sep) {
  if (value.includes('"')) value = value.replaceAll('"', '""');
  return value.includes(sep) || value.includes('\n') ? `"${value}"` : value;
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatBp(bp) {
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`;
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
  return `${bp} bp`;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

init();
