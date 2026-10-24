// Import CSV page: upload a Google Sheets export, preview + validate rows,
// then import only the valid, non-duplicate transactions.
import { initPage, renderLoadError } from './layout.js';
import { loadAllData, fuelApi, expensesApi } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, alertBox, parseCSV, setButtonLoading, toast,
  todayISO, vehicleName, getPreference, formatINR,
} from './utils.js';
import { validateImport, existingKeys } from './importer.js';
import { num } from './calculations.js';
import { vehicleSelect } from './components.js';

const page = await initPage({ active: 'import', title: 'Import from Google Sheets', subtitle: 'Bring your existing spreadsheet records into the tracker' });

let data = null;
const state = { vehicleId: null, format: 'dmy', fileText: null, fileName: '', result: null, show: 'all' };
let previewArea = null;

const STATUS = {
  valid: { label: 'Will import', tone: 'green' },
  invalid: { label: 'Invalid', tone: 'red' },
  duplicate: { label: 'Duplicate', tone: 'amber' },
  skipped: { label: 'Skipped', tone: 'grey' },
};
const CHUNK = 200;

async function refresh() {
  try {
    data = await loadAllData();
    state.vehicleId = state.vehicleId || [getPreference('vehicleId'), data.vehicles[0]?.id].find((id) => data.vehicles.some((v) => v.id === id)) || null;
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}

function validate() {
  if (!state.fileText || !state.vehicleId) {
    state.result = null;
    return;
  }
  state.result = validateImport(parseCSV(state.fileText), {
    format: state.format,
    existing: existingKeys(data.expenses, state.vehicleId),
    today: todayISO(),
  });
}

async function runImport(button) {
  const valid = state.result.items.filter((it) => it.status === 'valid');
  const fuelRows = valid.filter((it) => it.kind === 'fuel').map((it) => ({ ...it.record, vehicle_id: state.vehicleId }));
  const expenseRows = valid.filter((it) => it.kind === 'expense').map((it) => ({ ...it.record, vehicle_id: state.vehicleId }));
  let imported = 0;
  setButtonLoading(button, true, 'Importing…');
  try {
    // Fuel rows go to fuel_logs; the database trigger creates their Petrol expenses.
    for (let i = 0; i < fuelRows.length; i += CHUNK) {
      await fuelApi.insertMany(fuelRows.slice(i, i + CHUNK));
      imported += Math.min(CHUNK, fuelRows.length - i);
    }
    for (let i = 0; i < expenseRows.length; i += CHUNK) {
      await expensesApi.insertMany(expenseRows.slice(i, i + CHUNK));
      imported += Math.min(CHUNK, expenseRows.length - i);
    }
    toast(`Imported ${imported} record${imported === 1 ? '' : 's'}.`);
    state.fileText = null;
    state.result = null;
    await refresh();
    page.main.prepend(alertBox(h('span', {}, `Import complete: ${imported} records added (${fuelRows.length} fuel, ${expenseRows.length} other). `, h('a', { href: 'expenses.html' }, 'View expense history')), 'success'));
    refreshIcons();
  } catch (error) {
    setButtonLoading(button, false);
    previewArea.prepend(alertBox(`Import stopped after ${imported} records: ${error.message} Fix the problem and import the same file again — rows already imported will be detected as duplicates.`, 'error'));
    refreshIcons();
    await refresh();
  }
}

function renderPreview() {
  const result = state.result;
  if (!state.fileText) {
    previewArea.replaceChildren();
    return;
  }
  if (result?.error) {
    previewArea.replaceChildren(h('section', { class: 'card' }, alertBox(result.error, 'error')));
    refreshIcons();
    return;
  }

  const counts = Object.fromEntries(Object.keys(STATUS).map((s) => [s, result.items.filter((it) => it.status === s).length]));
  const valid = result.items.filter((it) => it.status === 'valid');
  const total = valid.reduce((t, it) => t + num(it.kind === 'fuel' ? it.record.amount_paid : it.record.amount), 0);
  const shown = state.show === 'all' ? result.items : result.items.filter((it) => it.status === state.show);
  const vehicle = data.vehicles.find((v) => v.id === state.vehicleId);
  const recognised = Object.keys(result.mapping);

  const importButton = h('button', { type: 'button', class: 'btn btn-primary', disabled: !valid.length, onclick: (e) => runImport(e.currentTarget) },
    icon('upload'), `Import ${valid.length} record${valid.length === 1 ? '' : 's'}`);

  previewArea.replaceChildren(h('section', { class: 'card' },
    h('div', { class: 'card-header row-between' },
      h('div', {},
        h('h2', {}, `Preview: ${state.fileName}`),
        h('p', { class: 'muted small' }, `Recognised columns: ${recognised.join(', ')}. Calculated columns (Difference, Cost Per KM, totals, Average KM/L) are ignored and recalculated by the app.`)),
      importButton),
    h('div', { class: 'import-summary' },
      Object.entries(STATUS).map(([key, s]) => h('button', {
        type: 'button', class: `summary-pill pill-${s.tone}${state.show === key ? ' active' : ''}`, 'aria-pressed': String(state.show === key),
        onclick: () => { state.show = state.show === key ? 'all' : key; renderPreview(); },
      }, h('strong', {}, counts[key]), ` ${s.label}`))),
    valid.length
      ? alertBox(`${valid.length} rows (${formatINR(total)}) will be added to ${vehicleName(vehicle)} (${vehicle.registration_number}). Invalid, duplicate and summary rows are NOT imported.`, 'info')
      : alertBox('There are no valid new rows to import.', 'warning'),
    shown.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Row', 'Status', 'Date', 'Description', 'Amount', 'Petrol price', 'Litres', 'Category', 'Odometer', 'Notes'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, shown.slice(0, 500).map((it) => h('tr', { class: `import-${it.status}` },
          h('td', {}, it.rowNumber),
          h('td', {}, h('span', { class: `badge badge-${STATUS[it.status].tone}` }, STATUS[it.status].label)),
          h('td', { class: 'nowrap' }, it.preview.date),
          h('td', {}, it.preview.description),
          h('td', {}, it.preview.amount),
          h('td', {}, it.preview.price),
          h('td', {}, it.kind === 'fuel' && it.record?.litres ? `${it.record.litres.toFixed(2)}${it.preview.litres ? '' : ' (calc.)'}` : it.preview.litres),
          h('td', {}, it.category || it.preview.category),
          h('td', {}, it.preview.odometer),
          h('td', { class: 'small' },
            it.reasons.map((r) => h('div', { class: 'text-danger' }, r)),
            it.warnings.map((w) => h('div', { class: 'text-warning' }, w))))))))
      : h('p', { class: 'muted' }, 'No rows in this group.'),
    shown.length > 500 ? h('p', { class: 'muted small' }, `Showing the first 500 of ${shown.length} rows.`) : ''));
  refreshIcons();
}

