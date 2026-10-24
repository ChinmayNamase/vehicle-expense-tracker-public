// Google Sheets CSV import: column detection, row parsing and validation.
// Pure functions (no DOM, no database) so they can be unit tested.
import { calculateLitres, num } from './calculations.js';

const HEADER_ALIASES = {
  date: ['date', 'expense date', 'fuel date', 'transaction date'],
  description: ['description', 'desc', 'particulars', 'details', 'item'],
  amount: ['amount', 'amount paid', 'amount rs', 'amount inr', 'cost', 'price paid'],
  price: ['petrol price', 'price', 'price per litre', 'price per liter', 'rate', 'petrol rate', 'fuel price', 'price/l', 'price per l'],
  litres: ['petrol litres', 'petrol liters', 'litres', 'liters', 'petrol', 'fuel litres', 'quantity', 'qty', 'petrol l'],
  category: ['category', 'type', 'expense type'],
  odometer: ['odometer', 'odometer reading', 'odo', 'km reading', 'reading', 'odometer km'],
  fullTank: ['full tank', 'full', 'is full tank', 'tank full'],
  station: ['fuel station', 'station', 'pump', 'petrol pump'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
};

/** Spreadsheet columns that are calculated summaries, never imported. */
export const IGNORED_COLUMNS = ['difference', 'cost per km', 'total expenses', 'monthly fuel expenses', 'vehicle details', 'average km/l', 'average kml', 'distance', 'distance travelled'];

export function normalizeHeader(text) {
  return String(text || '').toLowerCase()
    .replace(/₹|\(rs\.?\)|\(inr\)/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns { field: columnIndex } for the recognised columns of a header row. */
export function mapHeaders(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    if (!name || IGNORED_COLUMNS.includes(name)) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (mapping[field] === undefined && aliases.includes(name)) {
        mapping[field] = index;
        return;
      }
    }
  });
  return mapping;
}

/** Finds the header row (sheets often have title rows above it). */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const mapping = mapHeaders(rows[i]);
    if (mapping.date !== undefined && mapping.amount !== undefined) return { index: i, mapping };
  }
  return null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const monthNumber = (name) => MONTHS[name.toLowerCase().slice(0, 3)] ?? null;

function isoIfValid(y, m, d) {
  if (y < 100) y += 2000;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (y < 1980 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parses spreadsheet dates. `format` decides numeric dates:
 * 'dmy' (15/10/2026, Indian default), 'mdy' (10/15/2026) or 'ymd' (2026-10-15).
 * Dates with month names ("15-Oct-2026", "15 October 2026") always work.
 */
export function parseSheetDate(value, format = 'dmy') {
  const text = String(value || '').trim();
  if (!text) return null;
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return isoIfValid(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})$/);
  if (match && monthNumber(match[2])) return isoIfValid(+match[3], monthNumber(match[2]), +match[1]);
  match = text.match(/^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})$/);
  if (match && monthNumber(match[1])) return isoIfValid(+match[3], monthNumber(match[1]), +match[2]);
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (match) {
    const [a, b, y] = [+match[1], +match[2], +match[3]];
    return format === 'mdy' ? isoIfValid(y, a, b) : isoIfValid(y, b, a);
  }
  return null;
}

