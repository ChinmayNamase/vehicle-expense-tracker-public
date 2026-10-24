// All vehicle calculations live here as small pure functions.
// They never touch the DOM or the database, so they are easy to test
// (see tests/calculations.test.mjs) and easy to explain in a viva.
//
// Golden rules
//  1. Money totals come from `expenses` only (fuel purchases are already
//     there as category 'Petrol'), so nothing is counted twice.
//  2. Fuel statistics (litres, km/L, price per litre) come from `fuel_logs` only.
//  3. Results are full precision. Rounding happens only when displaying.
//  4. Any calculation that would divide by zero or use bad data returns null,
//     and the UI shows "—" instead of a made-up number.

export const PURCHASE_CATEGORY = 'Bike/Car Purchase';
export const FUEL_CATEGORY = 'Petrol';

/** Safe number conversion: returns null for empty / non-numeric values. */
export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const isPositive = (value) => num(value) !== null && num(value) > 0;

/** a ÷ b, or null when b is zero/missing (never Infinity or NaN). */
export function safeDivide(a, b) {
  const x = num(a);
  const y = num(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
}

export function sum(values) {
  return values.reduce((total, value) => total + (num(value) ?? 0), 0);
}

// ---------------------------------------------------------------------
// Petrol litres
// Petrol Litres = Amount Paid ÷ Petrol Price per Litre
// e.g. ₹658.00 ÷ ₹104.00/L = 6.3269… L (shown as 6.33 L)
// ---------------------------------------------------------------------
export function calculateLitres(amountPaid, pricePerLitre) {
  if (!isPositive(amountPaid) || !isPositive(pricePerLitre)) return null;
  return num(amountPaid) / num(pricePerLitre);
}

/**
 * Chooses which litres value to save.
 * If the user typed litres from the pump receipt (manualLitres > 0) that value
 * wins, because the pump meter is more accurate than amount ÷ price (the pump
 * rounds the rupee amount). Otherwise litres are calculated.
 */
export function resolveLitres({ amountPaid, pricePerLitre, manualLitres, useManual }) {
  const calculated = calculateLitres(amountPaid, pricePerLitre);
  if (useManual && isPositive(manualLitres)) {
    return { litres: num(manualLitres), isManual: true, calculated };
  }
  return { litres: calculated, isManual: false, calculated };
}

// ---------------------------------------------------------------------
// Distance, efficiency, cost per km
// ---------------------------------------------------------------------

/**
 * Distance Travelled = Current Odometer − Previous Odometer.
 * Returns null (never a negative number) if either reading is missing
 * or the current reading is lower than the previous one.
 */
export function distanceTravelled(previousReading, currentReading) {
  const prev = num(previousReading);
  const curr = num(currentReading);
  if (prev === null || curr === null || curr < prev) return null;
  return curr - prev;
}

/** Fuel Efficiency (km/L) = Distance ÷ Litres. Null for invalid data. */
export function fuelEfficiency(distance, litres) {
  if (!isPositive(distance) || !isPositive(litres)) return null;
  return num(distance) / num(litres);
}

/** Cost per km = Cost ÷ Distance. Null when distance is zero/unknown. */
export function costPerKm(cost, distance) {
  if (num(cost) === null || !isPositive(distance)) return null;
  return num(cost) / num(distance);
}

/** Weighted average price = total amount paid ÷ total litres. */
export function averagePricePerLitre(fuelLogs) {
  const valid = fuelLogs.filter((log) => isPositive(log.amount_paid) && isPositive(log.litres));
  return safeDivide(sum(valid.map((l) => l.amount_paid)), sum(valid.map((l) => l.litres)));
}

// ---------------------------------------------------------------------
// Fuel timeline: distance between consecutive fuel entries
// ---------------------------------------------------------------------

/** Chronological order: date, then odometer (missing last), then created time. */
export function sortFuelLogs(fuelLogs) {
  return [...fuelLogs].sort((a, b) => {
    if (a.fuel_date !== b.fuel_date) return a.fuel_date < b.fuel_date ? -1 : 1;
    const oa = num(a.odometer_reading);
    const ob = num(b.odometer_reading);
    if (oa !== ob) {
      if (oa === null) return 1;
      if (ob === null) return -1;
      return oa - ob;
    }
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

export function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * For every fuel log, works out the distance since the previous valid reading
 * of the SAME vehicle.
 *
 * status:
 *  'baseline'          first reading of the vehicle — a starting point, NOT distance
 *  'ok'                distance calculated
 *  'no-odometer'       reading missing, skipped
 *  'odometer-decrease' reading lower than the previous one — flagged, not used
 *
 * Cost per km per entry uses the spreadsheet rule:
 *   amount paid at this fill ÷ distance since the previous fill
 *
 * IMPORTANT: build the timeline from ALL logs of a vehicle and filter by date
 * afterwards, otherwise the first entry inside a date range would wrongly
 * become a baseline and its distance would be lost.
 */
export function buildFuelTimeline(fuelLogs) {
  const entries = [];
  for (const logs of groupBy(fuelLogs, (l) => l.vehicle_id).values()) {
    let previous = null; // last valid log with an odometer reading
    for (const log of sortFuelLogs(logs)) {
      const reading = num(log.odometer_reading);
      const entry = { log, distance: null, costPerKm: null, previousReading: previous ? num(previous.odometer_reading) : null, status: 'ok' };
      if (reading === null) {
        entry.status = 'no-odometer';
      } else if (previous === null) {
        entry.status = 'baseline';
        previous = log;
      } else if (reading < num(previous.odometer_reading)) {
        entry.status = 'odometer-decrease';
      } else {
        entry.distance = distanceTravelled(previous.odometer_reading, reading);
        entry.costPerKm = costPerKm(log.amount_paid, entry.distance);
        previous = log;
      }
      entries.push(entry);
    }
  }
  return entries;
}

/** Map of fuel_log.id -> timeline entry, for quick lookup in tables. */
export function timelineById(timeline) {
  return new Map(timeline.map((entry) => [entry.log.id, entry]));
}

export function totalDistance(timelineEntries) {
  return sum(timelineEntries.map((e) => e.distance));
}

// ---------------------------------------------------------------------
// Mileage (km/L)
// ---------------------------------------------------------------------

/**
 * Full-tank method (most reliable).
 * Between two consecutive FULL-TANK fills, the fuel burnt equals all litres
 * added after the first full fill up to and including the second one
 * (partial top-ups in between are included).
 *   km/L = (odometer at 2nd full − odometer at 1st full) ÷ litres added in between
 */
export function fullTankIntervals(fuelLogsOfOneVehicle) {
  const intervals = [];
  let anchor = null; // last full-tank log with a valid odometer
  let litresSinceAnchor = 0;
  let intervalIsClean = true;

  for (const log of sortFuelLogs(fuelLogsOfOneVehicle)) {
    const reading = num(log.odometer_reading);
    if (anchor) {
      litresSinceAnchor += num(log.litres) ?? 0;
      if (reading !== null && reading < num(anchor.odometer_reading)) intervalIsClean = false;
    }
    if (log.is_full_tank && reading !== null) {
      if (anchor && intervalIsClean) {
        const distance = distanceTravelled(anchor.odometer_reading, reading);
        const kmpl = fuelEfficiency(distance, litresSinceAnchor);
        if (kmpl !== null) {
          intervals.push({ vehicleId: log.vehicle_id, fromDate: anchor.fuel_date, toDate: log.fuel_date, distance, litres: litresSinceAnchor, kmpl });
        }
      }
      anchor = log;
      litresSinceAnchor = 0;
      intervalIsClean = true;
    }
  }
  return intervals;
}

/**
 * Estimated method (used when there are fewer than two full-tank fills).
 * Distance = last reading − first reading.
 * Litres   = fuel bought from the first fill up to (not including) the last fill,
 *            because fuel bought at the last fill has not been used yet.
 * This assumes the tank level was roughly the same at the first and last fill,
 * so the result is labelled "Estimated".
 */
export function estimatedMileage(fuelLogsOfOneVehicle) {
  const timeline = buildFuelTimeline(fuelLogsOfOneVehicle);
  const valid = timeline.filter((e) => e.status === 'baseline' || e.status === 'ok');
  if (valid.length < 2) return null;
  const distance = distanceTravelled(valid[0].log.odometer_reading, valid[valid.length - 1].log.odometer_reading);
  const lastLog = valid[valid.length - 1].log;
  const sorted = sortFuelLogs(fuelLogsOfOneVehicle);
  const startIndex = sorted.indexOf(valid[0].log);
  const endIndex = sorted.indexOf(lastLog);
  const litres = sum(sorted.slice(startIndex, endIndex).map((l) => l.litres));
  const kmpl = fuelEfficiency(distance, litres);
  return kmpl === null ? null : { distance, litres, kmpl };
}

/**
 * Mileage summary across one or more vehicles.
 * method: 'full-tank' (reliable) | 'estimated' | null (not enough data)
 */
export function mileageSummary(fuelLogs) {
  let distance = 0;
  let litres = 0;
  let usedEstimate = false;
  const intervals = [];

  for (const logs of groupBy(fuelLogs, (l) => l.vehicle_id).values()) {
    const vehicleIntervals = fullTankIntervals(logs);
    if (vehicleIntervals.length) {
      intervals.push(...vehicleIntervals);
      distance += sum(vehicleIntervals.map((i) => i.distance));
      litres += sum(vehicleIntervals.map((i) => i.litres));
    } else {
      const estimate = estimatedMileage(logs);
      if (estimate) {
        usedEstimate = true;
        distance += estimate.distance;
        litres += estimate.litres;
      }
    }
  }

  const kmpl = fuelEfficiency(distance, litres);
  if (kmpl === null) return { kmpl: null, method: null, intervals, note: 'Not enough fuel entries with odometer readings yet.' };
  return {
    kmpl,
    method: usedEstimate ? 'estimated' : 'full-tank',
    intervals,
    note: usedEstimate
      ? 'Estimated from all fills (no consecutive full-tank fills yet). Mark fills as "Full tank" for an accurate figure.'
      : 'Calculated between consecutive full-tank fills.',
  };
}

// ---------------------------------------------------------------------
// Date filtering and monthly grouping
// ---------------------------------------------------------------------

/** Keeps items whose date (YYYY-MM-DD) is within [from, to]. Nulls = open-ended. */
export function filterByDateRange(items, getDate, from, to) {
  return items.filter((item) => {
    const date = getDate(item);
    if (!date) return false;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}

export const monthKey = (isoDate) => (isoDate ? isoDate.slice(0, 7) : null);

/** Every month key from `fromMonth` to `toMonth` inclusive (fills gaps with 0). */
export function monthsBetween(fromMonth, toMonth) {
  if (!fromMonth || !toMonth || fromMonth > toMonth) return [];
  const months = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (months.length > 600) break; // safety net
  }
  return months;
}

/** Sums valueFn(item) per month. Returns a Map in month order. */
export function sumByMonth(items, getDate, valueFn, months = null) {
  const totals = new Map((months || []).map((m) => [m, 0]));
  for (const item of items) {
    const key = monthKey(getDate(item));
    if (!key || (months && !totals.has(key))) continue;
    totals.set(key, (totals.get(key) ?? 0) + (num(valueFn(item)) ?? 0));
  }
  return new Map([...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function monthlyExpenses(expenses, months) {
  return sumByMonth(expenses, (e) => e.expense_date, (e) => e.amount, months);
}

export function monthlyFuelLitres(fuelLogs, months) {
  return sumByMonth(fuelLogs, (l) => l.fuel_date, (l) => l.litres, months);
}

/** Distance of each interval is credited to the month of the later reading. */
export function monthlyDistance(timelineEntries, months) {
  return sumByMonth(timelineEntries.filter((e) => e.distance !== null), (e) => e.log.fuel_date, (e) => e.distance, months);
}

/**
 * Monthly running distance:
 *  currentMonth  = distance credited to the current calendar month
 *  averagePerMonth = total distance ÷ months between first and last reading
 */
export function monthlyRunningDistance(timelineEntries, today = new Date()) {
  const valid = timelineEntries.filter((e) => e.status === 'baseline' || e.status === 'ok');
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = totalDistance(valid.filter((e) => monthKey(e.log.fuel_date) === thisMonth));
  if (valid.length < 2) return { currentMonth, averagePerMonth: null };
  const dates = valid.map((e) => e.log.fuel_date).sort();
  const days = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000;
  const months = days / 30.4375; // average days per month
  const averagePerMonth = months >= 1 ? safeDivide(totalDistance(valid), months) : null;
  return { currentMonth, averagePerMonth };
}

// ---------------------------------------------------------------------
// Category totals and cost-per-km rules
// ---------------------------------------------------------------------
export function categoryTotals(expenses) {
  const totals = {};
  for (const expense of expenses) {
    totals[expense.category] = (totals[expense.category] ?? 0) + (num(expense.amount) ?? 0);
  }
  return totals;
}

export function totalAmount(expenses) {
  return sum(expenses.map((e) => e.amount));
}

/** Running expenses = everything except buying the vehicle. */
export function runningExpenses(expenses) {
  return expenses.filter((e) => e.category !== PURCHASE_CATEGORY);
}

/**
 * Cost per km over a period.
 *  mode 'fuel'    : fuel (Petrol) expenses ÷ distance
 *  mode 'running' : all running expenses (excludes Bike/Car Purchase) ÷ distance
 */
export function overallCostPerKm(expenses, distance, mode = 'fuel') {
  const relevant = mode === 'fuel'
    ? expenses.filter((e) => e.category === FUEL_CATEGORY)
    : runningExpenses(expenses);
  return costPerKm(totalAmount(relevant), distance);
}

export const COST_PER_KM_RULES = {
  fuel: 'Fuel expenses ÷ distance travelled in the selected period.',
  running: 'All running expenses (fuel, servicing, parts, insurance, repairs, tolls…, excluding the vehicle purchase) ÷ distance travelled in the selected period.',
};

/**
 * Purchase cost of a vehicle: uses 'Bike/Car Purchase' expenses if any exist,
 * otherwise the purchase price saved on the vehicle (never both, to avoid
 * double counting).
 */
export function purchaseCost(vehicle, expensesOfVehicle) {
  const fromExpenses = totalAmount(expensesOfVehicle.filter((e) => e.category === PURCHASE_CATEGORY));
  if (fromExpenses > 0) return fromExpenses;
  return num(vehicle?.purchase_price) ?? 0;
}

/** Total cost of ownership = purchase cost + running expenses. */
export function ownershipCost(vehicle, expensesOfVehicle) {
  return purchaseCost(vehicle, expensesOfVehicle) + totalAmount(runningExpenses(expensesOfVehicle));
}

// ---------------------------------------------------------------------
// One-stop summary used by the dashboard, vehicle panel and fuel page
// ---------------------------------------------------------------------
export function buildSummary({ expenses, fuelLogs, from = null, to = null, costMode = 'fuel' }) {
  const timeline = buildFuelTimeline(fuelLogs); // full history first…
  const periodTimeline = filterByDateRange(timeline, (e) => e.log.fuel_date, from, to); // …then filter
  const periodFuel = filterByDateRange(fuelLogs, (l) => l.fuel_date, from, to);
  const periodExpenses = filterByDateRange(expenses, (e) => e.expense_date, from, to);
  const byCategory = categoryTotals(periodExpenses);
  const distance = totalDistance(periodTimeline);

  return {
    periodExpenses,
    periodFuel,
    periodTimeline,
    timeline,
    byCategory,
    totalExpenses: totalAmount(periodExpenses),
    runningTotal: totalAmount(runningExpenses(periodExpenses)),
    purchaseTotal: byCategory[PURCHASE_CATEGORY] ?? 0,
    petrolExpenses: byCategory[FUEL_CATEGORY] ?? 0,
    servicingExpenses: byCategory.Servicing ?? 0,
    insuranceExpenses: byCategory.Insurance ?? 0,
    litres: sum(periodFuel.map((l) => l.litres)),
    distance,
    averagePrice: averagePricePerLitre(periodFuel),
    mileage: mileageSummary(periodFuel.length ? filterLogsForMileage(fuelLogs, from, to) : []),
    costPerKm: overallCostPerKm(periodExpenses, distance, costMode),
    costMode,
  };
}

/**
 * For mileage in a date range we also need the full-tank fill just BEFORE
 * the range (the starting anchor), otherwise the first interval is lost.
 */
function filterLogsForMileage(fuelLogs, from, to) {
  if (!from) return filterByDateRange(fuelLogs, (l) => l.fuel_date, null, to);
  const result = [];
  for (const logs of groupBy(fuelLogs, (l) => l.vehicle_id).values()) {
    const sorted = sortFuelLogs(logs);
    const before = sorted.filter((l) => l.fuel_date < from);
    const lastFullBefore = [...before].reverse().find((l) => l.is_full_tank && num(l.odometer_reading) !== null);
    const lastAnyBefore = [...before].reverse().find((l) => num(l.odometer_reading) !== null);
    const anchor = lastFullBefore || lastAnyBefore;
    // Include the anchor and every fill after it (top-ups between the anchor
    // and the range start are part of the first interval's litres).
    const startIndex = anchor ? sorted.indexOf(anchor) : sorted.findIndex((l) => l.fuel_date >= from);
    if (startIndex === -1) continue;
    result.push(...sorted.slice(startIndex).filter((l) => !to || l.fuel_date <= to));
  }
  return result;
}
