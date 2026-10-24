// Shared helpers: formatting, safe DOM building, dialogs, toasts, CSV, pagination.
// Nothing in this file talks to the database.

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
export const EXPENSE_CATEGORIES = [
  'Bike/Car Purchase', 'Petrol', 'Servicing', 'Spare Parts', 'Insurance',
  'Repairs', 'Accessories', 'Parking and Tolls', 'Other',
];

export const CATEGORY_COLORS = {
  'Bike/Car Purchase': '#64748b',
  Petrol: '#16a34a',
  Servicing: '#2563eb',
  'Spare Parts': '#7c3aed',
  Insurance: '#0891b2',
  Repairs: '#dc2626',
  Accessories: '#d97706',
  'Parking and Tolls': '#db2777',
  Other: '#94a3b8',
};

export const FUEL_TYPES = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG'];

// ---------------------------------------------------------------------
// Number & currency formatting (Indian numbering: 1,23,456.00)
// Rounding happens ONLY here, for display. Calculations keep full precision.
// ---------------------------------------------------------------------
const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export const DASH = '—';

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatINR(value) {
  return isFiniteNumber(value) ? inrFormatter.format(value) : DASH;
}

export function formatNumber(value, digits = 2) {
  if (!isFiniteNumber(value)) return DASH;
  return value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const formatKm = (value, digits = 1) => (isFiniteNumber(value) ? `${formatNumber(value, digits)} km` : DASH);
export const formatLitres = (value) => (isFiniteNumber(value) ? `${formatNumber(value, 2)} L` : DASH);
export const formatKmpl = (value) => (isFiniteNumber(value) ? `${formatNumber(value, 2)} km/L` : DASH);
export const formatPerKm = (value) => (isFiniteNumber(value) ? `${formatINR(value)}/km` : DASH);

/** Converts form/DB input to a number, or null when empty/invalid. */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (cleaned === '') return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

/** Empty strings become null so optional DB columns stay NULL. */
export function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------
// Dates. The app stores plain dates as 'YYYY-MM-DD' strings; comparing
// these strings alphabetically is the same as comparing the dates.
// ---------------------------------------------------------------------
export function parseISODate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const todayISO = () => toISODate(new Date());

export function formatDate(iso) {
  const date = parseISODate(iso);
  return date ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : DASH;
}

export function formatMonthYear(value) {
  if (!value || !/^\d{4}-\d{2}/.test(value)) return DASH;
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/** Whole days from today until the given ISO date (negative = past). */
export function daysUntil(iso) {
  const date = parseISODate(iso);
  if (!date) return null;
  const today = parseISODate(todayISO());
  return Math.round((date - today) / 86400000);
}

/** Returns {from, to} ISO dates for a named preset ('all' returns nulls). */
export function presetRange(preset) {
  const now = new Date();
  const to = todayISO();
  const startOfMonthsAgo = (n) => toISODate(new Date(now.getFullYear(), now.getMonth() - n, 1));
  switch (preset) {
    case 'this-month': return { from: startOfMonthsAgo(0), to };
    case 'last-3': return { from: startOfMonthsAgo(2), to };
    case 'last-6': return { from: startOfMonthsAgo(5), to };
    case 'last-12': return { from: startOfMonthsAgo(11), to };
    case 'this-year': return { from: `${now.getFullYear()}-01-01`, to };
    default: return { from: null, to: null };
  }
}

// ---------------------------------------------------------------------
// Safe DOM building. Text is always set with textContent / createTextNode,
// never innerHTML, so user data cannot inject HTML or scripts (XSS).
// ---------------------------------------------------------------------
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) {
        if (val !== undefined && val !== null) element.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), val);
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (['value', 'checked', 'selected', 'disabled', 'hidden', 'required', 'multiple'].includes(key)) element[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(element, children);
  return element;
}

