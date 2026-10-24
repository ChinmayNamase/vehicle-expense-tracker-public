// Dashboard: summary cards, charts, recent transactions, vehicle summary.
// Every number is calculated from the user's records in Supabase.
import { initPage, renderLoadError } from './layout.js';
import { loadAllData } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, formatINR, formatLitres, formatKm, formatKmpl,
  formatPerKm, formatDate, todayISO, getPreference, setPreference, vehicleName, CATEGORY_COLORS,
} from './utils.js';
import {
  buildSummary, monthsBetween, monthKey, monthlyExpenses, monthlyFuelLitres, monthlyDistance,
  COST_PER_KM_RULES, num, totalAmount,
} from './calculations.js';
import {
  ensureValidVehicle, statCard, filterBar, initialFilterState, forVehicle, chartCard, barChart, doughnutChart,
  shortINR, monthLabels, vehicleDetailsPanel, buildReminders, remindersCard,
} from './components.js';
import { openExpenseForm, openFuelForm, openVehicleForm } from './forms.js';

const page = await initPage({ active: 'dashboard', title: 'Dashboard', subtitle: 'Your vehicle spending and fuel at a glance' });

let data = null;
const state = initialFilterState('all');
state.costMode = getPreference('costMode', 'fuel');

async function refresh() {
  try {
    data = await loadAllData();
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}

async function afterSave(saved) {
  if (saved) await refresh();
}

/** Months shown on the charts: the selected range, or first record → today. */
function chartMonths(expenses, fuelLogs) {
  if (state.from || state.to) {
    const firstRecord = [...expenses.map((e) => e.expense_date), ...fuelLogs.map((l) => l.fuel_date)].sort()[0];
    return monthsBetween(monthKey(state.from || firstRecord || todayISO()), monthKey(state.to || todayISO()));
  }
  const dates = [...expenses.map((e) => e.expense_date), ...fuelLogs.map((l) => l.fuel_date)].sort();
  if (!dates.length) return [];
  return monthsBetween(monthKey(dates[0]), monthKey(todayISO()));
}

function renderActions() {
  page.actions.replaceChildren(
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openExpenseForm({ data }).then(afterSave) }, icon('plus'), h('span', { class: 'hide-sm' }, 'Add '), 'Expense'),
    h('button', { type: 'button', class: 'btn btn-success', onclick: () => openFuelForm({ data }).then(afterSave) }, icon('fuel'), h('span', { class: 'hide-sm' }, 'Add '), 'Fuel'));
}

