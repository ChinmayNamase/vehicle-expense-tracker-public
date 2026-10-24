// Maintenance & Insurance: service records, insurance policies and
// reminders calculated from saved dates and odometer readings.
import { initPage, renderLoadError } from './layout.js';
import { loadAllData, maintenanceApi, insuranceApi } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, formatINR, formatDate, formatNumber, daysUntil,
  vehicleName, DASH,
} from './utils.js';
import { num, totalAmount } from './calculations.js';
import { ensureValidVehicle, filterBar, initialFilterState, forVehicle, buildReminders, remindersCard } from './components.js';
import { openMaintenanceForm, openInsuranceForm, confirmDelete } from './forms.js';

const page = await initPage({ active: 'maintenance', title: 'Maintenance & Insurance', subtitle: 'Service history, policies and upcoming reminders' });

let data = null;
const state = { ...initialFilterState('all'), preset: 'all', from: null, to: null };

async function refresh() {
  try {
    data = await loadAllData();
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}
const afterSave = async (saved) => { if (saved) await refresh(); };

const sortDesc = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);

function serviceTable(records, vehicleById, showVehicle) {
  if (!records.length) return emptyState({ iconName: 'wrench', title: 'No service records yet', text: 'Record services to track costs and get reminders for the next service.' });
  const headers = ['Service date', showVehicle ? 'Vehicle' : null, 'Description', 'Service centre', 'Cost', 'Odometer', 'Next service', 'Actions'].filter(Boolean);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, headers.map((t) => h('th', { scope: 'col', class: ['Cost', 'Odometer'].includes(t) ? 'num' : null }, t)))),
    h('tbody', {}, records.map((r) => h('tr', {},
      h('td', { class: 'nowrap' }, formatDate(r.service_date)),
      showVehicle ? h('td', {}, vehicleName(vehicleById.get(r.vehicle_id))) : null,
      h('td', {}, r.description, r.notes ? h('div', { class: 'muted small clamp' }, r.notes) : null),
      h('td', {}, r.service_centre || DASH),
      h('td', { class: 'num' }, formatINR(num(r.cost))),
      h('td', { class: 'num' }, num(r.odometer_reading) === null ? DASH : `${formatNumber(num(r.odometer_reading), 1)} km`),
      h('td', {},
        r.next_service_date ? h('div', {}, formatDate(r.next_service_date)) : null,
        num(r.next_service_odometer) !== null ? h('div', { class: 'muted small' }, `at ${formatNumber(num(r.next_service_odometer), 0)} km`) : null,
        !r.next_service_date && num(r.next_service_odometer) === null ? DASH : null),
      h('td', { class: 'actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit service of ${formatDate(r.service_date)}`, onclick: () => openMaintenanceForm({ record: r, data }).then(afterSave) }, icon('pencil')),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete service of ${formatDate(r.service_date)}`,
          onclick: () => confirmDelete({ title: 'Delete service record?', message: `"${r.description}" on ${formatDate(r.service_date)} and its Servicing expense will be permanently deleted.`, remove: () => maintenanceApi.remove(r.id), successText: 'Service record deleted.' }).then(afterSave) }, icon('trash-2'))))))));
}

function policyStatus(expiry) {
  const days = daysUntil(expiry);
  if (days === null) return null;
  if (days < 0) return h('span', { class: 'badge badge-red' }, 'Expired');
  if (days <= 30) return h('span', { class: 'badge badge-amber' }, `${days} day${days === 1 ? '' : 's'} left`);
  return h('span', { class: 'badge badge-green' }, 'Active');
}

function insuranceTable(records, vehicleById, showVehicle) {
  if (!records.length) return emptyState({ iconName: 'shield', title: 'No insurance policies yet', text: 'Add your policy to get an expiry reminder.' });
  const headers = ['Provider', showVehicle ? 'Vehicle' : null, 'Policy start', 'Expiry', 'Status', 'Premium', 'Actions'].filter(Boolean);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, headers.map((t) => h('th', { scope: 'col', class: t === 'Premium' ? 'num' : null }, t)))),
    h('tbody', {}, records.map((r) => h('tr', {},
      h('td', {}, r.provider, r.policy_number ? h('div', { class: 'muted small' }, `Policy ${r.policy_number}`) : null, r.notes ? h('div', { class: 'muted small clamp' }, r.notes) : null),
      showVehicle ? h('td', {}, vehicleName(vehicleById.get(r.vehicle_id))) : null,
      h('td', { class: 'nowrap' }, formatDate(r.policy_start_date)),
      h('td', { class: 'nowrap' }, formatDate(r.expiry_date)),
      h('td', {}, policyStatus(r.expiry_date)),
      h('td', { class: 'num' }, formatINR(num(r.premium_amount))),
      h('td', { class: 'actions' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${r.provider} policy`, onclick: () => openInsuranceForm({ record: r, data }).then(afterSave) }, icon('pencil')),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete ${r.provider} policy`,
          onclick: () => confirmDelete({ title: 'Delete insurance policy?', message: `The ${r.provider} policy (expiry ${formatDate(r.expiry_date)}) and its Insurance expense will be permanently deleted.`, remove: () => insuranceApi.remove(r.id), successText: 'Policy deleted.' }).then(afterSave) }, icon('trash-2'))))))));
}

function render() {
  ensureValidVehicle(state, data.vehicles);
  page.actions.replaceChildren(
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openMaintenanceForm({ data }).then(afterSave) }, icon('wrench'), 'Add service'),
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openInsuranceForm({ data }).then(afterSave) }, icon('shield-plus'), 'Add policy'));

  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front', title: 'Add a vehicle first', text: 'Service and insurance records belong to a vehicle.',
      action: h('a', { class: 'btn btn-primary', href: 'vehicles.html' }, 'Go to My Vehicles'),
    })));
    refreshIcons();
    return;
  }

  const vehicles = data.vehicles.filter((v) => state.vehicleId === 'all' || v.id === state.vehicleId);
  const maintenance = forVehicle(data.maintenance, state.vehicleId).sort(sortDesc('service_date'));
  const insurance = forVehicle(data.insurance, state.vehicleId).sort(sortDesc('expiry_date'));
  const vehicleById = new Map(data.vehicles.map((v) => [v.id, v]));
  const showVehicle = state.vehicleId === 'all' && data.vehicles.length > 1;

  page.main.replaceChildren(
    filterBar({ vehicles: data.vehicles, state, onChange: render, showDates: false }),
    remindersCard(buildReminders({ vehicles, maintenance: data.maintenance, insurance: data.insurance })),
    h('section', { class: 'card' },
      h('div', { class: 'card-header row-between' },
        h('div', {}, h('h2', {}, 'Service records'), h('p', { class: 'muted small' }, `Total servicing cost: ${formatINR(totalAmount(maintenance.map((m) => ({ amount: m.cost }))))}`)),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openMaintenanceForm({ data }).then(afterSave) }, icon('plus'), 'Add service')),
      serviceTable(maintenance, vehicleById, showVehicle)),
    h('section', { class: 'card' },
      h('div', { class: 'card-header row-between' },
        h('div', {}, h('h2', {}, 'Insurance policies'), h('p', { class: 'muted small' }, `Total premiums: ${formatINR(totalAmount(insurance.map((i) => ({ amount: i.premium_amount }))))}`)),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openInsuranceForm({ data }).then(afterSave) }, icon('plus'), 'Add policy')),
      insuranceTable(insurance, vehicleById, showVehicle)));
  refreshIcons();
}

if (page) {
  page.main.replaceChildren(loadingBlock('Loading records…'));
  refresh();
}
