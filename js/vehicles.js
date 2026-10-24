// My Vehicles: vehicle cards (list) and a detail view (?id=<vehicle id>)
// with the details panel, that vehicle's expenses and fuel history.
import { initPage, renderLoadError } from './layout.js';
import { loadAllData, vehiclesApi, fuelApi } from './api.js';
import {
  h, icon, refreshIcons, loadingBlock, emptyState, alertBox, formatINR, formatKm, formatDate,
  setPreference, vehicleName, CATEGORY_COLORS,
} from './utils.js';
import { buildFuelTimeline, num, totalAmount, ownershipCost, purchaseCost } from './calculations.js';
import { vehicleDetailsPanel, fuelTable } from './components.js';
import {
  openVehicleForm, openExpenseForm, openFuelForm, editExpenseRow, deleteExpenseRow, confirmDelete, openReceipt,
} from './forms.js';

const page = await initPage({ active: 'vehicles', title: 'My Vehicles', subtitle: 'Your bikes and cars' });
let data = null;

const selectedId = () => new URLSearchParams(location.search).get('id');

async function refresh() {
  try {
    data = await loadAllData();
    render();
  } catch (error) {
    renderLoadError(page.main, error, refresh);
  }
}

const afterSave = async (saved) => { if (saved) await refresh(); };

function goTo(id) {
  history.pushState({}, '', id ? `vehicles.html?id=${encodeURIComponent(id)}` : 'vehicles.html');
  render();
}

async function removeVehicle(vehicle) {
  const deleted = await confirmDelete({
    title: 'Delete vehicle?',
    message: `${vehicleName(vehicle)} (${vehicle.registration_number}) and ALL of its expenses, fuel entries, service and insurance records will be permanently deleted. This cannot be undone.`,
    remove: () => vehiclesApi.remove(vehicle.id),
    successText: 'Vehicle deleted.',
  });
  if (deleted) {
    history.replaceState({}, '', 'vehicles.html');
    await refresh();
  }
}

function render() {
  const id = selectedId();
  if (id) renderDetail(id);
  else renderList();
  refreshIcons();
}

// ---------------------------------------------------------------------
// List of vehicle cards
// ---------------------------------------------------------------------
function renderList() {
  page.actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openVehicleForm().then(afterSave) }, icon('plus'), 'Add vehicle'));

  if (!data.vehicles.length) {
    page.main.replaceChildren(h('div', { class: 'card' }, emptyState({
      iconName: 'car-front',
      title: 'No vehicles yet',
      text: 'Add your bike or car to start tracking its expenses.',
      action: h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openVehicleForm().then(afterSave) }, icon('plus'), 'Add vehicle'),
    })));
    return;
  }

  page.main.replaceChildren(h('div', { class: 'vehicle-grid' }, data.vehicles.map((v) => {
    const expenses = data.expenses.filter((e) => e.vehicle_id === v.id);
    return h('article', { class: 'card vehicle-card' },
      h('div', { class: 'vehicle-card-top' },
        h('span', { class: 'vehicle-avatar lg' }, icon(v.vehicle_type === 'Bike' ? 'bike' : 'car')),
        h('div', {},
          h('h2', {}, vehicleName(v)),
          h('p', { class: 'reg-plate' }, v.registration_number)),
        h('span', { class: 'badge badge-grey' }, `${v.vehicle_type} · ${v.fuel_type}`)),
      h('dl', { class: 'vehicle-card-stats' },
        h('div', {}, h('dt', {}, 'Total expenses'), h('dd', {}, formatINR(totalAmount(expenses)))),
        h('div', {}, h('dt', {}, 'Odometer'), h('dd', {}, formatKm(num(v.current_odometer), 1)))),
      h('div', { class: 'vehicle-card-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => goTo(v.id) }, icon('eye'), 'View'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => openVehicleForm({ vehicle: v }).then(afterSave) }, icon('pencil'), 'Edit'),
        h('button', { type: 'button', class: 'btn btn-ghost-danger btn-sm', onclick: () => removeVehicle(v) }, icon('trash-2'), 'Delete')));
  })));
}

