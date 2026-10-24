// Monthly Reports: month-by-month table, charts and CSV export.
import { initPage, renderLoadError } from './layout.js';
import { loadAllData } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, formatINR, formatLitres, formatKm, formatKmpl,
  formatMonthYear, toCSV, downloadCSV, todayISO, vehicleName, getPreference, DASH,
} from './utils.js';
import {
  buildFuelTimeline, filterByDateRange, monthsBetween, monthKey, categoryTotals, fuelEfficiency,
  mileageSummary, num, sum,
} from './calculations.js';
import {
  ensureValidVehicle, filterBar, forVehicle, chartCard, barChart, doughnutChart, shortINR, monthLabels,
} from './components.js';

const page = await initPage({ active: 'reports', title: 'Monthly Reports', subtitle: 'Month-by-month spending, fuel and distance' });

let data = null;
const thisMonth = todayISO().slice(0, 7);
const twelveMonthsAgo = (() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
const state = { vehicleId: getPreference('vehicleId', 'all'), fromMonth: twelveMonthsAgo, toMonth: thisMonth };

const MAIN_COLUMNS = ['Petrol', 'Servicing', 'Spare Parts', 'Insurance'];

async function refresh() {
  try {
    data = await loadAllData();
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}

const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

/** Builds one report row per month in the selected period. */
function buildReport() {
  const from = `${state.fromMonth}-01`;
  const to = lastDay(state.toMonth);
  const expenses = filterByDateRange(forVehicle(data.expenses, state.vehicleId), (e) => e.expense_date, from, to);
  const allFuel = forVehicle(data.fuelLogs, state.vehicleId);
  const fuel = filterByDateRange(allFuel, (l) => l.fuel_date, from, to);
  const timeline = filterByDateRange(buildFuelTimeline(allFuel), (e) => e.log.fuel_date, from, to);
  const months = monthsBetween(state.fromMonth, state.toMonth);

  const rows = months.map((month) => {
    const monthExpenses = expenses.filter((e) => monthKey(e.expense_date) === month);
    const byCategory = categoryTotals(monthExpenses);
    const total = sum(monthExpenses.map((e) => e.amount));
    const litres = sum(fuel.filter((l) => monthKey(l.fuel_date) === month).map((l) => l.litres));
    const distance = sum(timeline.filter((e) => monthKey(e.log.fuel_date) === month).map((e) => e.distance));
    const main = Object.fromEntries(MAIN_COLUMNS.map((c) => [c, byCategory[c] ?? 0]));
    return {
      month, total, litres, distance, ...main,
      Other: total - sum(Object.values(main)),
      mileage: fuelEfficiency(distance, litres), // approximate for a single month
    };
  });

  return { rows, expenses, fuel, mileage: mileageSummary(fuel), months };
}

function exportCSV(report) {
  const vehicle = data.vehicles.find((v) => v.id === state.vehicleId);
  downloadCSV(`monthly-report-${vehicle ? vehicle.registration_number.replace(/\W/g, '') : 'all'}-${state.fromMonth}-to-${state.toMonth}.csv`, toCSV(report.rows, [
    { header: 'Month', value: (r) => r.month },
    { header: 'Total Expenses', value: (r) => r.total.toFixed(2) },
    { header: 'Petrol Expenses', value: (r) => r.Petrol.toFixed(2) },
    { header: 'Petrol Consumed (L)', value: (r) => r.litres.toFixed(3) },
    { header: 'Distance Travelled (km)', value: (r) => r.distance.toFixed(1) },
    { header: 'Average Mileage (km/L, approx.)', value: (r) => r.mileage?.toFixed(2) ?? '' },
    { header: 'Servicing', value: (r) => r.Servicing.toFixed(2) },
    { header: 'Spare Parts', value: (r) => r['Spare Parts'].toFixed(2) },
    { header: 'Insurance', value: (r) => r.Insurance.toFixed(2) },
    { header: 'Other', value: (r) => r.Other.toFixed(2) },
  ]));
}

function render() {
  ensureValidVehicle(state, data.vehicles);
  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front', title: 'Add a vehicle first', text: 'Reports are built from your vehicle records.',
      action: h('a', { class: 'btn btn-primary', href: 'vehicles.html' }, 'Go to My Vehicles'),
    })));
    refreshIcons();
    return;
  }

  const monthInputs = [
    h('div', { class: 'field field-inline' }, h('label', { for: 'from-month' }, 'From'),
      h('input', { type: 'month', id: 'from-month', value: state.fromMonth, max: thisMonth, onchange: (e) => { if (e.target.value) { state.fromMonth = e.target.value; render(); } } })),
    h('div', { class: 'field field-inline' }, h('label', { for: 'to-month' }, 'To'),
      h('input', { type: 'month', id: 'to-month', value: state.toMonth, onchange: (e) => { if (e.target.value) { state.toMonth = e.target.value; render(); } } })),
  ];
  const bar = filterBar({ vehicles: data.vehicles, state, onChange: render, showDates: false, extra: monthInputs });

  if (state.fromMonth > state.toMonth) {
    page.main.replaceChildren(bar, h('div', { class: 'card' }, h('p', { class: 'field-error' }, 'The "From" month must be before the "To" month.')));
    return;
  }

  const report = buildReport();
  const totals = {
    total: sum(report.rows.map((r) => r.total)),
    Petrol: sum(report.rows.map((r) => r.Petrol)),
    litres: sum(report.rows.map((r) => r.litres)),
    distance: sum(report.rows.map((r) => r.distance)),
    Servicing: sum(report.rows.map((r) => r.Servicing)),
    'Spare Parts': sum(report.rows.map((r) => r['Spare Parts'])),
    Insurance: sum(report.rows.map((r) => r.Insurance)),
    Other: sum(report.rows.map((r) => r.Other)),
  };
  const vehicle = data.vehicles.find((v) => v.id === state.vehicleId);

  const headers = ['Month', 'Total', 'Petrol', 'Petrol (L)', 'Distance', 'Mileage*', 'Servicing', 'Spare parts', 'Insurance', 'Other'];
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'table report-table' },
    h('caption', { class: 'sr-only' }, 'Monthly report'),
    h('thead', {}, h('tr', {}, headers.map((t, i) => h('th', { scope: 'col', class: i ? 'num' : null }, t)))),
    h('tbody', {}, [...report.rows].reverse().map((r) => h('tr', { class: r.total === 0 && r.distance === 0 ? 'row-muted' : null },
      h('th', { scope: 'row' }, formatMonthYear(r.month)),
      h('td', { class: 'num strong' }, formatINR(r.total)),
      h('td', { class: 'num' }, formatINR(r.Petrol)),
      h('td', { class: 'num' }, formatLitres(r.litres)),
      h('td', { class: 'num' }, formatKm(r.distance)),
      h('td', { class: 'num' }, r.mileage === null ? DASH : formatKmpl(r.mileage)),
      h('td', { class: 'num' }, formatINR(r.Servicing)),
      h('td', { class: 'num' }, formatINR(r['Spare Parts'])),
      h('td', { class: 'num' }, formatINR(r.Insurance)),
      h('td', { class: 'num' }, formatINR(r.Other))))),
    h('tfoot', {}, h('tr', {},
      h('th', { scope: 'row' }, 'Total'),
      h('td', { class: 'num' }, formatINR(totals.total)),
      h('td', { class: 'num' }, formatINR(totals.Petrol)),
      h('td', { class: 'num' }, formatLitres(totals.litres)),
      h('td', { class: 'num' }, formatKm(totals.distance)),
      h('td', { class: 'num' }, report.mileage.kmpl === null ? DASH : `${formatKmpl(report.mileage.kmpl)}${report.mileage.method === 'estimated' ? ' (est.)' : ''}`),
      h('td', { class: 'num' }, formatINR(totals.Servicing)),
      h('td', { class: 'num' }, formatINR(totals['Spare Parts'])),
      h('td', { class: 'num' }, formatINR(totals.Insurance)),
      h('td', { class: 'num' }, formatINR(totals.Other))))));

  const expensesChart = chartCard('report-expenses', 'Monthly expenses');
  const petrolChart = chartCard('report-petrol', 'Monthly petrol expenditure');
  const litresChart = chartCard('report-litres', 'Monthly petrol consumption');
  const distanceChart = chartCard('report-distance', 'Monthly running distance');
  const categoryChart = chartCard('report-categories', 'Category-wise expenses');

  page.main.replaceChildren(
    bar,
    h('section', { class: 'card' },
      h('div', { class: 'card-header row-between' },
        h('div', {},
          h('h2', {}, `${vehicle ? `${vehicleName(vehicle)} (${vehicle.registration_number})` : 'All vehicles'} · ${formatMonthYear(state.fromMonth)} – ${formatMonthYear(state.toMonth)}`),
          h('p', { class: 'muted small' }, '*Monthly mileage ≈ distance credited to the month ÷ litres filled that month (approximate). The total row uses the full-tank method when possible. "Other" = purchase, repairs, accessories, parking/tolls and other.')),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => exportCSV(report) }, icon('download'), 'Export CSV')),
      table),
    h('div', { class: 'chart-grid' }, expensesChart.card, categoryChart.card, petrolChart.card, litresChart.card, distanceChart.card));

  const labels = monthLabels(report.months);
  barChart(expensesChart.canvas, labels, report.rows.map((r) => r.total), { color: '#2563eb', format: shortINR });
  barChart(petrolChart.canvas, labels, report.rows.map((r) => r.Petrol), { color: '#16a34a', format: shortINR });
  barChart(litresChart.canvas, labels, report.rows.map((r) => r.litres), { color: '#22c55e', format: (v) => `${Number(v).toFixed(1)} L` });
  barChart(distanceChart.canvas, labels, report.rows.map((r) => r.distance), { color: '#0ea5e9', format: (v) => `${Math.round(v)} km` });
  if (report.expenses.length) doughnutChart(categoryChart.canvas, categoryTotals(report.expenses));
  else categoryChart.canvas.parentElement.replaceChildren(h('p', { class: 'muted chart-empty' }, 'No expenses in this period.'));
  refreshIcons();
}

if (page) {
  page.main.replaceChildren(loadingBlock('Building report…'));
  refresh();
}