/** "₹1,23,456.50" / "Rs. 658" / "658.00" -> number; "", "-" -> null */
export function parseSheetNumber(value) {
  const text = String(value ?? '').replace(/₹|rs\.?|inr|km|litres?|liters?|\/l|,|\s/gi, '').trim();
  if (text === '' || text === '-' || text === '—') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

export function mapCategory(raw, hasFuelData) {
  const text = String(raw || '').toLowerCase();
  if (!text) return hasFuelData ? 'Petrol' : 'Other';
  if (/petrol|fuel|diesel|cng/.test(text)) return 'Petrol';
  if (/insur/.test(text)) return 'Insurance';
  if (/spare|part/.test(text)) return 'Spare Parts';
  if (/servic/.test(text)) return 'Servicing';
  if (/repair/.test(text)) return 'Repairs';
  if (/access/.test(text)) return 'Accessories';
  if (/park|toll|fastag/.test(text)) return 'Parking and Tolls';
  if (/purchase|bought|showroom|on.?road/.test(text)) return 'Bike/Car Purchase';
  return 'Other';
}

const truthy = (value) => /^(y|yes|true|1|full|✓|x)$/i.test(String(value || '').trim());
const normalizeText = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function duplicateKey(date, amount, description) {
  return `${date}|${Number(amount).toFixed(2)}|${normalizeText(description)}`;
}

/** Keys of the vehicle's existing expenses, to stop duplicate imports. */
export function existingKeys(expenses, vehicleId) {
  return new Set(expenses.filter((e) => e.vehicle_id === vehicleId).map((e) => duplicateKey(e.expense_date, num(e.amount), e.description)));
}

/**
 * Validates every data row. Returns items:
 *  { rowNumber, status: 'valid'|'invalid'|'duplicate'|'skipped', reasons[], warnings[], kind, record, preview }
 */
export function validateImport(rows, { format = 'dmy', existing = new Set(), today = new Date().toISOString().slice(0, 10) } = {}) {
  const header = findHeaderRow(rows);
  if (!header) {
    return { error: 'Could not find a header row with at least "Date" and "Amount" columns.', items: [], mapping: {} };
  }
  const { index: headerIndex, mapping } = header;
  const get = (row, field) => (mapping[field] === undefined ? '' : String(row[mapping[field]] ?? '').trim());
  const seen = new Set();
  const items = [];

  rows.slice(headerIndex + 1).forEach((row, i) => {
    const rowNumber = headerIndex + i + 2; // 1-based line number in the file
    const rawDate = get(row, 'date');
    const description = get(row, 'description');
    const amount = parseSheetNumber(get(row, 'amount'));
    const price = parseSheetNumber(get(row, 'price'));
    const litresGiven = parseSheetNumber(get(row, 'litres'));
    const odometer = parseSheetNumber(get(row, 'odometer'));
    const date = parseSheetDate(rawDate, format);
    const reasons = [];
    const warnings = [];

    const preview = { date: rawDate, description, amount: get(row, 'amount'), price: get(row, 'price'), litres: get(row, 'litres'), category: get(row, 'category'), odometer: get(row, 'odometer') };

    // Rows without a real date are summary/total/blank rows, not transactions
    if (!date) {
      const looksLikeData = rawDate !== '' && amount !== null;
      items.push({ rowNumber, status: looksLikeData ? 'invalid' : 'skipped', reasons: [looksLikeData ? `Unrecognised date "${rawDate}"` : 'No date — summary or blank row, not a transaction'], warnings, preview });
      return;
    }
    if (date > today) reasons.push('Date is in the future');
    if (amount === null) reasons.push('Amount is missing');
    else if (Number.isNaN(amount)) reasons.push('Amount is not a number');
    else if (amount <= 0) reasons.push('Amount must be greater than 0');

    const hasFuelData = (price !== null && !Number.isNaN(price)) || (litresGiven !== null && !Number.isNaN(litresGiven));
    const category = mapCategory(get(row, 'category'), hasFuelData);
    if (get(row, 'category') && category === 'Other' && !/other|misc/i.test(get(row, 'category'))) {
      warnings.push(`Category "${get(row, 'category')}" mapped to Other`);
    }
    if (odometer !== null && (Number.isNaN(odometer) || odometer < 0)) reasons.push('Odometer is not a valid number');

    let record;
    let kind = 'expense';
    if (category === 'Petrol') {
      kind = 'fuel';
      if (price !== null && (Number.isNaN(price) || price <= 0)) reasons.push('Petrol price is not valid');
      if (litresGiven !== null && (Number.isNaN(litresGiven) || litresGiven <= 0)) reasons.push('Petrol litres is not valid');
      const usableLitres = litresGiven > 0 ? litresGiven : null;
      let pricePerLitre = price > 0 ? price : null;
      let litres = usableLitres ?? calculateLitres(amount, pricePerLitre);
      if (!pricePerLitre && usableLitres && amount > 0) pricePerLitre = amount / usableLitres; // derive price from litres
      if (!litres || !pricePerLitre) reasons.push('Petrol rows need a Petrol Price or Petrol (Litres) value');
      if (usableLitres && price > 0 && amount > 0 && Math.abs(amount / usableLitres - price) / price > 0.05) {
        warnings.push('Litres do not match Amount ÷ Price; the litres column will be used');
      }
      if (odometer === null) warnings.push('No odometer — distance and mileage cannot use this row');
      litres = litres ? Math.round(litres * 1000) / 1000 : litres;
      record = {
        fuel_date: date,
        description: description || 'Petrol',
        fuel_station: get(row, 'station') || null,
        amount_paid: amount,
        price_per_litre: pricePerLitre ? Math.round(pricePerLitre * 100) / 100 : null,
        litres,
        litres_is_manual: Boolean(usableLitres),
        odometer_reading: odometer === null || Number.isNaN(odometer) ? null : odometer,
        is_full_tank: truthy(get(row, 'fullTank')),
        notes: get(row, 'notes') || null,
      };
    } else {
      record = {
        expense_date: date,
        description: description || category,
        amount,
        category,
        notes: [get(row, 'notes'), odometer > 0 ? `Odometer: ${odometer} km` : ''].filter(Boolean).join(' · ') || null,
      };
    }
    if ((description || '').length > 120) reasons.push('Description is longer than 120 characters');

    let status = reasons.length ? 'invalid' : 'valid';
    if (status === 'valid') {
      const key = duplicateKey(date, amount, record.description);
      if (existing.has(key)) {
        status = 'duplicate';
        reasons.push('Already exists for this vehicle');
      } else if (seen.has(key)) {
        status = 'duplicate';
        reasons.push('Repeated earlier in this file');
      }
      seen.add(key);
    }
    items.push({ rowNumber, status, reasons, warnings, kind, record, category, preview });
  });

  // Odometer sanity check across the file's fuel rows (in date order)
  const fuelItems = items.filter((it) => it.status === 'valid' && it.kind === 'fuel' && it.record.odometer_reading !== null)
    .sort((a, b) => (a.record.fuel_date < b.record.fuel_date ? -1 : a.record.fuel_date > b.record.fuel_date ? 1 : a.rowNumber - b.rowNumber));
  for (let i = 1; i < fuelItems.length; i += 1) {
    if (fuelItems[i].record.odometer_reading < fuelItems[i - 1].record.odometer_reading) {
      fuelItems[i].warnings.push(`Odometer lower than the previous fuel row (${fuelItems[i - 1].record.odometer_reading} km) — will be flagged`);
    }
  }

  return { items, mapping, headerIndex };
}