function render() {
  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front', title: 'Add a vehicle first', text: 'Imported records are added to one of your vehicles.',
      action: h('a', { class: 'btn btn-primary', href: 'vehicles.html' }, 'Go to My Vehicles'),
    })));
    refreshIcons();
    return;
  }

  const fileInput = h('input', {
    type: 'file', id: 'csv-file', accept: '.csv,text/csv',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast('CSV file must be smaller than 5 MB.', 'error');
        return;
      }
      state.fileText = await file.text();
      state.fileName = file.name;
      state.show = 'all';
      validate();
      renderPreview();
    },
  });

  previewArea = h('div');
  page.main.replaceChildren(
    h('section', { class: 'card' },
      h('div', { class: 'card-header' },
        h('h2', {}, '1. Export your sheet as CSV'),
        h('p', { class: 'muted' }, 'In Google Sheets: File → Download → Comma-separated values (.csv). Export one vehicle\'s transaction sheet at a time.')),
      h('ul', { class: 'checklist' },
        h('li', {}, 'Recognised columns: Date, Description, Amount, Petrol Price, Petrol (Litres), Category, Odometer, and optionally Full Tank, Fuel Station, Notes.'),
        h('li', {}, 'Petrol rows become fuel entries. If Petrol (Litres) is empty it is calculated as Amount ÷ Petrol Price.'),
        h('li', {}, 'Rows without a valid date (totals, monthly summaries, vehicle details) are skipped — they are not transactions.'),
        h('li', {}, 'Rows already in your account (same date, amount and description) are marked as duplicates and not imported.')),
      h('a', { class: 'btn btn-secondary btn-sm', href: 'assets/sample-import.csv', download: 'sample-import.csv' }, icon('file-down'), 'Download sample CSV')),
    h('section', { class: 'card' },
      h('div', { class: 'card-header' }, h('h2', {}, '2. Choose vehicle, date format and file')),
      h('div', { class: 'form-row' },
        vehicleSelect(data.vehicles, state.vehicleId, (id) => { state.vehicleId = id; validate(); renderPreview(); }, { includeAll: false, id: 'import-vehicle', label: 'Import into' }),
        h('div', { class: 'field field-inline' },
          h('label', { for: 'date-format' }, 'Date format'),
          h('select', { id: 'date-format', onchange: (e) => { state.format = e.target.value; validate(); renderPreview(); } },
            h('option', { value: 'dmy' }, 'DD/MM/YYYY (India)'),
            h('option', { value: 'mdy' }, 'MM/DD/YYYY (US)'),
            h('option', { value: 'ymd' }, 'YYYY-MM-DD'))),
        h('div', { class: 'field field-inline' }, h('label', { for: 'csv-file' }, 'CSV file'), fileInput))),
    previewArea);
  refreshIcons();
}

if (page) {
  page.main.replaceChildren(loadingBlock('Loading…'));
  refresh();
}
