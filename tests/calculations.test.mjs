// Unit tests for the calculation and import rules. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateLitres, resolveLitres, distanceTravelled, fuelEfficiency, costPerKm, averagePricePerLitre,
  buildFuelTimeline, fullTankIntervals, mileageSummary, monthsBetween, monthlyExpenses, categoryTotals,
  overallCostPerKm, purchaseCost, ownershipCost, buildSummary, filterByDateRange, monthlyRunningDistance,
} from '../js/calculations.js';
import { parseSheetDate, parseSheetNumber, mapCategory, validateImport, duplicateKey } from '../js/importer.js';

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);
const log = (id, date, amount, price, litres, odo, full = false, vehicle = 'v1') => ({
  id, vehicle_id: vehicle, fuel_date: date, amount_paid: amount, price_per_litre: price, litres, odometer_reading: odo, is_full_tank: full, created_at: `${date}T00:00:0${id.length}`,
});

test('petrol litres = amount ÷ price (₹658 ÷ ₹104 = 6.33 L)', () => {
  close(calculateLitres(658, 104), 6.326923076923077);
  assert.equal(calculateLitres(658, 104).toFixed(2), '6.33');
  assert.equal(calculateLitres(658, 0), null, 'no division by zero');
  assert.equal(calculateLitres(-5, 100), null, 'no negatives');
  assert.equal(calculateLitres('', 100), null);
});

test('manual litres override calculated litres only when valid', () => {
  assert.deepEqual(resolveLitres({ amountPaid: 658, pricePerLitre: 104, manualLitres: 6.31, useManual: true }).litres, 6.31);
  assert.equal(resolveLitres({ amountPaid: 658, pricePerLitre: 104, manualLitres: 6.31, useManual: false }).isManual, false);
  assert.equal(resolveLitres({ amountPaid: 658, pricePerLitre: 104, manualLitres: 0, useManual: true }).isManual, false);
});

test('distance = current − previous, never negative', () => {
  close(distanceTravelled(185, 348.2), 163.2, 1e-9);
  assert.equal(distanceTravelled(348.2, 185), null);
  assert.equal(distanceTravelled(null, 185), null);
});

test('efficiency and cost per km guard against zero', () => {
  assert.equal(fuelEfficiency(0, 5), null);
  assert.equal(fuelEfficiency(100, 0), null);
  close(fuelEfficiency(163.2, 6.33), 163.2 / 6.33);
  assert.equal(costPerKm(500, 0), null);
  close(costPerKm(658, 163.2), 658 / 163.2);
});

test('average price is weighted by litres', () => {
  close(averagePricePerLitre([{ amount_paid: 100, litres: 1 }, { amount_paid: 300, litres: 2 }]), 400 / 3);
  assert.equal(averagePricePerLitre([]), null);
});

test('timeline: first reading is a baseline, decreases are flagged', () => {
  const t = buildFuelTimeline([
    log('a', '2026-01-06', 500, 104, 4.8, 185),
    log('b', '2026-01-20', 658, 104, 6.33, 348.2),
    log('c', '2026-02-01', 600, 104, 5.77, 300), // typo: lower than previous
    log('d', '2026-02-10', 600, 104, 5.77, 520),
    log('e', '2026-02-15', 300, 100, 3, null),
  ]);
  assert.equal(t[0].status, 'baseline');
  assert.equal(t[0].distance, null);
  close(t[1].distance, 163.2, 1e-9);
  assert.equal(t[2].status, 'odometer-decrease');
  assert.equal(t[2].distance, null);
  close(t[3].distance, 520 - 348.2, 1e-9); // measured from the last VALID reading
  assert.equal(t[4].status, 'no-odometer');
});

test('timeline is calculated separately per vehicle', () => {
  const t = buildFuelTimeline([log('a', '2026-01-01', 100, 100, 1, 1000, false, 'car'), log('b', '2026-01-02', 100, 100, 1, 50, false, 'bike'), log('c', '2026-01-03', 100, 100, 1, 1100, false, 'car')]);
  assert.equal(t.find((e) => e.log.id === 'b').status, 'baseline');
  assert.equal(t.find((e) => e.log.id === 'c').distance, 100);
});

test('full-tank mileage includes partial top-ups between full fills', () => {
  const logs = [
    log('a', '2026-01-01', 500, 100, 5, 1000, true),
    log('b', '2026-01-05', 200, 100, 2, 1100, false),
    log('c', '2026-01-10', 300, 100, 3, 1250, true),
  ];
  const intervals = fullTankIntervals(logs);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].distance, 250);
  assert.equal(intervals[0].litres, 5); // 2 + 3 (not the first fill's 5)
  assert.equal(intervals[0].kmpl, 50);
  assert.equal(mileageSummary(logs).method, 'full-tank');
});

