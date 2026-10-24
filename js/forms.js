// All add/edit forms (vehicle, expense, fuel, maintenance, insurance) as
// reusable dialogs, so the dashboard "Quick Add" buttons and the module
// pages share exactly the same validation and saving code.
import {
  vehiclesApi, expensesApi, fuelApi, maintenanceApi, insuranceApi,
  uploadReceipt, deleteReceipt, receiptUrl, validateReceipt,
} from './api.js';
import {
  h, icon, createDialog, confirmDialog, alertBox, setButtonLoading, toast, refreshIcons,
  toNumber, emptyToNull, todayISO, parseISODate, toISODate, formatINR, formatKm, formatDate,
  formatNumber, formatPerKm, EXPENSE_CATEGORIES, FUEL_TYPES, vehicleName, getPreference, DASH,
} from './utils.js';
import { resolveLitres, buildFuelTimeline, sortFuelLogs, num } from './calculations.js';

const MAX_AMOUNT = 10000000; // ₹1 crore sanity limit
const FUEL_DESCRIPTIONS = ['Petrol HPCL', 'Petrol IOCL', 'Petrol BPCL', 'Petrol Shell', 'Petrol Nayara', 'Petrol Jio-bp'];
const FUEL_STATIONS = ['HPCL', 'IOCL', 'BPCL', 'Shell', 'Nayara', 'Jio-bp'];

// ---------------------------------------------------------------------
// Form building blocks
// ---------------------------------------------------------------------
let formCounter = 0;

function fieldFactory(prefix) {
  return function field({ label, name, type = 'text', value = '', required = false, options = [], hint = '', attrs = {}, full = false }) {
    const id = `${prefix}-${name}`;
    const describedBy = [hint ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(' ');
    const common = { id, name, required, 'aria-describedby': describedBy, ...attrs };
    let control;
    if (type === 'select') {
      control = h('select', common, options.map((option) => {
        const [optionValue, text] = Array.isArray(option) ? option : [option, option];
        return h('option', { value: optionValue, selected: String(optionValue) === String(value ?? '') }, text);
      }));
    } else if (type === 'textarea') {
      control = h('textarea', { rows: 3, maxlength: 1000, ...common }, value ?? '');
    } else if (type === 'checkbox') {
      return h('div', { class: `field field-check${full ? ' field-full' : ''}` },
        h('input', { ...common, type: 'checkbox', checked: Boolean(value) }),
        h('label', { for: id }, label),
        hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
        h('p', { class: 'field-error', id: `${id}-error` }));
    } else {
      control = h('input', { type, value: value ?? '', ...common });
    }
    return h('div', { class: `field${full ? ' field-full' : ''}` },
      h('label', { for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      control,
      hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
      h('p', { class: 'field-error', id: `${id}-error`, 'aria-live': 'polite' }));
  };
}

/** Shows field errors ({ fieldName: message }); returns true when there are none. */
function showErrors(form, errors) {
  let firstInvalid = null;
  for (const control of form.elements) {
    if (!control.name) continue;
    const message = errors[control.name] || '';
    const errorEl = document.getElementById(`${control.id}-error`);
    if (errorEl) errorEl.textContent = message;
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message && !firstInvalid) firstInvalid = control;
  }
  firstInvalid?.focus();
  return !firstInvalid;
}

/**
 * Opens a dialog containing a form. `build(form, field)` adds the inputs,
 * `submit(form)` validates + saves and returns the saved row (or false to stay open).
 * Resolves with the saved row, or null if cancelled.
 */
function formDialog({ title, size = 'md', submitText = 'Save', build, submit, intro = null }) {
  return new Promise((resolve) => {
    let result = null;
    const formId = `form-${++formCounter}`;
    const { body, footer, open, close } = createDialog({ title, size, onClose: () => resolve(result) });
    const message = h('div', { class: 'form-message' });
    const form = h('form', { id: formId, class: 'form-grid', novalidate: true });
    const field = fieldFactory(formId);
    build(form, field, { close: () => close('cancel') });
    body.append(intro || '', message, form);

    const submitButton = h('button', { type: 'submit', class: 'btn btn-primary', form: formId }, submitText);
    footer.append(h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close('cancel') }, 'Cancel'), submitButton);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.replaceChildren();
      setButtonLoading(submitButton, true);
      try {
        const saved = await submit(form, { message });
        if (saved !== false) {
          result = saved;
          close('saved');
        }
      } catch (error) {
        message.replaceChildren(alertBox(error.message, 'error'));
        refreshIcons();
      } finally {
        setButtonLoading(submitButton, false);
      }
    });
    open();
    form.querySelector('input:not([type=hidden]):not([readonly]), select')?.focus();
  });
}

