// Expenses page: add expenses and the complete expense history table
// (search, filters, sorting, pagination, CSV export).
import { initPage, renderLoadError } from './layout.js';
import { loadAllData } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, formatINR, formatNumber, formatDate, debounce,
  paginate, paginationControls, toCSV, downloadCSV, todayISO, vehicleName, EXPENSE_CATEGORIES, CATEGORY_COLORS, DASH,
} from './utils.js';
import { buildFuelTimeline, timelineById, filterByDateRange, num, totalAmount } from './calculations.js';
import { ensureValidVehicle, filterBar, initialFilterState, forVehicle, SOURCE_LABELS } from './components.js';
import { openExpenseForm, openFuelForm, editExpenseRow, deleteExpenseRow, openReceipt } from './forms.js';

const page = await initPage({ active: 'expenses', title: 'Expenses', subtitle: 'Complete expense history for all your vehicles' });

let data = null;
const state = { ...initialFilterState('all'), search: '', category: 'all', sort: 'date-desc', page: 1, pageSize: 20 };
let tableArea = null;

async function refresh() {
  try {
    data = await loadAllData();
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}
const afterSave = async (saved) => { if (saved) await refresh(); };

/** One row per expense, with fuel/maintenance details joined in. */
function buildRows() {
  const timeline = timelineById(buildFuelTimeline(data.fuelLogs));
  const maintenanceByExpense = new Map(data.maintenance.map((m) => [m.expense_id, m]));
  return data.expenses.map((e) => {
    const entry = e.fuel ? timeline.get(e.fuel.id) : null;
    const odometer = e.fuel ? num(e.fuel.odometer_reading) : num(maintenanceByExpense.get(e.id)?.odometer_reading);
    return {
      expense: e,
      date: e.expense_date,
      amount: num(e.amount),
      price: e.fuel ? num(e.fuel.price_per_litre) : null,
      litres: e.fuel ? num(e.fuel.litres) : null,
      litresManual: Boolean(e.fuel?.litres_is_manual),
      odometer,
      distance: entry?.distance ?? null,
      costPerKm: entry?.costPerKm ?? null,
      status: entry?.status ?? null,
    };
  });
}

function filteredRows() {
  const query = state.search.trim().toLowerCase();
  let rows = forVehicle(buildRows().map((r) => ({ ...r, vehicle_id: r.expense.vehicle_id })), state.vehicleId);
  rows = filterByDateRange(rows, (r) => r.date, state.from, state.to);
  if (state.category !== 'all') rows = rows.filter((r) => r.expense.category === state.category);
  if (query) rows = rows.filter((r) => r.expense.description.toLowerCase().includes(query) || (r.expense.notes || '').toLowerCase().includes(query));

  const [key, direction] = state.sort.split('-');
  const factor = direction === 'asc' ? 1 : -1;
  const value = (r) => (key === 'date' ? r.date : key === 'amount' ? r.amount : r.odometer);
  return rows.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === vb) return String(b.expense.created_at).localeCompare(String(a.expense.created_at));
    if (va === null) return 1; // rows without an odometer always go last
    if (vb === null) return -1;
    return (va < vb ? -1 : 1) * factor;
  });
}

function exportCSV(rows) {
  const vehicleById = new Map(data.vehicles.map((v) => [v.id, v]));
  const csv = toCSV(rows, [
    { header: 'Date', value: (r) => r.date },
    { header: 'Vehicle', value: (r) => vehicleName(vehicleById.get(r.expense.vehicle_id)) },
    { header: 'Registration', value: (r) => vehicleById.get(r.expense.vehicle_id)?.registration_number },
    { header: 'Description', value: (r) => r.expense.description },
    { header: 'Amount', value: (r) => r.amount?.toFixed(2) },
    { header: 'Petrol Price', value: (r) => r.price?.toFixed(2) ?? '' },
    { header: 'Petrol (Litres)', value: (r) => r.litres?.toFixed(3) ?? '' },
    { header: 'Category', value: (r) => r.expense.category },
    { header: 'Odometer', value: (r) => r.odometer ?? '' },
    { header: 'Distance Travelled', value: (r) => r.distance?.toFixed(1) ?? '' },
    { header: 'Cost Per KM', value: (r) => r.costPerKm?.toFixed(2) ?? '' },
    { header: 'Notes', value: (r) => r.expense.notes ?? '' },
  ]);
  downloadCSV(`expenses-${todayISO()}.csv`, csv);
}

