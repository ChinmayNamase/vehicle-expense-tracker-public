// LOCAL MODE backend: used automatically when Supabase is not configured.
// It imitates the small part of the Supabase client this app uses
// (auth + from(table) queries) and stores everything in this browser's
// localStorage, so the app works with no server at all.
//
// It also reproduces the important database rules from sql/schema.sql:
//  - every row belongs to the signed-in user (like Row Level Security)
//  - fuel / service / insurance records create a linked expense
//  - Petrol expenses only come from the Fuel Tracker
//  - deleting a vehicle deletes all its records
//
// Passwords are never stored: only a salted PBKDF2-SHA-256 hash is kept.
// Limitations: data lives only in this browser, password reset by email
// and receipt uploads need Supabase.

const DB_KEY = 'vet.local.db.v1';
const SESSION_KEY = 'vet.local.session.v1';
const TABLES = ['vehicles', 'expenses', 'fuel_logs', 'maintenance_records', 'insurance_records'];
const LINKED_TABLES = ['fuel_logs', 'maintenance_records', 'insurance_records'];

const nowISO = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const clone = (value) => JSON.parse(JSON.stringify(value));
const dbError = (code, message) => ({ code, message });

// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------
function loadDb() {
  try {
    const db = JSON.parse(localStorage.getItem(DB_KEY)) || {};
    db.users = db.users || [];
    for (const table of TABLES) db[table] = db[table] || [];
    return db;
  } catch {
    return { users: [], ...Object.fromEntries(TABLES.map((t) => [t, []])) };
  }
}

function saveDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    throw dbError('53100', 'Browser storage is full or blocked. Free some space or connect Supabase.');
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Password hashing (PBKDF2 with a random salt — no plaintext passwords)
// ---------------------------------------------------------------------
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPassword(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

function randomSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

// ---------------------------------------------------------------------
// Database rules (the same behaviour as the triggers in schema.sql)
// ---------------------------------------------------------------------
function linkedExpenseFields(table, row) {
  if (table === 'fuel_logs') {
    return { expense_date: row.fuel_date, description: row.description || 'Petrol', amount: row.amount_paid, category: 'Petrol', source: 'fuel' };
  }
  if (table === 'maintenance_records') {
    return { expense_date: row.service_date, description: `${row.description}${row.service_centre ? ` (${row.service_centre})` : ''}`.slice(0, 120), amount: row.cost, category: 'Servicing', source: 'maintenance' };
  }
  return { expense_date: row.policy_start_date, description: `Insurance premium - ${row.provider}`.slice(0, 120), amount: row.premium_amount, category: 'Insurance', source: 'insurance' };
}

function syncLinkedExpense(db, table, row) {
  let expense = db.expenses.find((e) => e.id === row.expense_id);
  if (!expense) {
    expense = { id: newId(), user_id: row.user_id, receipt_url: null, created_at: nowISO() };
    db.expenses.push(expense);
  }
  Object.assign(expense, linkedExpenseFields(table, row), { vehicle_id: row.vehicle_id, notes: row.notes ?? null, updated_at: nowISO() });
  row.expense_id = expense.id;
}

function bumpOdometer(db, row) {
  if (row.odometer_reading === null || row.odometer_reading === undefined) return;
  const vehicle = db.vehicles.find((v) => v.id === row.vehicle_id);
  if (vehicle && Number(vehicle.current_odometer) < Number(row.odometer_reading)) vehicle.current_odometer = row.odometer_reading;
}

function checkRow(db, table, row, userId) {
  if (table === 'vehicles') {
    const duplicate = db.vehicles.some((v) => v.user_id === userId && v.id !== row.id
      && v.registration_number.toUpperCase() === String(row.registration_number).toUpperCase());
    if (duplicate) throw dbError('23505', 'duplicate registration number');
    return;
  }
  // Ownership: the vehicle must belong to the same user (composite foreign key)
  if (!db.vehicles.some((v) => v.id === row.vehicle_id && v.user_id === userId)) {
    throw dbError('23503', 'vehicle not found');
  }
  if (table === 'expenses' && row.category === 'Petrol' && row.source === 'manual') {
    throw dbError('23514', 'Petrol expenses must come from the Fuel Tracker');
  }
  const amount = table === 'expenses' ? row.amount : table === 'fuel_logs' ? row.amount_paid
    : table === 'maintenance_records' ? row.cost : row.premium_amount;
  if (!(Number(amount) >= 0)) throw dbError('23514', 'invalid amount');
  if (table === 'fuel_logs' && !(row.price_per_litre > 0 && row.litres > 0 && row.amount_paid > 0)) {
    throw dbError('23514', 'invalid fuel values');
  }
}

function deleteRow(db, table, row) {
  db[table] = db[table].filter((r) => r.id !== row.id);
  if (table === 'vehicles') {
    for (const t of TABLES.slice(1)) db[t] = db[t].filter((r) => r.vehicle_id !== row.id);
  } else if (table === 'expenses') {
    for (const t of LINKED_TABLES) db[t] = db[t].filter((r) => r.expense_id !== row.id);
  } else if (row.expense_id) {
    db.expenses = db.expenses.filter((e) => e.id !== row.expense_id);
  }
}

// ---------------------------------------------------------------------
// Query builder: supports select/order/range/eq/insert/update/delete/single
// ---------------------------------------------------------------------
class LocalQuery {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.filters = [];
    this.orders = [];
    this.limits = null;
    this.payload = null;
    this.single_ = false;
    this.embedFuel = false;
  }

  select(columns = '*') {
    if (this.op === 'select' && this.table === 'expenses' && columns.includes('fuel_logs(')) this.embedFuel = true;
    return this;
  }
  order(column, { ascending = true } = {}) { this.orders.push([column, ascending]); return this; }
  range(from, to) { this.limits = [from, to]; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  insert(values) { this.op = 'insert'; this.payload = values; return this; }
  update(values) { this.op = 'update'; this.payload = values; return this; }
  delete() { this.op = 'delete'; return this; }
  single() { this.single_ = true; return this; }

  then(resolve, reject) {
    return Promise.resolve().then(() => this.execute()).then(resolve, reject);
  }

  execute() {
    const session = loadSession();
    if (!session) return { data: null, error: dbError('42501', 'JWT expired — please log in again') };
    if (!TABLES.includes(this.table)) return { data: null, error: dbError('42P01', `Unknown table ${this.table}`) };
    const userId = session.user.id;
    try {
      const db = loadDb();
      const mine = (row) => row.user_id === userId && this.filters.every(([c, v]) => row[c] === v);
      let rows;

      if (this.op === 'insert') {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        rows = list.map((values) => {
          const row = { id: newId(), ...clone(values), user_id: userId, created_at: nowISO(), updated_at: nowISO() };
          if (this.table === 'expenses') row.source = 'manual';
          checkRow(db, this.table, row, userId);
          if (LINKED_TABLES.includes(this.table)) { syncLinkedExpense(db, this.table, row); bumpOdometer(db, row); }
          db[this.table].push(row);
          return row;
        });
      } else if (this.op === 'update') {
        rows = db[this.table].filter(mine).map((row) => {
          if (this.table === 'expenses' && row.source !== 'manual') {
            throw dbError('P0001', `This expense is linked to a ${row.source} record. Edit it from that module.`);
          }
          const updated = { ...row, ...clone(this.payload), id: row.id, user_id: userId, updated_at: nowISO() };
          checkRow(db, this.table, updated, userId);
          if (LINKED_TABLES.includes(this.table)) { syncLinkedExpense(db, this.table, updated); bumpOdometer(db, updated); }
          Object.assign(row, updated);
          return row;
        });
      } else if (this.op === 'delete') {
        db[this.table].filter(mine).forEach((row) => deleteRow(db, this.table, row));
        rows = [];
      } else {
        rows = db[this.table].filter(mine).map((row) => (this.embedFuel
          ? { ...row, fuel_logs: db.fuel_logs.filter((f) => f.expense_id === row.id) }
          : row));
        for (const [column, ascending] of [...this.orders].reverse()) {
          rows = [...rows].sort((a, b) => (a[column] === b[column] ? 0 : (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1)));
        }
        if (this.limits) rows = rows.slice(this.limits[0], this.limits[1] + 1);
      }

      if (this.op !== 'select') saveDb(db);
      const data = clone(rows);
      return { data: this.single_ ? data[0] ?? null : data, error: null };
    } catch (error) {
      return { data: null, error: error.code ? error : dbError('XX000', error.message || String(error)) };
    }
  }
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
const listeners = new Set();
const notify = (event, session) => listeners.forEach((fn) => fn(event, session));

// Sign-out in another tab also signs this tab out
window.addEventListener('storage', (event) => {
  if (event.key === SESSION_KEY && !event.newValue) notify('SIGNED_OUT', null);
});

const authError = (message) => ({ message, status: 400 });

function startSession(user) {
  const session = { user: { id: user.id, email: user.email, user_metadata: { full_name: user.full_name } }, local: true };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  notify('SIGNED_IN', session);
  return session;
}

const auth = {
  async getSession() {
    return { data: { session: loadSession() }, error: null };
  },

  async signUp({ email, password, options = {} }) {
    const db = loadDb();
    const normalized = email.trim().toLowerCase();
    if (db.users.some((u) => u.email === normalized)) {
      return { data: { user: null, session: null }, error: authError('An account with this email already exists in this browser. Please log in.') };
    }
    const salt = randomSalt();
    const user = { id: newId(), email: normalized, full_name: options.data?.full_name || '', salt, password_hash: await hashPassword(password, salt), created_at: nowISO() };
    db.users.push(user);
    saveDb(db);
    const session = startSession(user);
    return { data: { user: session.user, session }, error: null };
  },

  async signInWithPassword({ email, password }) {
    const user = loadDb().users.find((u) => u.email === email.trim().toLowerCase());
    if (!user || (await hashPassword(password, user.salt)) !== user.password_hash) {
      return { data: { session: null }, error: authError('Invalid login credentials') };
    }
    return { data: { session: startSession(user) }, error: null };
  },

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
    notify('SIGNED_OUT', null);
    return { error: null };
  },

  async resetPasswordForEmail() {
    return { data: null, error: authError('Password reset emails need Supabase. In local mode, create a new account instead, or connect Supabase (see README).') };
  },

  async updateUser({ password }) {
    const session = loadSession();
    if (!session) return { data: null, error: authError('Please log in first.') };
    const db = loadDb();
    const user = db.users.find((u) => u.id === session.user.id);
    user.salt = randomSalt();
    user.password_hash = await hashPassword(password, user.salt);
    saveDb(db);
    return { data: { user: session.user }, error: null };
  },

  onAuthStateChange(callback) {
    listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
  },
};

// Receipt images need real file storage, which only Supabase provides.
const storageUnavailable = async () => ({ data: null, error: dbError('LOCAL', 'Receipt uploads need Supabase. Save the expense without a receipt, or connect Supabase (see README).') });
const storage = { from: () => ({ upload: storageUnavailable, createSignedUrl: storageUnavailable, remove: async () => ({ data: [], error: null }) }) };

export function createLocalClient() {
  return { auth, storage, from: (table) => new LocalQuery(table), isLocal: true };
}