function vehicleOptions(vehicles) {
  return vehicles.map((v) => [v.id, `${vehicleName(v)} · ${v.registration_number}`]);
}

function defaultVehicleId(vehicles, preferred) {
  const remembered = getPreference('vehicleId');
  return [preferred, remembered].find((id) => id && vehicles.some((v) => v.id === id)) || vehicles[0]?.id || '';
}

function ensureVehicles(vehicles) {
  if (vehicles.length) return true;
  toast('Add a vehicle first (My Vehicles → Add Vehicle).', 'info');
  return false;
}

// Common validators
const isFuture = (iso) => iso > todayISO();
function validateDate(value, { allowFuture = false, label = 'Date' } = {}) {
  if (!value || !parseISODate(value)) return `${label} is required.`;
  if (!allowFuture && isFuture(value)) return `${label} cannot be in the future.`;
  return null;
}
function validateAmount(value, { allowZero = false, label = 'Amount' } = {}) {
  const amount = toNumber(value);
  if (amount === null) return `${label} is required.`;
  if (amount < 0) return `${label} cannot be negative.`;
  if (!allowZero && amount === 0) return `${label} must be greater than ₹0.`;
  if (amount > MAX_AMOUNT) return `${label} looks too large.`;
  return null;
}
function validateOptionalOdometer(value) {
  if (value === '' || value === null || value === undefined) return null;
  const reading = toNumber(value);
  if (reading === null || reading < 0) return 'Odometer must be a positive number of km.';
  if (reading > 9999999) return 'Odometer reading looks too large.';
  return null;
}
const compact = (errors) => Object.fromEntries(Object.entries(errors).filter(([, v]) => v));

// =====================================================================
// Vehicle form
// =====================================================================
export function openVehicleForm({ vehicle = null } = {}) {
  const v = vehicle || {};
  return formDialog({
    title: vehicle ? 'Edit vehicle' : 'Add vehicle',
    size: 'lg',
    submitText: vehicle ? 'Save changes' : 'Add vehicle',
    intro: vehicle ? h('p', { class: 'muted small' }, `Vehicle ID: ${vehicle.id}`) : null,
    build(form, field) {
      form.append(
        h('h3', { class: 'form-section' }, 'Basic details'),
        field({ label: 'Vehicle type', name: 'vehicle_type', type: 'select', value: v.vehicle_type || 'Bike', options: ['Bike', 'Car'], required: true }),
        field({ label: 'Fuel type', name: 'fuel_type', type: 'select', value: v.fuel_type || 'Petrol', options: FUEL_TYPES, required: true }),
        field({ label: 'Make', name: 'make', value: v.make, required: true, attrs: { maxlength: 60, placeholder: 'e.g. Honda', autocomplete: 'off' } }),
        field({ label: 'Model', name: 'model', value: v.model, required: true, attrs: { maxlength: 60, placeholder: 'e.g. Activa 6G', autocomplete: 'off' } }),
        field({ label: 'Registration number', name: 'registration_number', value: v.registration_number, required: true, attrs: { maxlength: 20, placeholder: 'e.g. MH12AB1234', autocapitalize: 'characters' } }),
        field({ label: 'Current odometer (km)', name: 'current_odometer', type: 'number', value: v.current_odometer ?? '', required: true, attrs: { min: 0, step: '0.1', inputmode: 'decimal' }, hint: 'Updated automatically when you log a higher reading.' }),
        h('h3', { class: 'form-section' }, 'Registration & purchase'),
        field({ label: 'Manufacturing month/year', name: 'manufacturing_month_year', type: 'month', value: v.manufacturing_month_year }),
        field({ label: 'Registration date', name: 'registration_date', type: 'date', value: v.registration_date }),
        field({ label: 'Registration valid until', name: 'registration_valid_until', type: 'date', value: v.registration_valid_until, hint: 'If applicable.' }),
        field({ label: 'Purchase date', name: 'purchase_date', type: 'date', value: v.purchase_date }),
        field({ label: 'Purchase price (₹)', name: 'purchase_price', type: 'number', value: v.purchase_price ?? '', attrs: { min: 0, step: '0.01', inputmode: 'decimal' }, hint: 'Shown in ownership cost, never in running cost.' }),
        field({ label: 'Fuel tank capacity (L)', name: 'tank_capacity', type: 'number', value: v.tank_capacity ?? '', attrs: { min: 0, step: '0.1', inputmode: 'decimal' } }),
        h('h3', { class: 'form-section' }, 'Optional identifiers'),
        field({ label: 'Chassis number', name: 'chassis_number', value: v.chassis_number, attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'Optional — only if you want it on record.' }),
        field({ label: 'Engine number', name: 'engine_number', value: v.engine_number, attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'Optional.' }),
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: v.notes, full: true }));
    },
    async submit(form) {
      const f = form.elements;
      const reg = f.registration_number.value.trim().toUpperCase().replace(/\s+/g, ' ');
      const errors = compact({
        make: f.make.value.trim() ? null : 'Make is required.',
        model: f.model.value.trim() ? null : 'Model is required.',
        registration_number: !reg ? 'Registration number is required.' : /^[A-Z0-9 -]{2,20}$/.test(reg) ? null : 'Use letters, numbers, spaces or hyphens only.',
        current_odometer: f.current_odometer.value === '' ? 'Enter the current odometer reading (0 for a new vehicle).' : validateOptionalOdometer(f.current_odometer.value),
        purchase_price: f.purchase_price.value === '' ? null : validateAmount(f.purchase_price.value, { allowZero: true, label: 'Purchase price' }),
        tank_capacity: f.tank_capacity.value === '' || toNumber(f.tank_capacity.value) > 0 ? null : 'Tank capacity must be greater than 0.',
        purchase_date: f.purchase_date.value && isFuture(f.purchase_date.value) ? 'Purchase date cannot be in the future.' : null,
        manufacturing_month_year: f.manufacturing_month_year.value && f.manufacturing_month_year.value > todayISO().slice(0, 7) ? 'Cannot be in the future.' : null,
        registration_valid_until: f.registration_valid_until.value && f.registration_date.value && f.registration_valid_until.value < f.registration_date.value
          ? 'Must be after the registration date.' : null,
      });
      if (!showErrors(form, errors)) return false;

      const values = {
        vehicle_type: f.vehicle_type.value,
        fuel_type: f.fuel_type.value,
        make: f.make.value.trim(),
        model: f.model.value.trim(),
        registration_number: reg,
        current_odometer: toNumber(f.current_odometer.value),
        manufacturing_month_year: emptyToNull(f.manufacturing_month_year.value),
        registration_date: emptyToNull(f.registration_date.value),
        registration_valid_until: emptyToNull(f.registration_valid_until.value),
        purchase_date: emptyToNull(f.purchase_date.value),
        purchase_price: toNumber(f.purchase_price.value),
        tank_capacity: toNumber(f.tank_capacity.value),
        chassis_number: emptyToNull(f.chassis_number.value)?.toUpperCase() ?? null,
        engine_number: emptyToNull(f.engine_number.value)?.toUpperCase() ?? null,
        notes: emptyToNull(f.notes.value),
      };
      const saved = await vehiclesApi.save(values, vehicle?.id);
      toast(vehicle ? 'Vehicle updated.' : 'Vehicle added.');
      return saved;
    },
  });
}