test('mileage is estimated (and labelled) without two full-tank fills', () => {
  const logs = [log('a', '2026-01-01', 500, 100, 5, 1000), log('b', '2026-01-10', 400, 100, 4, 1200), log('c', '2026-01-20', 300, 100, 3, 1380)];
  const summary = mileageSummary(logs);
  assert.equal(summary.method, 'estimated');
  close(summary.kmpl, 380 / 9); // last fill's 3 L not yet used
  assert.equal(mileageSummary([log('a', '2026-01-01', 500, 100, 5, 1000)]).kmpl, null);
});

test('date range filtering keeps distance of the first entry in range', () => {
  const logs = [log('a', '2026-01-01', 500, 100, 5, 1000, true), log('b', '2026-02-01', 500, 100, 5, 1200, true)];
  const s = buildSummary({ expenses: [], fuelLogs: logs, from: '2026-02-01', to: '2026-02-28' });
  assert.equal(s.distance, 200);
  assert.equal(s.mileage.kmpl, 40);
  assert.equal(s.mileage.method, 'full-tank');
});

test('monthly grouping fills empty months with zero', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  const m = monthlyExpenses([{ expense_date: '2025-11-03', amount: 100 }, { expense_date: '2026-01-09', amount: 50 }, { expense_date: '2026-01-10', amount: 25 }], monthsBetween('2025-11', '2026-01'));
  assert.deepEqual([...m.values()], [100, 0, 75]);
  assert.equal(filterByDateRange([{ d: '2026-01-01' }, { d: '2026-03-01' }], (x) => x.d, '2026-02-01', null).length, 1);
});

test('cost per km modes and purchase handling avoid double counting', () => {
  const expenses = [
    { category: 'Bike/Car Purchase', amount: 90000 }, { category: 'Petrol', amount: 600 }, { category: 'Servicing', amount: 400 },
  ];
  assert.deepEqual(categoryTotals(expenses), { 'Bike/Car Purchase': 90000, Petrol: 600, Servicing: 400 });
  assert.equal(overallCostPerKm(expenses, 200, 'fuel'), 3);
  assert.equal(overallCostPerKm(expenses, 200, 'running'), 5); // purchase excluded
  assert.equal(purchaseCost({ purchase_price: 85000 }, expenses), 90000); // expense wins, not both
  assert.equal(purchaseCost({ purchase_price: 85000 }, expenses.slice(1)), 85000);
  assert.equal(ownershipCost({ purchase_price: 85000 }, expenses), 91000);
});

test('monthly running distance', () => {
  const t = buildFuelTimeline([log('a', '2026-01-01', 1, 1, 1, 0), log('b', '2026-03-02', 1, 1, 1, 1200)]);
  const r = monthlyRunningDistance(t, new Date(2026, 2, 15));
  assert.equal(r.currentMonth, 1200);
  assert.ok(r.averagePerMonth > 590 && r.averagePerMonth < 610);
});

test('importer: dates, numbers, categories', () => {
  assert.equal(parseSheetDate('20/01/2026'), '2026-01-20');
  assert.equal(parseSheetDate('01/20/2026', 'mdy'), '2026-01-20');
  assert.equal(parseSheetDate('2026-01-20'), '2026-01-20');
  assert.equal(parseSheetDate('20-Jan-2026'), '2026-01-20');
  assert.equal(parseSheetDate('Jan 20, 2026'), '2026-01-20');
  assert.equal(parseSheetDate('31/02/2026'), null);
  assert.equal(parseSheetDate('Total'), null);
  assert.equal(parseSheetNumber('₹1,23,456.50'), 123456.5);
  assert.equal(parseSheetNumber(''), null);
  assert.ok(Number.isNaN(parseSheetNumber('abc')));
  assert.equal(mapCategory('', true), 'Petrol');
  assert.equal(mapCategory('Service'), 'Servicing');
  assert.equal(mapCategory('Spare parts'), 'Spare Parts');
});

test('importer: sample CSV is validated correctly', async () => {
  const { parseCSV } = await import('../js/utils.js');
  const rows = parseCSV(readFileSync(new URL('../assets/sample-import.csv', import.meta.url), 'utf8'));
  const existing = new Set([duplicateKey('2026-03-02', 1499, 'Helmet')]);
  const { items } = validateImport(rows, { existing, today: '2026-10-16' });
  const by = (status) => items.filter((i) => i.status === status);
  assert.equal(by('skipped').length, 3, 'summary rows skipped');
  assert.equal(by('duplicate').length, 1, 'existing helmet is a duplicate');
  assert.equal(by('invalid').length, 1, '₹0 free service is rejected');
  const fuel = by('valid').filter((i) => i.kind === 'fuel');
  assert.equal(fuel.length, 5);
  assert.equal(fuel[0].record.litres, 4.808); // 500 ÷ 104
  assert.equal(fuel[1].record.litres, 6.33); // litres column used
  assert.equal(fuel[1].record.litres_is_manual, true);
  assert.equal(fuel[0].record.is_full_tank, true);
  assert.match(by('invalid')[0].reasons[0], /greater than 0/);
});
