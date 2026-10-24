// Reusable UI widgets shared by several pages: stat cards, filter bar,
// charts, the vehicle details panel and service/insurance reminders.
import {
  h, icon, formatINR, formatKm, formatKmpl, formatPerKm, formatDate, formatMonthYear, formatNumber,
  presetRange, getPreference, setPreference, vehicleName, daysUntil, DASH, CATEGORY_COLORS,
} from './utils.js';
import { buildSummary, monthlyRunningDistance, num, totalAmount } from './calculations.js';

// ---------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------
export function statCard({ label, value, sub = '', iconName, tone = 'blue', badge = null }) {
  return h('article', { class: `stat-card tone-${tone}` },
    h('div', { class: 'stat-icon' }, icon(iconName)),
    h('div', { class: 'stat-body' },
      h('p', { class: 'stat-label' }, label, badge ? h('span', { class: `badge badge-${badge.tone || 'grey'}` }, badge.text) : null),
      h('p', { class: 'stat-value' }, value),
      sub ? h('p', { class: 'stat-sub' }, sub) : null));
}

// ---------------------------------------------------------------------
// Filter bar: vehicle selector + date range (presets or custom)
// state = { vehicleId: 'all' | uuid, preset, from, to }
// ---------------------------------------------------------------------
export function initialFilterState(defaultPreset = 'all') {
  const preset = getPreference('datePreset', defaultPreset);
  const range = preset === 'custom'
    ? { from: getPreference('dateFrom'), to: getPreference('dateTo') }
    : presetRange(preset);
  return { vehicleId: getPreference('vehicleId', 'all'), preset, ...range };
}

export function vehicleSelect(vehicles, selectedId, onChange, { includeAll = true, id = 'vehicle-filter', label = 'Vehicle' } = {}) {
  const select = h('select', { id, onchange: (e) => onChange(e.target.value) },
    includeAll ? h('option', { value: 'all' }, 'All vehicles') : null,
    vehicles.map((v) => h('option', { value: v.id, selected: v.id === selectedId }, `${vehicleName(v)} · ${v.registration_number}`)));
  if (selectedId === 'all' || !vehicles.some((v) => v.id === selectedId)) select.value = includeAll ? 'all' : (vehicles[0]?.id || '');
  return h('div', { class: 'field field-inline' }, h('label', { for: id }, label), select);
}

export function filterBar({ vehicles, state, onChange, showDates = true, extra = [] }) {
  const update = (patch) => {
    Object.assign(state, patch);
    if ('vehicleId' in patch) setPreference('vehicleId', state.vehicleId);
    if ('preset' in patch) setPreference('datePreset', state.preset);
    if (state.preset === 'custom') {
      setPreference('dateFrom', state.from || '');
      setPreference('dateTo', state.to || '');
    }
    onChange();
  };

  const fromInput = h('input', { type: 'date', id: 'filter-from', value: state.from || '', onchange: (e) => update({ from: e.target.value || null }) });
  const toInput = h('input', { type: 'date', id: 'filter-to', value: state.to || '', onchange: (e) => update({ to: e.target.value || null }) });
  const customFields = h('div', { class: 'custom-range', hidden: state.preset !== 'custom' },
    h('div', { class: 'field field-inline' }, h('label', { for: 'filter-from' }, 'From'), fromInput),
    h('div', { class: 'field field-inline' }, h('label', { for: 'filter-to' }, 'To'), toInput));

  const presetSelect = h('select', {
    id: 'filter-preset',
    onchange: (e) => {
      const preset = e.target.value;
      customFields.hidden = preset !== 'custom';
      if (preset === 'custom') update({ preset, from: fromInput.value || null, to: toInput.value || null });
      else update({ preset, ...presetRange(preset) });
    },
  },
  [['all', 'All time'], ['this-month', 'This month'], ['last-3', 'Last 3 months'], ['last-6', 'Last 6 months'],
    ['last-12', 'Last 12 months'], ['this-year', 'This year'], ['custom', 'Custom range']]
    .map(([value, text]) => h('option', { value, selected: value === state.preset }, text)));

  return h('div', { class: 'filter-bar card' },
    vehicles.length > 1 || state.vehicleId !== 'all'
      ? vehicleSelect(vehicles, state.vehicleId, (vehicleId) => update({ vehicleId }))
      : null,
    showDates ? h('div', { class: 'field field-inline' }, h('label', { for: 'filter-preset' }, 'Period'), presetSelect) : null,
    showDates ? customFields : null,
    extra);
}

