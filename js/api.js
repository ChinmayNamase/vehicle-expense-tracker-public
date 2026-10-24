// Data access layer: every Supabase query in the app goes through here.
// Row Level Security in the database guarantees each user only ever
// receives and modifies their own rows, even if this code were changed.
import { supabase } from './supabase-client.js';

const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request

/** Turns Supabase/Postgres errors into messages a user can act on. */
export function friendlyError(error) {
  if (!error) return new Error('Something went wrong.');
  const message = error.message || String(error);
  const map = {
    23505: 'A record with these details already exists (for example the same registration number).',
    23503: 'The selected vehicle was not found in your account.',
    23514: 'Some values are not allowed. Please check the amounts, dates and odometer readings.',
    42501: 'You do not have permission to do that.',
    P0001: message, // raised by our own triggers — already user friendly
  };
  if (map[error.code]) return new Error(map[error.code]);
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return new Error('Network error: could not reach the server. Check your internet connection and try again.');
  }
  if (/JWT|session/i.test(message)) return new Error('Your session has expired. Please log in again.');
  return new Error(message);
}

async function run(query) {
  const { data, error } = await query;
  if (error) throw friendlyError(error);
  return data;
}

/** Reads every row of a query, 1000 at a time. */
async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await run(buildQuery().range(from, from + PAGE_SIZE - 1));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) throw new Error('Your session has expired. Please log in again.');
  return id;
}

// ---------------------------------------------------------------------
// Generic CRUD for simple tables
// ---------------------------------------------------------------------
function crud(table, orderColumn) {
  return {
    list: () => fetchAll(() => supabase.from(table).select('*').order(orderColumn, { ascending: false })),
    save: (values, id = null) => (id
      ? run(supabase.from(table).update(values).eq('id', id).select().single())
      : run(supabase.from(table).insert(values).select().single())),
    remove: (id) => run(supabase.from(table).delete().eq('id', id)),
    insertMany: (rows) => run(supabase.from(table).insert(rows).select()),
  };
}

export const vehiclesApi = crud('vehicles', 'created_at');
export const fuelApi = crud('fuel_logs', 'fuel_date');
export const maintenanceApi = crud('maintenance_records', 'service_date');
export const insuranceApi = crud('insurance_records', 'expiry_date');

export const expensesApi = {
  ...crud('expenses', 'expense_date'),
  /** Expenses with any linked fuel details embedded (one query, no N+1). */
  list: () => fetchAll(() => supabase
    .from('expenses')
    .select('*, fuel_logs(id, price_per_litre, litres, odometer_reading, is_full_tank, litres_is_manual, fuel_station)')
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })),
};

/** Loads everything the dashboard-style pages need, in parallel. */
export async function loadAllData() {
  const [vehicles, expenses, fuelLogs, maintenance, insurance] = await Promise.all([
    vehiclesApi.list(), expensesApi.list(), fuelApi.list(), maintenanceApi.list(), insuranceApi.list(),
  ]);
  // PostgREST may embed a one-to-one relation as an object or as an array
  for (const expense of expenses) {
    const linked = expense.fuel_logs;
    expense.fuel = Array.isArray(linked) ? linked[0] || null : linked || null;
    delete expense.fuel_logs;
  }
  return { vehicles, expenses, fuelLogs, maintenance, insurance };
}

// ---------------------------------------------------------------------
// Receipts (private storage bucket 'receipts', folder = user id)
// ---------------------------------------------------------------------
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export function validateReceipt(file) {
  if (!file || !file.size) return null;
  if (!RECEIPT_TYPES.includes(file.type)) return 'Receipt must be a JPG, PNG, WEBP or HEIC image.';
  if (file.size > MAX_RECEIPT_BYTES) return 'Receipt image must be 5 MB or smaller.';
  return null;
}

export async function uploadReceipt(file) {
  const userId = await currentUserId();
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  await run(supabase.storage.from('receipts').upload(path, file, { contentType: file.type, upsert: false }));
  return path;
}

/** Private files need a short-lived signed URL to be viewed. */
export async function receiptUrl(path) {
  const data = await run(supabase.storage.from('receipts').createSignedUrl(path, 120));
  return data.signedUrl;
}

export async function deleteReceipt(path) {
  if (!path) return;
  await run(supabase.storage.from('receipts').remove([path]));
}