// =====================================================================
// Expense form (non-fuel expenses)
// =====================================================================
export function openExpenseForm({ expense = null, data, defaults = {} }) {
  if (!ensureVehicles(data.vehicles)) return Promise.resolve(null);
  const e = expense || defaults;
  let removeReceipt = false;

  return formDialog({
    title: expense ? 'Edit expense' : 'Add expense',
    submitText: expense ? 'Save changes' : 'Add expense',
    build(form, field, { close }) {
      const petrolNotice = h('div', { class: 'field-full', hidden: true },
        alertBox(h('span', {}, 'Petrol purchases are recorded in the Fuel Tracker so litres, odometer and mileage are captured. ',
          h('button', { type: 'button', class: 'btn btn-sm btn-success', onclick: () => {
            const f = form.elements;
            close();
            openFuelForm({ data, defaults: { fuel_date: f.expense_date.value, vehicle_id: f.vehicle_id.value, amount_paid: f.amount.value, notes: f.notes.value } })
              .then((saved) => saved && document.dispatchEvent(new CustomEvent('data-changed')));
          } }, icon('fuel'), 'Open fuel entry form')), 'info'));

      const receiptBlock = h('div', { class: 'field field-full' },
        h('label', { for: `${form.id}-receipt` }, 'Receipt image (optional)'),
        h('input', { type: 'file', id: `${form.id}-receipt`, name: 'receipt', accept: 'image/jpeg,image/png,image/webp,image/heic', 'aria-describedby': `${form.id}-receipt-hint ${form.id}-receipt-error` }),
        h('p', { class: 'hint', id: `${form.id}-receipt-hint` }, 'JPG, PNG, WEBP or HEIC, up to 5 MB. Stored privately — only you can view it.'),
        h('p', { class: 'field-error', id: `${form.id}-receipt-error` }));
      if (expense?.receipt_url) {
        receiptBlock.append(h('div', { class: 'receipt-existing' },
          h('button', { type: 'button', class: 'btn btn-sm btn-secondary', onclick: () => openReceipt(expense.receipt_url) }, icon('image'), 'View current receipt'),
          h('label', { class: 'inline-check' },
            h('input', { type: 'checkbox', onchange: (ev) => { removeReceipt = ev.target.checked; } }), 'Remove receipt')));
      }

      form.append(
        field({ label: 'Date', name: 'expense_date', type: 'date', value: e.expense_date || todayISO(), required: true, attrs: { max: todayISO() } }),
        field({ label: 'Vehicle', name: 'vehicle_id', type: 'select', value: defaultVehicleId(data.vehicles, e.vehicle_id), options: vehicleOptions(data.vehicles), required: true }),
        field({ label: 'Category', name: 'category', type: 'select', value: e.category || 'Servicing', options: EXPENSE_CATEGORIES, required: true }),
        field({ label: 'Amount (₹)', name: 'amount', type: 'number', value: e.amount ?? '', required: true, attrs: { min: 0.01, step: '0.01', inputmode: 'decimal', placeholder: '0.00' } }),
        field({ label: 'Description', name: 'description', value: e.description, required: true, full: true, attrs: { maxlength: 120, placeholder: 'e.g. Chain lubrication, Helmet, FASTag recharge' } }),
        petrolNotice,
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: e.notes, full: true }),
        receiptBlock);

      const category = form.elements.category;
      const syncPetrol = () => {
        petrolNotice.hidden = category.value !== 'Petrol';
        refreshIcons();
      };
      category.addEventListener('change', syncPetrol);
      syncPetrol();
    },
    async submit(form) {
      const f = form.elements;
      const file = f.receipt.files[0];
      const errors = compact({
        expense_date: validateDate(f.expense_date.value),
        vehicle_id: f.vehicle_id.value ? null : 'Choose a vehicle.',
        category: f.category.value === 'Petrol' ? 'Use the Fuel Tracker for petrol (button above).' : null,
        amount: validateAmount(f.amount.value),
        description: f.description.value.trim() ? null : 'Description is required.',
        receipt: validateReceipt(file),
      });
      if (!showErrors(form, errors)) return false;

      let newReceiptPath = null;
      if (file) newReceiptPath = await uploadReceipt(file);
      const oldReceipt = expense?.receipt_url || null;
      const receipt_url = newReceiptPath || (removeReceipt ? null : oldReceipt);

      const values = {
        expense_date: f.expense_date.value,
        vehicle_id: f.vehicle_id.value,
        category: f.category.value,
        amount: toNumber(f.amount.value),
        description: f.description.value.trim(),
        notes: emptyToNull(f.notes.value),
        receipt_url,
      };
      try {
        const saved = await expensesApi.save(values, expense?.id);
        if (oldReceipt && oldReceipt !== receipt_url) deleteReceipt(oldReceipt).catch(() => {});
        toast(expense ? 'Expense updated.' : 'Expense added.');
        return saved;
      } catch (error) {
        if (newReceiptPath) deleteReceipt(newReceiptPath).catch(() => {}); // don't leave orphan files
        throw error;
      }
    },
  });
}

