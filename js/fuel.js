// Fuel Tracker: fuel entries with automatic litres, distance between fills,
// mileage (full-tank or estimated), price trend and monthly consumption.
import { initPage, renderLoadError } from './layout.js';
import { loadAllData, fuelApi } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, formatINR, formatLitres, formatKm, formatKmpl,
  formatPerKm, formatDate, formatNumber, paginate, paginationControls, toCSV, downloadCSV, todayISO, vehicleName,
} from './utils.js';
import {
  buildSummary, monthsBetween, monthKey, monthlyFuelLitres, sumByMonth, costPerKm, num,
} from './calculations.js';
import {
  ensureValidVehicle, statCard, filterBar, initialFilterState, forVehicle, chartCard, barChart, lineChart, shortINR, monthLabels, fuelTable,
} from './components.js';
import { openFuelForm, confirmDelete } from './forms.js';

const page = await initPage({ active: 'fuel', title: 'Fuel Tracker', subtitle: 'Petrol fills, litres, distance and mileage' });

let data = null;
const state = { ...initialFilterState('all'), page: 1, pageSize: 20 };

async function refresh() {
  try {
    data = await loadAllData();
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}
const afterSave = async (saved) => { if (saved) await refresh(); };

function removeLog(log) {
  return confirmDelete({
    title: 'Delete fuel entry?',
    message: `The fuel entry of ${formatDate(log.fuel_date)} (${formatINR(num(log.amount_paid))}) and its linked Petrol expense will be permanently deleted. Distances of later entries will be recalculated.`,
    remove: () => fuelApi.remove(log.id),
    successText: 'Fuel entry deleted.',
  }).then(afterSave);
}

function exportCSV(entries, vehicleById) {
  downloadCSV(`fuel-log-${todayISO()}.csv`, toCSV(entries, [
    { header: 'Date', value: (e) => e.log.fuel_date },
    { header: 'Vehicle', value: (e) => vehicleName(vehicleById.get(e.log.vehicle_id)) },
    { header: 'Description', value: (e) => e.log.description },
    { header: 'Fuel Station', value: (e) => e.log.fuel_station ?? '' },
    { header: 'Amount', value: (e) => num(e.log.amount_paid).toFixed(2) },
    { header: 'Petrol Price', value: (e) => num(e.log.price_per_litre).toFixed(2) },
    { header: 'Petrol (Litres)', value: (e) => num(e.log.litres).toFixed(3) },
    { header: 'Litres Entered Manually', value: (e) => (e.log.litres_is_manual ? 'Yes' : 'No') },
    { header: 'Odometer', value: (e) => e.log.odometer_reading ?? '' },
    { header: 'Distance Travelled', value: (e) => e.distance?.toFixed(1) ?? '' },
    { header: 'Cost Per KM', value: (e) => e.costPerKm?.toFixed(2) ?? '' },
    { header: 'Full Tank', value: (e) => (e.log.is_full_tank ? 'Yes' : 'No') },
    { header: 'Notes', value: (e) => e.log.notes ?? '' },
  ]));
}

function render() {
  ensureValidVehicle(state, data.vehicles);
  page.actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-success', onclick: () => openFuelForm({ data }).then(afterSave) }, icon('plus'), 'Add fuel entry'));

  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front', title: 'Add a vehicle first', text: 'Fuel entries belong to a vehicle.',
      action: h('a', { class: 'btn btn-primary', href: 'vehicles.html' }, 'Go to My Vehicles'),
    })));
    refreshIcons();
    return;
  }

  const fuelLogs = forVehicle(data.fuelLogs, state.vehicleId);
  const expenses = forVehicle(data.expenses, state.vehicleId);
  const s = buildSummary({ expenses, fuelLogs, from: state.from, to: state.to, costMode: 'fuel' });
  const vehicleById = new Map(data.vehicles.map((v) => [v.id, v]));

  const mileageBadge = s.mileage.method === 'estimated' ? { text: 'Estimated', tone: 'amber' }
    : s.mileage.method === 'full-tank' ? { text: 'Full-tank', tone: 'green' } : null;
  const fuelCost = s.periodFuel.reduce((t, l) => t + num(l.amount_paid), 0);

  const stats = h('section', { class: 'stat-grid' },
    statCard({ label: 'Total petrol expenditure', value: formatINR(fuelCost), iconName: 'indian-rupee', tone: 'green', sub: `${s.periodFuel.length} fill-ups` }),
    statCard({ label: 'Total petrol consumed', value: formatLitres(s.litres), iconName: 'droplet', tone: 'green' }),
    statCard({ label: 'Average price per litre', value: s.averagePrice === null ? '—' : `${formatINR(s.averagePrice)}/L`, iconName: 'tag', tone: 'blue', sub: 'Total amount ÷ total litres' }),
    statCard({ label: 'Distance travelled', value: formatKm(s.distance), iconName: 'route', tone: 'blue', sub: 'Between consecutive fuel entries' }),
    statCard({ label: 'Average mileage', value: formatKmpl(s.mileage.kmpl), iconName: 'gauge', tone: 'green', badge: mileageBadge, sub: s.mileage.note }),
    statCard({ label: 'Fuel cost per km', value: formatPerKm(costPerKm(fuelCost, s.distance)), iconName: 'calculator', tone: 'blue', sub: 'Fuel expenditure ÷ distance' }));

  // ---- charts ----
  const dates = s.periodFuel.map((l) => l.fuel_date).sort();
  const months = dates.length ? monthsBetween(monthKey(state.from || dates[0]), monthKey(state.to || todayISO())) : [];
  const consumption = chartCard('chart-fuel-litres', 'Monthly fuel consumption', 'Litres filled per month');
  const spend = chartCard('chart-fuel-spend', 'Monthly petrol expenditure');
  const price = chartCard('chart-fuel-price', 'Petrol price trend', 'Price per litre at each fill');
  const distance = chartCard('chart-fuel-distance', 'Distance between fuel entries');

  // ---- full-tank intervals ----
  const intervals = s.mileage.intervals.filter((i) => (!state.from || i.toDate >= state.from) && (!state.to || i.toDate <= state.to));
  const mileageCard = h('section', { class: 'card' },
    h('div', { class: 'card-header' },
      h('h2', {}, 'Mileage between full-tank fills'),
      h('p', { class: 'muted small' }, 'km/L = distance between two full-tank fills ÷ all litres added after the first fill up to and including the second. Tick "Full tank" when you fill completely for accurate mileage.')),
    intervals.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['From', 'To', state.vehicleId === 'all' ? 'Vehicle' : null, 'Distance', 'Litres', 'Mileage'].filter(Boolean).map((t, i) => h('th', { scope: 'col', class: i > 1 && t !== 'Vehicle' ? 'num' : null }, t)))),
        h('tbody', {}, intervals.map((i) => h('tr', {},
          h('td', {}, formatDate(i.fromDate)), h('td', {}, formatDate(i.toDate)),
          state.vehicleId === 'all' ? h('td', {}, vehicleName(vehicleById.get(i.vehicleId))) : null,
          h('td', { class: 'num' }, formatKm(i.distance)), h('td', { class: 'num' }, formatLitres(i.litres)), h('td', { class: 'num' }, h('strong', {}, formatKmpl(i.kmpl))))))))
      : h('p', { class: 'muted' }, s.mileage.method === 'estimated'
        ? `No two consecutive full-tank fills yet, so mileage is estimated: ${formatKmpl(s.mileage.kmpl)}.`
        : 'Not enough data yet. Add at least two fuel entries with odometer readings.'));

  // ---- history table ----
  // Timeline is grouped per vehicle; re-sort by date for display (newest first)
  const chronological = [...s.periodTimeline].sort((a, b) => (a.log.fuel_date === b.log.fuel_date ? 0 : a.log.fuel_date < b.log.fuel_date ? -1 : 1));
  const entries = [...chronological].reverse();
  const pageInfo = paginate(entries, state.page, state.pageSize);
  state.page = pageInfo.page;
  const warnings = entries.filter((e) => e.status === 'odometer-decrease');

  const history = h('section', { class: 'card' },
    h('div', { class: 'card-header row-between' },
      h('h2', {}, 'Fuel history'),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: !entries.length, onclick: () => exportCSV(entries, vehicleById) }, icon('download'), 'Export CSV')),
    warnings.length
      ? h('div', { class: 'alert alert-warning', role: 'alert' }, icon('alert-triangle'),
        h('div', {}, `${warnings.length} entr${warnings.length === 1 ? 'y has' : 'ies have'} an odometer reading lower than the previous one. These are marked "Check odometer" and excluded from distance. Edit them to correct the reading.`))
      : '',
    entries.length
      ? [fuelTable({ entries: pageInfo.rows, vehicleById, showVehicle: state.vehicleId === 'all' && data.vehicles.length > 1, onEdit: (log) => openFuelForm({ log, data }).then(afterSave), onDelete: removeLog }),
        paginationControls({ ...pageInfo, pageSize: state.pageSize }, (p) => { state.page = p; render(); })]
      : emptyState({ iconName: 'fuel', title: 'No fuel entries in this period', text: 'Record a fill-up: enter the amount and price per litre and the litres are calculated for you.',
        action: h('button', { type: 'button', class: 'btn btn-success', onclick: () => openFuelForm({ data }).then(afterSave) }, icon('plus'), 'Add fuel entry') }));

  const rules = h('details', { class: 'card rules' },
    h('summary', {}, icon('info'), 'How fuel calculations work'),
    h('ul', {},
      h('li', {}, 'Petrol litres = Amount paid ÷ Price per litre (e.g. ₹658 ÷ ₹104/L = 6.33 L), unless you enter litres from the pump receipt.'),
      h('li', {}, 'Distance = this odometer reading − previous valid reading of the same vehicle. The first reading is only a baseline.'),
      h('li', {}, 'A reading lower than the previous one is flagged and never produces a negative distance.'),
      h('li', {}, 'Cost/km per row = amount of this fill ÷ distance since the previous fill (same as the spreadsheet).'),
      h('li', {}, 'Mileage uses consecutive full-tank fills when available; otherwise it is estimated from all fills and labelled "Estimated".')));

  page.main.replaceChildren(
    filterBar({ vehicles: data.vehicles, state, onChange: () => { state.page = 1; render(); } }),
    stats,
    h('div', { class: 'chart-grid' }, consumption.card, spend.card, price.card, distance.card),
    mileageCard,
    history,
    rules);

  if (s.periodFuel.length) {
    barChart(consumption.canvas, monthLabels(months), [...monthlyFuelLitres(s.periodFuel, months).values()], { color: '#16a34a', format: (v) => `${Number(v).toFixed(1)} L` });
    barChart(spend.canvas, monthLabels(months), [...sumByMonth(s.periodFuel, (l) => l.fuel_date, (l) => l.amount_paid, months).values()], { color: '#22c55e', format: shortINR });
    const byDate = chronological;
    lineChart(price.canvas, byDate.map((e) => formatDate(e.log.fuel_date)), byDate.map((e) => num(e.log.price_per_litre)), { color: '#2563eb', format: (v) => `₹${Number(v).toFixed(2)}` });
    const withDistance = byDate.filter((e) => e.distance !== null);
    barChart(distance.canvas, withDistance.map((e) => formatDate(e.log.fuel_date)), withDistance.map((e) => e.distance), { color: '#0ea5e9', format: (v) => `${formatNumber(Number(v), 1)} km` });
  } else {
    [consumption, spend, price, distance].forEach((c) => c.canvas.parentElement.replaceChildren(h('p', { class: 'muted chart-empty' }, 'No fuel data for this period yet.')));
  }
  refreshIcons();
}

if (page) {
  page.main.replaceChildren(loadingBlock('Loading fuel log…'));
  refresh();
}