/** Falls back to 'all' if the remembered vehicle was deleted or is not the user's. */
export function ensureValidVehicle(state, vehicles) {
  if (state.vehicleId !== 'all' && !vehicles.some((v) => v.id === state.vehicleId)) {
    state.vehicleId = 'all';
    setPreference('vehicleId', 'all');
  }
}

export function forVehicle(items, vehicleId) {
  return vehicleId && vehicleId !== 'all' ? items.filter((item) => item.vehicle_id === vehicleId) : items;
}

// ---------------------------------------------------------------------
// Charts (Chart.js is loaded globally from the CDN in each HTML page)
// ---------------------------------------------------------------------
const charts = new Map();

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#64748b' } },
    y: { beginAtZero: true, grid: { color: '#eef2f7' }, ticks: { color: '#64748b' } },
  },
};

/** Creates (or recreates) a chart inside the given canvas element. */
export function renderChart(canvas, config) {
  if (!window.Chart) return;
  charts.get(canvas.id)?.destroy();
  charts.set(canvas.id, new window.Chart(canvas, config));
}

export function chartCard(id, title, subtitle = '') {
  const canvas = h('canvas', { id, role: 'img', 'aria-label': title });
  const card = h('section', { class: 'card chart-card' },
    h('div', { class: 'card-header' }, h('h2', {}, title), subtitle ? h('p', { class: 'muted small' }, subtitle) : null),
    h('div', { class: 'chart-box' }, canvas));
  return { card, canvas };
}

export function barChart(canvas, labels, data, { color = '#2563eb', format = (v) => v, label = '' } = {}) {
  renderChart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: color, borderRadius: 6, maxBarThickness: 36 }] },
    options: {
      ...baseOptions,
      plugins: { ...baseOptions.plugins, tooltip: { callbacks: { label: (ctx) => format(ctx.parsed.y) } } },
      scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, ticks: { ...baseOptions.scales.y.ticks, callback: (v) => format(v) } } },
    },
  });
}

export function lineChart(canvas, labels, data, { color = '#16a34a', format = (v) => v, label = '' } = {}) {
  renderChart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label, data, borderColor: color, backgroundColor: `${color}22`, fill: true, tension: 0.3, pointRadius: 3 }] },
    options: {
      ...baseOptions,
      plugins: { ...baseOptions.plugins, tooltip: { callbacks: { label: (ctx) => format(ctx.parsed.y) } } },
      scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, beginAtZero: false, ticks: { ...baseOptions.scales.y.ticks, callback: (v) => format(v) } } },
    },
  });
}

export function doughnutChart(canvas, totalsByCategory) {
  const entries = Object.entries(totalsByCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  renderChart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k]) => CATEGORY_COLORS[k] || '#94a3b8'), borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatINR(ctx.parsed)}` } },
      },
    },
  });
}

/** Compact ₹ for chart axes: ₹1.2L, ₹15k */
export function shortINR(value) {
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)}k`;
  return `₹${Math.round(value)}`;
}

export const monthLabels = (months) => months.map((m) => formatMonthYear(m));