export async function openReceipt(path) {
  // Open the tab immediately (inside the click) so popup blockers allow it,
  // then point it at a short-lived signed URL for the private file.
  const popup = window.open('', '_blank');
  try {
    const url = await receiptUrl(path);
    if (popup) {
      popup.opener = null;
      popup.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener');
    }
  } catch (error) {
    popup?.close();
    toast(error.message, 'error');
  }
}

// =====================================================================
// Fuel form — reproduces the spreadsheet's petrol rows with automatic litres
// =====================================================================

/** Where would this entry sit in the vehicle's history? Used for live hints. */
function previewFuelPosition({ data, editingId, vehicleId, date, odometer, amount }) {
  const others = data.fuelLogs.filter((l) => l.vehicle_id === vehicleId && l.id !== editingId);
  const candidate = { id: '__candidate__', vehicle_id: vehicleId, fuel_date: date, odometer_reading: odometer, amount_paid: amount, created_at: '9999' };
  const entry = buildFuelTimeline([...others, candidate]).find((e) => e.log.id === '__candidate__');
  const sorted = sortFuelLogs([...others, candidate]);
  const index = sorted.indexOf(candidate);
  const next = sorted.slice(index + 1).find((l) => num(l.odometer_reading) !== null);
  return { entry, next };
}