function renderTable() {
  const rows = filteredRows();
  const pageInfo = paginate(rows, state.page, state.pageSize);
  state.page = pageInfo.page;
  const vehicleById = new Map(data.vehicles.map((v) => [v.id, v]));
  const showVehicle = state.vehicleId === 'all' && data.vehicles.length > 1;

  const headers = ['Date', showVehicle ? 'Vehicle' : null, 'Description', 'Amount', 'Petrol Price', 'Petrol (L)', 'Category', 'Odometer', 'Distance', 'Cost/km', 'Actions'].filter(Boolean);
  const numeric = new Set(['Amount', 'Petrol Price', 'Petrol (L)', 'Odometer', 'Distance', 'Cost/km']);

  const summary = h('div', { class: 'table-summary' },
    h('span', {}, h('strong', {}, rows.length), ` record${rows.length === 1 ? '' : 's'}`),
    h('span', {}, 'Total ', h('strong', {}, formatINR(totalAmount(rows.map((r) => r.expense))))),
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: !rows.length, onclick: () => exportCSV(rows) }, icon('download'), 'Export CSV'));

  const body = rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table table-hover' },
      h('caption', { class: 'sr-only' }, 'Expense history'),
      h('thead', {}, h('tr', {}, headers.map((t) => h('th', { scope: 'col', class: numeric.has(t) ? 'num' : null }, t)))),
      h('tbody', {}, pageInfo.rows.map((r) => {
        const e = r.expense;
        return h('tr', {},
          h('td', { class: 'nowrap' }, formatDate(r.date)),
          showVehicle ? h('td', {}, vehicleName(vehicleById.get(e.vehicle_id))) : null,
          h('td', {},
            e.description,
            e.source !== 'manual' ? h('span', { class: 'badge badge-grey', title: `Created from ${SOURCE_LABELS[e.source]}` }, SOURCE_LABELS[e.source]) : null,
            e.receipt_url ? h('button', { type: 'button', class: 'link-btn', onclick: () => openReceipt(e.receipt_url) }, icon('paperclip'), 'Receipt') : null,
            e.notes ? h('div', { class: 'muted small clamp' }, e.notes) : null),
          h('td', { class: 'num' }, formatINR(r.amount)),
          h('td', { class: 'num' }, r.price === null ? DASH : formatINR(r.price)),
          h('td', { class: 'num' }, r.litres === null ? DASH : formatNumber(r.litres, 2), r.litresManual ? h('span', { class: 'badge badge-blue', title: 'Entered from pump receipt' }, 'manual') : null),
          h('td', {}, h('span', { class: 'chip', style: { '--chip': CATEGORY_COLORS[e.category] } }, e.category)),
          h('td', { class: 'num' }, r.odometer === null ? DASH : formatNumber(r.odometer, 1)),
          h('td', { class: 'num' }, r.distance === null ? DASH : formatNumber(r.distance, 1),
            r.status === 'baseline' ? h('span', { class: 'badge badge-grey', title: 'First reading — not counted as distance' }, 'Baseline') : null,
            r.status === 'odometer-decrease' ? h('span', { class: 'badge badge-red', title: 'Lower than the previous reading' }, 'Check') : null),
          h('td', { class: 'num' }, r.costPerKm === null ? DASH : formatINR(r.costPerKm)),
          h('td', { class: 'actions' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${e.description}`, onclick: () => editExpenseRow(e, data).then(afterSave) }, icon('pencil')),
            h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete ${e.description}`, onclick: () => deleteExpenseRow(e, data).then(afterSave) }, icon('trash-2'))));
      }))))
    : emptyState({ iconName: 'search-x', title: 'No matching records', text: data.expenses.length ? 'Try changing the search or filters.' : 'Add your first expense or fuel entry.' });

  tableArea.replaceChildren(summary, body, rows.length ? paginationControls({ ...pageInfo, pageSize: state.pageSize }, (p) => { state.page = p; renderTable(); }) : '');
  refreshIcons();
}

function render() {
  ensureValidVehicle(state, data.vehicles);
  page.actions.replaceChildren(
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openExpenseForm({ data }).then(afterSave) }, icon('plus'), 'Add expense'),
    h('button', { type: 'button', class: 'btn btn-success', onclick: () => openFuelForm({ data }).then(afterSave) }, icon('fuel'), 'Add fuel'));

  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front', title: 'Add a vehicle first',
      text: 'Expenses belong to a vehicle.', action: h('a', { class: 'btn btn-primary', href: 'vehicles.html' }, 'Go to My Vehicles'),
    })));
    refreshIcons();
    return;
  }

  const resetPage = () => { state.page = 1; renderTable(); };
  const search = h('div', { class: 'field field-inline field-grow' },
    h('label', { for: 'search' }, 'Search'),
    h('input', { type: 'search', id: 'search', placeholder: 'Description or notes…', value: state.search,
      oninput: debounce((e) => { state.search = e.target.value; resetPage(); }, 200) }));
  const category = h('div', { class: 'field field-inline' },
    h('label', { for: 'category-filter' }, 'Category'),
    h('select', { id: 'category-filter', onchange: (e) => { state.category = e.target.value; resetPage(); } },
      h('option', { value: 'all' }, 'All categories'),
      EXPENSE_CATEGORIES.map((c) => h('option', { value: c, selected: c === state.category }, c))));
  const sort = h('div', { class: 'field field-inline' },
    h('label', { for: 'sort' }, 'Sort by'),
    h('select', { id: 'sort', onchange: (e) => { state.sort = e.target.value; resetPage(); } },
      [['date-desc', 'Date (newest)'], ['date-asc', 'Date (oldest)'], ['amount-desc', 'Amount (high–low)'], ['amount-asc', 'Amount (low–high)'], ['odometer-desc', 'Odometer (high–low)'], ['odometer-asc', 'Odometer (low–high)']]
        .map(([v, t]) => h('option', { value: v, selected: v === state.sort }, t))));
  const pageSize = h('div', { class: 'field field-inline' },
    h('label', { for: 'page-size' }, 'Rows'),
    h('select', { id: 'page-size', onchange: (e) => { state.pageSize = Number(e.target.value); resetPage(); } },
      [10, 20, 50, 100].map((n) => h('option', { value: n, selected: n === state.pageSize }, n))));

  tableArea = h('section', { class: 'card' });
  page.main.replaceChildren(
    filterBar({ vehicles: data.vehicles, state, onChange: resetPage, extra: [category, sort, pageSize, search] }),
    h('p', { class: 'muted small' }, 'Fuel, service and insurance rows are created by their modules; editing them opens the matching form. Distance and cost/km apply to fuel rows (amount of the fill ÷ distance since the previous fill).'),
    tableArea);
  renderTable();
}

if (page) {
  page.main.replaceChildren(loadingBlock('Loading expenses…'));
  document.addEventListener('data-changed', refresh);
  refresh();
}