// ---------------------------------------------------------------------
// Vehicle details panel (mirrors the "Vehicle Details" block of the sheet)
// ---------------------------------------------------------------------
export function vehicleDetailsPanel(vehicle, data, { costMode = 'fuel' } = {}) {
  const expenses = data.expenses.filter((e) => e.vehicle_id === vehicle.id);
  const fuelLogs = data.fuelLogs.filter((l) => l.vehicle_id === vehicle.id);
  const summary = buildSummary({ expenses, fuelLogs, costMode });
  const running = monthlyRunningDistance(summary.timeline);
  const show = (value) => (value === null || value === undefined || value === '' ? DASH : value);

  const rows = [
    ['Vehicle type', vehicle.vehicle_type],
    ['Registration number', vehicle.registration_number],
    ['Chassis number', show(vehicle.chassis_number)],
    ['Engine number', show(vehicle.engine_number)],
    ['Manufacturing month/year', formatMonthYear(vehicle.manufacturing_month_year)],
    ['Registration date', formatDate(vehicle.registration_date)],
    ['Registration valid until', formatDate(vehicle.registration_valid_until)],
    ['Purchase date', formatDate(vehicle.purchase_date)],
    ['Fuel type', vehicle.fuel_type],
    ['Current odometer', formatKm(num(vehicle.current_odometer))],
    ['Running this month', formatKm(running.currentMonth)],
    ['Average monthly running', running.averagePerMonth === null ? DASH : formatKm(running.averagePerMonth)],
    ['Average mileage', summary.mileage.kmpl === null ? DASH : `${formatKmpl(summary.mileage.kmpl)}${summary.mileage.method === 'estimated' ? ' (estimated)' : ''}`],
    [costMode === 'fuel' ? 'Fuel cost per km' : 'Running cost per km', formatPerKm(summary.costPerKm)],
    ['Total expenses', formatINR(totalAmount(expenses))],
  ];

  return h('section', { class: 'card details-panel' },
    h('div', { class: 'card-header' },
      h('div', { class: 'vehicle-title' },
        h('span', { class: 'vehicle-avatar' }, icon(vehicle.vehicle_type === 'Bike' ? 'bike' : 'car')),
        h('div', {}, h('h2', {}, vehicleName(vehicle)), h('p', { class: 'muted small' }, 'Vehicle details')))),
    h('dl', { class: 'details-grid' },
      rows.map(([term, value]) => h('div', { class: 'details-row' }, h('dt', {}, term), h('dd', {}, value)))));
}

// ---------------------------------------------------------------------
// Reminders (computed from saved dates/odometer values — no notifications)
// ---------------------------------------------------------------------
const SOON_DAYS = 30;
const SOON_KM = 500;