export function openFuelForm({ log = null, data, defaults = {} }) {
  if (!ensureVehicles(data.vehicles)) return Promise.resolve(null);
  const l = log || defaults;
  let preview = null;

  return formDialog({
    title: log ? 'Edit fuel entry' : 'Add fuel entry',
    size: 'lg',
    submitText: log ? 'Save changes' : 'Save fuel entry',
    build(form, field) {
      const listId = `${form.id}-desc-list`;
      const stationListId = `${form.id}-station-list`;
      const calcPanel = h('div', { class: 'calc-panel field-full', 'aria-live': 'polite' });

      form.append(
        h('datalist', { id: listId }, FUEL_DESCRIPTIONS.map((d) => h('option', { value: d }))),
        h('datalist', { id: stationListId }, FUEL_STATIONS.map((d) => h('option', { value: d }))),
        field({ label: 'Date', name: 'fuel_date', type: 'date', value: l.fuel_date || todayISO(), required: true, attrs: { max: todayISO() } }),
        field({ label: 'Vehicle', name: 'vehicle_id', type: 'select', value: defaultVehicleId(data.vehicles, l.vehicle_id), options: vehicleOptions(data.vehicles), required: true }),
        field({ label: 'Description', name: 'description', value: l.description || 'Petrol', required: true, attrs: { list: listId, maxlength: 120, placeholder: 'e.g. Petrol HPCL' } }),
        field({ label: 'Fuel station (optional)', name: 'fuel_station', value: l.fuel_station, attrs: { list: stationListId, maxlength: 60, placeholder: 'e.g. HPCL, Baner Road' } }),
        field({ label: 'Amount paid (₹)', name: 'amount_paid', type: 'number', value: l.amount_paid ?? '', required: true, attrs: { min: 0.01, step: '0.01', inputmode: 'decimal', placeholder: 'e.g. 658.00' } }),
        field({ label: 'Petrol price per litre (₹)', name: 'price_per_litre', type: 'number', value: l.price_per_litre ?? '', required: true, attrs: { min: 0.01, step: '0.01', inputmode: 'decimal', placeholder: 'e.g. 104.00' } }),
        field({ label: 'Petrol (litres)', name: 'litres', type: 'number', value: l.litres_is_manual ? l.litres : '', attrs: { min: 0.001, step: '0.001', inputmode: 'decimal', readonly: !l.litres_is_manual }, hint: 'Calculated automatically: Amount ÷ Price per litre.' }),
        field({ label: 'Enter litres manually (from the pump receipt)', name: 'litres_is_manual', type: 'checkbox', value: l.litres_is_manual }),
        field({ label: 'Odometer reading (km)', name: 'odometer_reading', type: 'number', value: l.odometer_reading ?? '', attrs: { min: 0, step: '0.1', inputmode: 'decimal', placeholder: 'e.g. 348.2' }, hint: 'Needed for distance travelled and mileage.' }),
        field({ label: 'Full tank fill-up', name: 'is_full_tank', type: 'checkbox', value: l.is_full_tank, hint: 'Tick only if you filled the tank completely. Mileage is most accurate between two full-tank fills.' }),
        calcPanel,
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: l.notes, full: true }));

      const f = form.elements;
      const recalc = () => {
        const amount = toNumber(f.amount_paid.value);
        const price = toNumber(f.price_per_litre.value);
        const useManual = f.litres_is_manual.checked;
        f.litres.readOnly = !useManual;
        f.litres.parentElement.querySelector('.hint').textContent = useManual
          ? 'Using the litres printed on your pump receipt.'
          : 'Calculated automatically: Amount ÷ Price per litre.';
        const { litres, calculated } = resolveLitres({ amountPaid: amount, pricePerLitre: price, manualLitres: toNumber(f.litres.value), useManual });
        if (!useManual) f.litres.value = calculated === null ? '' : calculated.toFixed(2);

        const vehicle = data.vehicles.find((v) => v.id === f.vehicle_id.value);
        const odometer = toNumber(f.odometer_reading.value);
        preview = previewFuelPosition({ data, editingId: log?.id, vehicleId: f.vehicle_id.value, date: f.fuel_date.value, odometer, amount });
        const { entry, next } = preview;

        const rows = [];
        rows.push(['Petrol (litres)', litres === null ? DASH : `${formatNumber(litres, 2)} L ${useManual ? '(manual)' : '(calculated)'}`]);
        if (useManual && litres && amount) {
          rows.push(['Effective price', `${formatINR(amount / litres)}/L`]);
        }
        rows.push(['Previous odometer', entry?.previousReading === null || entry?.previousReading === undefined ? 'None — this is the first reading (baseline)' : formatKm(entry.previousReading)]);
        rows.push(['Distance since previous', entry?.distance === null || entry?.distance === undefined ? DASH : formatKm(entry.distance)]);
        rows.push(['Cost per km (this fill)', formatPerKm(entry?.costPerKm ?? null)]);

        const notes = [];
        if (useManual) {
          notes.push(alertBox('Manual litres are used for consumption, mileage (km/L) and average price instead of Amount ÷ Price. The price per litre you typed is still saved for the price-trend chart.', 'info'));
          const diff = litres && amount && price ? Math.abs(amount / litres - price) / price : 0;
          if (diff > 0.03) notes.push(alertBox(`Amount ÷ litres gives ${formatINR(amount / litres)}/L, which differs from the price you entered by ${(diff * 100).toFixed(1)}%. Please double-check.`, 'warning'));
        }
        if (entry?.status === 'baseline' && odometer !== null) notes.push(alertBox('This is the first odometer reading for this vehicle. It is treated as a starting point (baseline), not as distance travelled.', 'info'));
        if (entry?.status === 'odometer-decrease') notes.push(alertBox(`This reading is lower than the previous reading (${formatKm(entry.previousReading)}). Check for a typo — distance will not be calculated for this entry.`, 'warning'));
        if (next && odometer !== null && odometer > num(next.odometer_reading)) notes.push(alertBox(`This reading is higher than a later entry (${formatKm(num(next.odometer_reading))} on ${formatDate(next.fuel_date)}). That later entry will be flagged.`, 'warning'));
        if (vehicle?.tank_capacity && litres > num(vehicle.tank_capacity) * 1.05) notes.push(alertBox(`Litres exceed the tank capacity of ${formatNumber(num(vehicle.tank_capacity), 1)} L.`, 'warning'));

        calcPanel.replaceChildren(
          h('h3', {}, icon('calculator'), 'Live calculation'),
          h('dl', { class: 'calc-grid' }, rows.map(([t, v]) => h('div', {}, h('dt', {}, t), h('dd', {}, v)))),
          ...notes);
        refreshIcons();
      };

      f.litres_is_manual.addEventListener('change', () => {
        if (f.litres_is_manual.checked) f.litres.focus();
        recalc();
      });
      f.fuel_station.addEventListener('change', () => {
        // Convenience: "Petrol" + station, like the spreadsheet descriptions
        if (/^petrol( \w+)?$/i.test(f.description.value.trim()) && f.fuel_station.value.trim()) {
          f.description.value = `Petrol ${f.fuel_station.value.trim().split(/[ ,]/)[0]}`;
        }
      });
      ['input', 'change'].forEach((type) => form.addEventListener(type, (event) => {
        if (event.target !== f.litres_is_manual) recalc();
      }));
      recalc();
    },
    async submit(form) {
      const f = form.elements;
      const amount = toNumber(f.amount_paid.value);
      const price = toNumber(f.price_per_litre.value);
      const useManual = f.litres_is_manual.checked;
      const { litres } = resolveLitres({ amountPaid: amount, pricePerLitre: price, manualLitres: toNumber(f.litres.value), useManual });

      const errors = compact({
        fuel_date: validateDate(f.fuel_date.value),
        vehicle_id: f.vehicle_id.value ? null : 'Choose a vehicle.',
        description: f.description.value.trim() ? null : 'Description is required (e.g. Petrol HPCL).',
        amount_paid: validateAmount(f.amount_paid.value, { label: 'Amount paid' }),
        price_per_litre: price === null ? 'Price per litre is required.' : price <= 0 ? 'Price must be greater than ₹0.' : price > 500 ? 'Price per litre looks too high.' : null,
        litres: useManual && !(toNumber(f.litres.value) > 0) ? 'Enter the litres from your receipt, or untick manual entry.' : litres === null ? 'Litres could not be calculated.' : null,
        odometer_reading: validateOptionalOdometer(f.odometer_reading.value),
      });
      if (!showErrors(form, errors)) return false;

      if (preview?.entry?.status === 'odometer-decrease') {
        const proceed = await confirmDialog({
          title: 'Odometer reading is lower',
          message: `The reading you entered is lower than the previous reading (${formatKm(preview.entry.previousReading)}). It will be saved but flagged, and no distance will be calculated for it. Save anyway?`,
          confirmText: 'Save anyway',
          danger: false,
        });
        if (!proceed) return false;
      }

      const values = {
        fuel_date: f.fuel_date.value,
        vehicle_id: f.vehicle_id.value,
        description: f.description.value.trim(),
        fuel_station: emptyToNull(f.fuel_station.value),
        amount_paid: amount,
        price_per_litre: price,
        litres: Math.round(litres * 1000) / 1000, // DB keeps 3 decimals
        litres_is_manual: useManual,
        odometer_reading: toNumber(f.odometer_reading.value),
        is_full_tank: f.is_full_tank.checked,
        notes: emptyToNull(f.notes.value),
      };
      const saved = await fuelApi.save(values, log?.id);
      toast(log ? 'Fuel entry updated.' : 'Fuel entry saved.');
      return saved;
    },
  });
}