// ---------------------------------------------------------------------
// Single vehicle view
// ---------------------------------------------------------------------
function renderDetail(id) {
  // The vehicle list only contains rows RLS allowed us to read, so an ID
  // belonging to another user is simply "not found".
  const vehicle = data.vehicles.find((v) => v.id === id);
  page.actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => goTo(null) }, icon('arrow-left'), 'All vehicles'));
  if (!vehicle) {
    page.main.replaceChildren(h('div', { class: 'card' }, alertBox('Vehicle not found. It may have been deleted, or it does not belong to your account.', 'warning')));
    return;
  }
  setPreference('vehicleId', vehicle.id);

  page.actions.append(
    h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openVehicleForm({ vehicle }).then(afterSave) }, icon('pencil'), 'Edit'),
    h('button', { type: 'button', class: 'btn btn-ghost-danger', onclick: () => removeVehicle(vehicle) }, icon('trash-2'), 'Delete'));

  const expenses = data.expenses.filter((e) => e.vehicle_id === id)
    .sort((a, b) => (a.expense_date < b.expense_date ? 1 : a.expense_date > b.expense_date ? -1 : 0));
  const timeline = buildFuelTimeline(data.fuelLogs.filter((l) => l.vehicle_id === id)).reverse();
  const vehicleById = new Map([[vehicle.id, vehicle]]);

  const ownership = h('section', { class: 'card' },
    h('div', { class: 'card-header' }, h('h2', {}, 'Cost of ownership')),
    h('dl', { class: 'details-grid' },
      h('div', { class: 'details-row' }, h('dt', {}, 'Purchase cost'), h('dd', {}, formatINR(purchaseCost(vehicle, expenses)))),
      h('div', { class: 'details-row' }, h('dt', {}, 'Running expenses'), h('dd', {}, formatINR(totalAmount(expenses.filter((e) => e.category !== 'Bike/Car Purchase'))))),
      h('div', { class: 'details-row total' }, h('dt', {}, 'Total ownership cost'), h('dd', {}, formatINR(ownershipCost(vehicle, expenses))))),
    h('p', { class: 'muted small' }, 'Purchase cost uses your "Bike/Car Purchase" expenses if any, otherwise the purchase price saved on the vehicle — never both.'));

  const expenseTable = expenses.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Date', 'Description', 'Category', 'Amount', 'Actions'].map((t) => h('th', { scope: 'col', class: t === 'Amount' ? 'num' : null }, t)))),
      h('tbody', {}, expenses.map((e) => h('tr', {},
        h('td', { class: 'nowrap' }, formatDate(e.expense_date)),
        h('td', {}, e.description, e.receipt_url ? h('button', { type: 'button', class: 'link-btn', onclick: () => openReceipt(e.receipt_url) }, icon('paperclip'), 'Receipt') : null),
        h('td', {}, h('span', { class: 'chip', style: { '--chip': CATEGORY_COLORS[e.category] } }, e.category)),
        h('td', { class: 'num' }, formatINR(num(e.amount))),
        h('td', { class: 'actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${e.description}`, onclick: () => editExpenseRow(e, data).then(afterSave) }, icon('pencil')),
          h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete ${e.description}`, onclick: () => deleteExpenseRow(e, data).then(afterSave) }, icon('trash-2'))))))))
    : emptyState({ iconName: 'receipt', title: 'No expenses for this vehicle yet' });

  const fuelSection = timeline.length
    ? fuelTable({
      entries: timeline,
      vehicleById,
      onEdit: (log) => openFuelForm({ log, data }).then(afterSave),
      onDelete: (log) => confirmDelete({
        title: 'Delete fuel entry?',
        message: `The fuel entry of ${formatDate(log.fuel_date)} (${formatINR(num(log.amount_paid))}) and its expense will be deleted.`,
        remove: () => fuelApi.remove(log.id),
        successText: 'Fuel entry deleted.',
      }).then(afterSave),
    })
    : emptyState({ iconName: 'fuel', title: 'No fuel entries yet' });

  page.main.replaceChildren(
    h('div', { class: 'detail-grid' },
      vehicleDetailsPanel(vehicle, data),
      h('div', { class: 'stack' },
        ownership,
        vehicle.notes ? h('section', { class: 'card' }, h('h2', {}, 'Notes'), h('p', { class: 'pre-wrap' }, vehicle.notes)) : '')),
    h('section', { class: 'card' },
      h('div', { class: 'card-header row-between' },
        h('h2', {}, 'Fuel history'),
        h('button', { type: 'button', class: 'btn btn-success btn-sm', onclick: () => openFuelForm({ data, defaults: { vehicle_id: id } }).then(afterSave) }, icon('fuel'), 'Add fuel')),
      fuelSection),
    h('section', { class: 'card' },
      h('div', { class: 'card-header row-between' },
        h('h2', {}, 'Expenses'),
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => openExpenseForm({ data, defaults: { vehicle_id: id } }).then(afterSave) }, icon('plus'), 'Add expense')),
      expenseTable));
}

if (page) {
  page.main.replaceChildren(loadingBlock('Loading vehicles…'));
  window.addEventListener('popstate', render);
  document.addEventListener('data-changed', refresh);
  refresh();
}