export function buildReminders({ vehicles, maintenance, insurance }) {
  const reminders = [];
  for (const vehicle of vehicles) {
    const name = `${vehicleName(vehicle)} (${vehicle.registration_number})`;
    const odometer = num(vehicle.current_odometer) ?? 0;

    // Only the most recent service record decides the next service due
    const lastService = maintenance.filter((m) => m.vehicle_id === vehicle.id)
      .sort((a, b) => (a.service_date < b.service_date ? 1 : -1))[0];
    if (lastService?.next_service_date) {
      const days = daysUntil(lastService.next_service_date);
      if (days !== null && days <= SOON_DAYS) {
        reminders.push({ level: days < 0 ? 'danger' : 'warning', iconName: 'wrench', vehicleId: vehicle.id,
          text: `${name}: service ${days < 0 ? `overdue since ${formatDate(lastService.next_service_date)}` : `due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`} (${formatDate(lastService.next_service_date)})`}` });
      }
    }
    const nextKm = num(lastService?.next_service_odometer);
    if (nextKm !== null) {
      const remaining = nextKm - odometer;
      if (remaining <= SOON_KM) {
        reminders.push({ level: remaining < 0 ? 'danger' : 'warning', iconName: 'gauge', vehicleId: vehicle.id,
          text: `${name}: service ${remaining < 0 ? `overdue by ${formatKm(-remaining, 0)}` : `due in ${formatKm(remaining, 0)}`} (at ${formatKm(nextKm, 0)})` });
      }
    }

    const latestPolicy = insurance.filter((i) => i.vehicle_id === vehicle.id)
      .sort((a, b) => (a.expiry_date < b.expiry_date ? 1 : -1))[0];
    if (latestPolicy) {
      const days = daysUntil(latestPolicy.expiry_date);
      if (days !== null && days <= SOON_DAYS) {
        reminders.push({ level: days < 0 ? 'danger' : 'warning', iconName: 'shield-alert', vehicleId: vehicle.id,
          text: `${name}: insurance (${latestPolicy.provider}) ${days < 0 ? `expired on ${formatDate(latestPolicy.expiry_date)}` : `expires in ${days} day${days === 1 ? '' : 's'} (${formatDate(latestPolicy.expiry_date)})`}` });
      }
    }

    if (vehicle.registration_valid_until) {
      const days = daysUntil(vehicle.registration_valid_until);
      if (days !== null && days <= 60) {
        reminders.push({ level: days < 0 ? 'danger' : 'warning', iconName: 'file-badge', vehicleId: vehicle.id,
          text: `${name}: registration ${days < 0 ? 'expired' : 'valid until'} ${formatDate(vehicle.registration_valid_until)}` });
      }
    }
  }
  return reminders.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}

export function remindersCard(reminders, { title = 'Reminders', emptyText = 'No services or renewals due in the next 30 days.' } = {}) {
  return h('section', { class: 'card reminders-card' },
    h('div', { class: 'card-header' },
      h('h2', {}, title),
      h('p', { class: 'muted small' }, 'Based on your saved dates and odometer readings. Shown in the app only — no emails or push notifications are sent.')),
    reminders.length
      ? h('ul', { class: 'reminder-list' }, reminders.map((r) => h('li', { class: `reminder reminder-${r.level}` }, icon(r.iconName), h('span', {}, r.text))))
      : h('p', { class: 'muted' }, emptyText));
}

/** Where to edit an expense row, based on which module created it. */
export const SOURCE_LABELS = { manual: 'Expense', fuel: 'Fuel Tracker', maintenance: 'Maintenance', insurance: 'Insurance' };

// ---------------------------------------------------------------------
// Fuel history table (used by Fuel Tracker and the vehicle detail view)
// entries = timeline entries from buildFuelTimeline()
// ---------------------------------------------------------------------
const STATUS_BADGES = {
  baseline: { text: 'Baseline', tone: 'grey', title: 'First reading — starting point, not counted as distance' },
  'odometer-decrease': { text: 'Check odometer', tone: 'red', title: 'Lower than the previous reading — distance not calculated' },
  'no-odometer': { text: 'No reading', tone: 'amber', title: 'No odometer reading — distance not calculated' },
};

export function fuelTable({ entries, vehicleById, showVehicle = false, onEdit, onDelete }) {
  const headers = ['Date', showVehicle ? 'Vehicle' : null, 'Description', 'Amount', 'Price/L', 'Petrol (L)', 'Odometer', 'Distance', 'Cost/km', 'Notes', 'Actions'].filter(Boolean);
  const numeric = new Set(['Amount', 'Price/L', 'Petrol (L)', 'Odometer', 'Distance', 'Cost/km']);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, headers.map((t) => h('th', { scope: 'col', class: numeric.has(t) ? 'num' : null }, t)))),
    h('tbody', {}, entries.map(({ log, distance, costPerKm: cpk, status }) => {
      const badge = STATUS_BADGES[status];
      return h('tr', {},
        h('td', { class: 'nowrap' }, formatDate(log.fuel_date)),
        showVehicle ? h('td', {}, vehicleName(vehicleById.get(log.vehicle_id))) : null,
        h('td', {}, log.description, log.fuel_station ? h('div', { class: 'muted small' }, log.fuel_station) : null),
        h('td', { class: 'num' }, formatINR(num(log.amount_paid))),
        h('td', { class: 'num' }, formatINR(num(log.price_per_litre))),
        h('td', { class: 'num' }, formatNumber(num(log.litres), 2), log.litres_is_manual ? h('span', { class: 'badge badge-blue', title: 'Entered manually from the pump receipt' }, 'manual') : null),
        h('td', { class: 'num' }, num(log.odometer_reading) === null ? DASH : formatNumber(num(log.odometer_reading), 1)),
        h('td', { class: 'num' }, distance === null ? DASH : formatNumber(distance, 1), badge ? h('span', { class: `badge badge-${badge.tone}`, title: badge.title }, badge.text) : null),
        h('td', { class: 'num' }, cpk === null ? DASH : formatINR(cpk)),
        h('td', {}, log.is_full_tank ? h('span', { class: 'badge badge-green' }, 'Full tank') : '', log.notes ? h('div', { class: 'muted small clamp' }, log.notes) : null),
        h('td', { class: 'actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit fuel entry of ${formatDate(log.fuel_date)}`, onclick: () => onEdit(log) }, icon('pencil')),
          h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete fuel entry of ${formatDate(log.fuel_date)}`, onclick: () => onDelete(log) }, icon('trash-2'))));
    }))));
}