// =====================================================================
// Maintenance form
// =====================================================================
export function openMaintenanceForm({ record = null, data, defaults = {} }) {
  if (!ensureVehicles(data.vehicles)) return Promise.resolve(null);
  const r = record || defaults;
  return formDialog({
    title: record ? 'Edit service record' : 'Add service record',
    size: 'lg',
    submitText: record ? 'Save changes' : 'Save service',
    build(form, field) {
      form.append(
        field({ label: 'Service date', name: 'service_date', type: 'date', value: r.service_date || todayISO(), required: true, attrs: { max: todayISO() } }),
        field({ label: 'Vehicle', name: 'vehicle_id', type: 'select', value: defaultVehicleId(data.vehicles, r.vehicle_id), options: vehicleOptions(data.vehicles), required: true }),
        field({ label: 'Service description', name: 'description', value: r.description, required: true, attrs: { maxlength: 120, placeholder: 'e.g. 3rd free service, oil change' } }),
        field({ label: 'Service centre', name: 'service_centre', value: r.service_centre, attrs: { maxlength: 80 } }),
        field({ label: 'Cost (₹)', name: 'cost', type: 'number', value: r.cost ?? '', required: true, attrs: { min: 0, step: '0.01', inputmode: 'decimal' }, hint: 'Enter 0 for a free service. Added to expenses as "Servicing".' }),
        field({ label: 'Odometer reading (km)', name: 'odometer_reading', type: 'number', value: r.odometer_reading ?? '', attrs: { min: 0, step: '0.1', inputmode: 'decimal' } }),
        field({ label: 'Next service date', name: 'next_service_date', type: 'date', value: r.next_service_date }),
        field({ label: 'Next service odometer (km)', name: 'next_service_odometer', type: 'number', value: r.next_service_odometer ?? '', attrs: { min: 0, step: '0.1', inputmode: 'decimal' } }),
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: r.notes, full: true }));
    },
    async submit(form) {
      const f = form.elements;
      const odo = toNumber(f.odometer_reading.value);
      const nextOdo = toNumber(f.next_service_odometer.value);
      const errors = compact({
        service_date: validateDate(f.service_date.value, { label: 'Service date' }),
        vehicle_id: f.vehicle_id.value ? null : 'Choose a vehicle.',
        description: f.description.value.trim() ? null : 'Description is required.',
        cost: validateAmount(f.cost.value, { allowZero: true, label: 'Cost' }),
        odometer_reading: validateOptionalOdometer(f.odometer_reading.value),
        next_service_date: f.next_service_date.value && f.next_service_date.value < f.service_date.value ? 'Must be after the service date.' : null,
        next_service_odometer: validateOptionalOdometer(f.next_service_odometer.value)
          || (nextOdo !== null && odo !== null && nextOdo < odo ? 'Must be higher than the current reading.' : null),
      });
      if (!showErrors(form, errors)) return false;
      const values = {
        service_date: f.service_date.value,
        vehicle_id: f.vehicle_id.value,
        description: f.description.value.trim(),
        service_centre: emptyToNull(f.service_centre.value),
        cost: toNumber(f.cost.value),
        odometer_reading: odo,
        next_service_date: emptyToNull(f.next_service_date.value),
        next_service_odometer: nextOdo,
        notes: emptyToNull(f.notes.value),
      };
      const saved = await maintenanceApi.save(values, record?.id);
      toast(record ? 'Service record updated.' : 'Service record saved.');
      return saved;
    },
  });
}