function render() {
  ensureValidVehicle(state, data.vehicles);
  renderActions();
  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front',
      title: 'Welcome! Add your first vehicle',
      text: 'Add your bike or car to start tracking fuel, mileage and expenses. You can also import your Google Sheets data afterwards.',
      action: h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openVehicleForm().then(afterSave) }, icon('plus'), 'Add vehicle'),
    })));
    refreshIcons();
    return;
  }

  const expenses = forVehicle(data.expenses, state.vehicleId);
  const fuelLogs = forVehicle(data.fuelLogs, state.vehicleId);
  const vehicles = forVehicle(data.vehicles.map((v) => ({ ...v, vehicle_id: v.id })), state.vehicleId);
  const s = buildSummary({ expenses, fuelLogs, from: state.from, to: state.to, costMode: state.costMode });

  const costModeSelect = h('div', { class: 'field field-inline' },
    h('label', { for: 'cost-mode' }, 'Cost/km uses'),
    h('select', { id: 'cost-mode', onchange: (e) => { state.costMode = e.target.value; setPreference('costMode', state.costMode); render(); } },
      h('option', { value: 'fuel', selected: state.costMode === 'fuel' }, 'Fuel only'),
      h('option', { value: 'running', selected: state.costMode === 'running' }, 'All running costs')));

  // ---- summary cards ----
  const mileageBadge = s.mileage.method === 'estimated' ? { text: 'Estimated', tone: 'amber' }
    : s.mileage.method === 'full-tank' ? { text: 'Full-tank', tone: 'green' } : null;
  const stats = h('section', { class: 'stat-grid', 'aria-label': 'Summary' },
    statCard({ label: 'Total expenses', value: formatINR(s.totalExpenses), iconName: 'wallet', tone: 'blue',
      sub: s.purchaseTotal ? `Running ${formatINR(s.runningTotal)} + purchase ${formatINR(s.purchaseTotal)}` : `${s.periodExpenses.length} transactions` }),
    statCard({ label: 'Petrol expenses', value: formatINR(s.petrolExpenses), iconName: 'fuel', tone: 'green',
      sub: s.averagePrice === null ? 'No fuel entries' : `Avg ${formatINR(s.averagePrice)}/L` }),
    statCard({ label: 'Petrol consumed', value: formatLitres(s.litres), iconName: 'droplet', tone: 'green', sub: `${s.periodFuel.length} fill-ups` }),
    statCard({ label: 'Distance travelled', value: formatKm(s.distance), iconName: 'route', tone: 'blue', sub: 'From odometer readings' }),
    statCard({ label: 'Average mileage', value: formatKmpl(s.mileage.kmpl), iconName: 'gauge', tone: 'green', badge: mileageBadge, sub: s.mileage.note }),
    statCard({ label: 'Servicing', value: formatINR(s.servicingExpenses), iconName: 'wrench', tone: 'blue' }),
    statCard({ label: 'Insurance', value: formatINR(s.insuranceExpenses), iconName: 'shield-check', tone: 'blue' }),
    statCard({ label: state.costMode === 'fuel' ? 'Fuel cost per km' : 'Running cost per km', value: formatPerKm(s.costPerKm), iconName: 'indian-rupee', tone: 'green', sub: COST_PER_KM_RULES[state.costMode] }));

  // ---- charts ----
  const months = chartMonths(s.periodExpenses, s.periodFuel);
  const labels = monthLabels(months);
  const monthlyChart = chartCard('chart-monthly-expenses', 'Monthly expenses');
  const categoryChart = chartCard('chart-categories', 'Expenses by category');
  const fuelChart = chartCard('chart-monthly-fuel', 'Monthly fuel consumption', 'Litres filled per month');
  const distanceChart = chartCard('chart-monthly-distance', 'Monthly distance travelled', 'Credited to the month of each odometer reading');
  const noChartData = !s.periodExpenses.length;

  // ---- recent transactions ----
  const recent = [...s.periodExpenses].sort((a, b) => (a.expense_date === b.expense_date
    ? String(b.created_at).localeCompare(String(a.created_at)) : a.expense_date < b.expense_date ? 1 : -1)).slice(0, 8);
  const vehicleById = new Map(data.vehicles.map((v) => [v.id, v]));
  const recentCard = h('section', { class: 'card' },
    h('div', { class: 'card-header row-between' }, h('h2', {}, 'Recent transactions'), h('a', { href: 'expenses.html', class: 'link' }, 'View all')),
    recent.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Date', 'Description', 'Category', 'Amount'].map((t) => h('th', { scope: 'col', class: t === 'Amount' ? 'num' : null }, t)))),
        h('tbody', {}, recent.map((e) => h('tr', {},
          h('td', { class: 'nowrap' }, formatDate(e.expense_date)),
          h('td', {}, e.description, state.vehicleId === 'all' ? h('div', { class: 'muted small' }, vehicleName(vehicleById.get(e.vehicle_id))) : null),
          h('td', {}, h('span', { class: 'chip', style: { '--chip': CATEGORY_COLORS[e.category] } }, e.category)),
          h('td', { class: 'num' }, formatINR(num(e.amount))))))))
      : emptyState({ iconName: 'receipt', title: 'No transactions in this period', text: 'Add an expense or fuel entry, or choose a wider date range.' }));

  // ---- side panel: selected vehicle or list of vehicles ----
  const selected = data.vehicles.find((v) => v.id === state.vehicleId);
  const side = selected
    ? vehicleDetailsPanel(selected, data, { costMode: state.costMode })
    : h('section', { class: 'card' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Your vehicles'), h('p', { class: 'muted small' }, 'Select a vehicle for its full details.')),
      h('ul', { class: 'vehicle-mini-list' }, data.vehicles.map((v) => h('li', {},
        h('button', { type: 'button', class: 'vehicle-mini', onclick: () => { state.vehicleId = v.id; setPreference('vehicleId', v.id); render(); } },
          h('span', { class: 'vehicle-avatar' }, icon(v.vehicle_type === 'Bike' ? 'bike' : 'car')),
          h('span', { class: 'vehicle-mini-text' },
            h('strong', {}, vehicleName(v)),
            h('span', { class: 'muted small' }, `${v.registration_number} · ${formatKm(num(v.current_odometer), 0)}`)),
          h('span', { class: 'vehicle-mini-amount' }, formatINR(totalAmount(data.expenses.filter((e) => e.vehicle_id === v.id)))))))));

  const reminders = buildReminders({ vehicles, maintenance: data.maintenance, insurance: data.insurance });

  page.main.replaceChildren(
    filterBar({ vehicles: data.vehicles, state, onChange: render, extra: [costModeSelect] }),
    stats,
    reminders.length ? remindersCard(reminders, { title: 'Upcoming reminders' }) : '',
    h('div', { class: 'dashboard-grid' },
      h('div', { class: 'dashboard-main' },
        h('div', { class: 'chart-grid' }, monthlyChart.card, categoryChart.card, fuelChart.card, distanceChart.card),
        recentCard),
      h('div', { class: 'dashboard-side' }, side)));

  if (noChartData) {
    [monthlyChart, categoryChart, fuelChart, distanceChart].forEach((c) => c.canvas.parentElement.replaceChildren(h('p', { class: 'muted chart-empty' }, 'No data for this period yet.')));
  } else {
    barChart(monthlyChart.canvas, labels, [...monthlyExpenses(s.periodExpenses, months).values()], { color: '#2563eb', format: shortINR });
    doughnutChart(categoryChart.canvas, s.byCategory);
    barChart(fuelChart.canvas, labels, [...monthlyFuelLitres(s.periodFuel, months).values()], { color: '#16a34a', format: (v) => `${Number(v).toFixed(1)} L` });
    barChart(distanceChart.canvas, labels, [...monthlyDistance(s.periodTimeline, months).values()], { color: '#0ea5e9', format: (v) => `${Math.round(v)} km` });
  }
  refreshIcons();
}

if (page) {
  page.main.replaceChildren(loadingBlock('Loading your dashboard…'));
  document.addEventListener('data-changed', refresh);
  refresh();
}