function appendChildren(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Lucide icon placeholder; call refreshIcons() after inserting into the page. */
export function icon(name, extraClass = '') {
  return h('i', { 'data-lucide': name, class: `icon ${extraClass}`.trim(), 'aria-hidden': 'true' });
}

export function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

export function clear(element) {
  element.replaceChildren();
  return element;
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ---------------------------------------------------------------------
// Feedback: loading, toasts, empty states
// ---------------------------------------------------------------------
export function loadingBlock(text = 'Loading…') {
  return h('div', { class: 'loading-block', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function setButtonLoading(button, isLoading, loadingText = 'Saving…') {
  if (!button) return;
  if (isLoading) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.replaceChildren(h('span', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), loadingText);
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

function toastRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = h('div', { id: 'toast-region', class: 'toast-region', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(region);
  }
  return region;
}

export function toast(message, type = 'success', timeout = 4000) {
  const iconName = { success: 'check-circle-2', error: 'alert-circle', info: 'info', warning: 'alert-triangle' }[type] || 'info';
  const item = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(iconName), h('span', {}, message),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => item.remove() }, '×'));
  toastRegion().append(item);
  refreshIcons();
  setTimeout(() => item.remove(), timeout);
}

export function emptyState({ iconName = 'inbox', title, text, action }) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-icon' }, icon(iconName)),
    h('h3', {}, title),
    text ? h('p', {}, text) : null,
    action || null);
}

export function alertBox(message, type = 'info') {
  const iconName = { info: 'info', warning: 'alert-triangle', error: 'alert-circle', success: 'check-circle-2' }[type];
  return h('div', { class: `alert alert-${type}`, role: type === 'error' ? 'alert' : null }, icon(iconName), h('div', {}, message));
}

// ---------------------------------------------------------------------
// Dialogs (native <dialog>: focus trapping and Esc-to-close for free)
// ---------------------------------------------------------------------
/**
 * Creates a modal dialog. `close(value)` closes it and calls onClose(value)
 * exactly once — also when the user presses Esc.
 */
export function createDialog({ title, size = 'md', onClose = null }) {
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  const body = h('div', { class: 'dialog-body' });
  const footer = h('div', { class: 'dialog-footer' });
  let finished = false;
  const finish = (value) => {
    if (finished) return;
    finished = true;
    onClose?.(value);
    setTimeout(() => dialog.remove(), 0);
  };
  const close = (value = 'cancel') => {
    if (dialog.open) dialog.close(value);
    finish(value);
  };
  const dialog = h('dialog', { class: `dialog dialog-${size}`, 'aria-labelledby': titleId },
    h('div', { class: 'dialog-header' },
      h('h2', { id: titleId }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close dialog', onclick: () => close('cancel') }, icon('x'))),
    body, footer);
  dialog.addEventListener('close', () => finish(dialog.returnValue || 'cancel')); // Esc key
  document.body.append(dialog);
  return { dialog, body, footer, close, open: () => { dialog.showModal(); refreshIcons(); } };
}

/** Promise-based confirmation dialog. Resolves true only if confirmed. */
export function confirmDialog({ title = 'Are you sure?', message, confirmText = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const { body, footer, open, close } = createDialog({ title, size: 'sm', onClose: (value) => resolve(value === 'confirm') });
    body.append(h('p', { class: 'confirm-message' }, message));
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close('cancel') }, 'Cancel');
    const confirm = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close('confirm') }, confirmText);
    footer.append(cancel, confirm);
    open();
    cancel.focus();
  });
}

// ---------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------
export function paginate(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: current, totalPages, start, total: items.length };
}

export function paginationControls({ page, totalPages, total, start, pageSize }, onChange) {
  const end = Math.min(start + pageSize, total);
  return h('nav', { class: 'pagination', 'aria-label': 'Pagination' },
    h('span', { class: 'muted' }, total ? `Showing ${start + 1}–${end} of ${total}` : 'No records'),
    h('div', { class: 'pagination-buttons' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: page <= 1, onclick: () => onChange(page - 1) }, 'Previous'),
      h('span', { class: 'page-indicator' }, `Page ${page} of ${totalPages}`),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: page >= totalPages, onclick: () => onChange(page + 1) }, 'Next')));
}

// ---------------------------------------------------------------------
// CSV export / parsing
// ---------------------------------------------------------------------
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Prevent spreadsheet formula injection for text cells (e.g. "=HYPERLINK(...)")
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** columns: [{ header, value: row => any }] */
export function toCSV(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return lines.join('\r\n');
}

export function downloadCSV(filename, csvText) {
  // BOM so Excel opens ₹ and other UTF-8 characters correctly
  const blob = new Blob(['﻿', csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** RFC 4180-style CSV parser (handles quotes, commas and newlines in cells). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------------------------------------------------------------------
// Small persisted UI preferences (selected vehicle etc.)
// ---------------------------------------------------------------------
export function getPreference(key, fallback = null) {
  try {
    return localStorage.getItem(`vet.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setPreference(key, value) {
  try {
    localStorage.setItem(`vet.${key}`, value);
  } catch {
    /* storage unavailable (private mode) — preference just isn't remembered */
  }
}

export function vehicleName(vehicle) {
  return vehicle ? `${vehicle.make} ${vehicle.model}` : 'Unknown vehicle';
}

export function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}