// =====================================================================
// Insurance form
// =====================================================================
export function openInsuranceForm({ record = null, data, defaults = {} }) {
  if (!ensureVehicles(data.vehicles)) return Promise.resolve(null);
  const r = record || defaults;
  return formDialog({
    title: record ? 'Edit insurance policy' : 'Add insurance policy',
    submitText: record ? 'Save changes' : 'Save policy',
    build(form, field) {
      form.append(
        field({ label: 'Vehicle', name: 'vehicle_id', type: 'select', value: defaultVehicleId(data.vehicles, r.vehicle_id), options: vehicleOptions(data.vehicles), required: true }),
        field({ label: 'Insurance provider', name: 'provider', value: r.provider, required: true, attrs: { maxlength: 80, placeholder: 'e.g. ICICI Lombard' } }),
        field({ label: 'Policy number (optional)', name: 'policy_number', value: r.policy_number, attrs: { maxlength: 60, autocomplete: 'off' } }),
        field({ label: 'Premium amount (₹)', name: 'premium_amount', type: 'number', value: r.premium_amount ?? '', required: true, attrs: { min: 0, step: '0.01', inputmode: 'decimal' }, hint: 'Added to expenses as "Insurance".' }),
        field({ label: 'Policy start date', name: 'policy_start_date', type: 'date', value: r.policy_start_date || todayISO(), required: true }),
        field({ label: 'Expiry date', name: 'expiry_date', type: 'date', value: r.expiry_date, required: true, hint: 'Filled in as 1 year from the start date — change it if needed.' }),
        field({ label: 'Notes', name: 'notes', type: 'textarea', value: r.notes, full: true }));
      const f = form.elements;
      const suggestExpiry = () => {
        const start = parseISODate(f.policy_start_date.value);
        if (!start || (record && f.expiry_date.value)) return;
        f.expiry_date.value = toISODate(new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1));
      };
      f.policy_start_date.addEventListener('change', suggestExpiry);
      if (!f.expiry_date.value) suggestExpiry();
    },
    async submit(form) {
      const f = form.elements;
      const errors = compact({
        vehicle_id: f.vehicle_id.value ? null : 'Choose a vehicle.',
        provider: f.provider.value.trim() ? null : 'Provider is required.',
        premium_amount: validateAmount(f.premium_amount.value, { allowZero: true, label: 'Premium' }),
        policy_start_date: validateDate(f.policy_start_date.value, { allowFuture: true, label: 'Start date' }),
        expiry_date: validateDate(f.expiry_date.value, { allowFuture: true, label: 'Expiry date' })
          || (f.expiry_date.value <= f.policy_start_date.value ? 'Expiry must be after the start date.' : null),
      });
      if (!showErrors(form, errors)) return false;
      const values = {
        vehicle_id: f.vehicle_id.value,
        provider: f.provider.value.trim(),
        policy_number: emptyToNull(f.policy_number.value),
        premium_amount: toNumber(f.premium_amount.value),
        policy_start_date: f.policy_start_date.value,
        expiry_date: f.expiry_date.value,
        notes: emptyToNull(f.notes.value),
      };
      const saved = await insuranceApi.save(values, record?.id);
      toast(record ? 'Insurance policy updated.' : 'Insurance policy saved.');
      return saved;
    },
  });
}

// =====================================================================
// Edit / delete any expense row, routed to the module that owns it
// =====================================================================
export function editExpenseRow(expense, data) {
  switch (expense.source) {
    case 'fuel': {
      const log = data.fuelLogs.find((l) => l.expense_id === expense.id);
      return log ? openFuelForm({ log, data }) : Promise.resolve(null);
    }
    case 'maintenance': {
      const record = data.maintenance.find((m) => m.expense_id === expense.id);
      return record ? openMaintenanceForm({ record, data }) : Promise.resolve(null);
    }
    case 'insurance': {
      const record = data.insurance.find((i) => i.expense_id === expense.id);
      return record ? openInsuranceForm({ record, data }) : Promise.resolve(null);
    }
    default:
      return openExpenseForm({ expense, data });
  }
}

/** Confirms, then deletes. Returns true if something was deleted. */
export async function deleteExpenseRow(expense, data) {
  const linked = {
    fuel: ['fuel entry', () => data.fuelLogs.find((l) => l.expense_id === expense.id), fuelApi],
    maintenance: ['service record', () => data.maintenance.find((m) => m.expense_id === expense.id), maintenanceApi],
    insurance: ['insurance policy', () => data.insurance.find((i) => i.expense_id === expense.id), insuranceApi],
  }[expense.source];

  const ok = await confirmDialog({
    title: 'Delete this record?',
    message: `"${expense.description}" (${formatINR(num(expense.amount))} on ${formatDate(expense.expense_date)}) will be permanently deleted${linked ? ` together with its ${linked[0]}` : ''}. This cannot be undone.`,
  });
  if (!ok) return false;
  try {
    const record = linked?.[1]();
    if (linked && record) await linked[2].remove(record.id); // trigger removes the expense too
    else await expensesApi.remove(expense.id);
    if (expense.receipt_url) deleteReceipt(expense.receipt_url).catch(() => {});
    toast('Record deleted.');
    return true;
  } catch (error) {
    toast(error.message, 'error');
    return false;
  }
}

/** Generic confirm + delete for module records (fuel, maintenance, insurance, vehicle). */
export async function confirmDelete({ title, message, remove, successText = 'Deleted.' }) {
  const ok = await confirmDialog({ title, message });
  if (!ok) return false;
  try {
    await remove();
    toast(successText);
    return true;
  } catch (error) {
    toast(error.message, 'error');
    return false;
  }
}

