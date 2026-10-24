// Admin dashboard: reads the Spring Boot REST API and shows all users and entries.
// The browser already holds the admin login (HTTP Basic), so fetch() calls are authorised.
// All values are inserted with textContent (never innerHTML) to prevent XSS.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const money = (v) => (v === null || v === undefined ? '—' : inr.format(Number(v)));
const num = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const date = (v) => (v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const dateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) => node.append(c instanceof Node ? c : document.createTextNode(c ?? '')));
  return node;
}

async function api(path) {
  // Build the URL from the origin so it never carries user:password parts of the page URL.
  const response = await fetch(new URL(path, window.location.origin), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return response.json();
}

// Column definitions per tab: [header, value(row), numeric?]
const TABS = {
  users: {
    path: () => '/api/users',
    columns: [
      ['Email', (r) => r.email], ['Name', (r) => r.fullName || '—'],
      ['Signed up', (r) => dateTime(r.signedUpAt)], ['Last login', (r) => dateTime(r.lastSignInAt)],
      ['Vehicles', (r) => r.vehicles, true], ['Entries', (r) => r.entries, true], ['Total spent', (r) => money(r.totalSpent), true],
    ],
    onRowClick: (r) => { userFilter.value = r.id; selectTab('expenses'); },
  },
  vehicles: {
    path: (u) => `/api/vehicles${u}`,
    columns: [
      ['Owner', (r) => r.ownerEmail], ['Type', (r) => r.vehicleType], ['Vehicle', (r) => `${r.make} ${r.model}`],
      ['Reg. no.', (r) => r.registrationNumber], ['Fuel', (r) => r.fuelType],
      ['Odometer (km)', (r) => num(r.currentOdometer), true], ['Added', (r) => dateTime(r.createdAt)],
    ],
  },
  expenses: {
    path: (u) => `/api/expenses${u}${u ? '&' : '?'}limit=5000`,
    columns: [
      ['Date', (r) => date(r.expenseDate)], ['Owner', (r) => r.ownerEmail], ['Vehicle', (r) => r.vehicleName],
      ['Description', (r) => r.description], ['Category', (r) => badge(r.category, r.category === 'Petrol' ? 'green' : 'blue')],
      ['Amount', (r) => money(r.amount), true], ['Petrol (L)', (r) => num(r.litres, 2), true], ['Odometer', (r) => num(r.odometerReading), true],
    ],
  },
  fuel: {
    path: (u) => `/api/fuel-logs${u}${u ? '&' : '?'}limit=5000`,
    columns: [
      ['Date', (r) => date(r.fuelDate)], ['Owner', (r) => r.ownerEmail], ['Vehicle', (r) => r.vehicleName], ['Description', (r) => r.description],
      ['Amount', (r) => money(r.amountPaid), true], ['Price/L', (r) => money(r.pricePerLitre), true],
      ['Litres', (r) => num(r.litres, 2), true], ['Odometer', (r) => num(r.odometerReading), true], ['Full tank', (r) => (r.fullTank ? 'Yes' : 'No')],
    ],
  },
  maintenance: {
    path: (u) => `/api/maintenance${u}`,
    columns: [
      ['Date', (r) => date(r.serviceDate)], ['Owner', (r) => r.ownerEmail], ['Vehicle', (r) => r.vehicleName], ['Description', (r) => r.description],
      ['Centre', (r) => r.serviceCentre || '—'], ['Cost', (r) => money(r.cost), true], ['Next service', (r) => date(r.nextServiceDate)],
    ],
  },
  insurance: {
    path: (u) => `/api/insurance${u}`,
    columns: [
      ['Owner', (r) => r.ownerEmail], ['Vehicle', (r) => r.vehicleName], ['Provider', (r) => r.provider],
      ['Start', (r) => date(r.policyStartDate)], ['Expiry', (r) => date(r.expiryDate)], ['Premium', (r) => money(r.premiumAmount), true],
    ],
  },
};

const badge = (text, tone) => el('span', { class: `badge ${tone}` }, text);
const userFilter = document.getElementById('user-filter');
const search = document.getElementById('search');
const tableArea = document.getElementById('table-area');
const rowCount = document.getElementById('row-count');
let currentTab = 'users';
let currentRows = [];

function renderTable() {
  const tab = TABS[currentTab];
  const query = search.value.trim().toLowerCase();
  const rows = currentRows.filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query));
  rowCount.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}${currentTab === 'users' ? ' · click a user to see their entries' : ''}`;
  if (!rows.length) {
    tableArea.replaceChildren(el('p', { class: 'muted' }, 'No rows.'));
    return;
  }
  const table = el('table', {},
    el('thead', {}, el('tr', {}, tab.columns.map(([h, , n]) => el('th', { class: n ? 'num' : '' }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', tab.onRowClick ? { class: 'clickable', onclick: () => tab.onRowClick(r) } : {},
      tab.columns.map(([, value, n]) => el('td', { class: n ? 'num' : '' }, value(r)))))));
  tableArea.replaceChildren(table);
}

async function loadTab() {
  tableArea.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  try {
    const user = userFilter.value;
    const suffix = user && currentTab !== 'users' ? `?userId=${encodeURIComponent(user)}` : '';
    currentRows = await api(TABS[currentTab].path(suffix));
    renderTable();
  } catch (error) {
    tableArea.replaceChildren(el('p', { class: 'error' }, `Could not load data: ${error.message}`));
  }
}

function selectTab(name) {
  currentTab = name;
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  loadTab();
}

async function loadStats() {
  const stats = await api('/api/stats');
  const cards = [
    ['Registered users', stats.users], ['Vehicles', stats.vehicles], ['Expense entries', stats.expenses],
    ['Fuel fills', stats.fuelLogs], ['Total spent', money(stats.totalSpent)], ['Petrol spent', money(stats.petrolSpent)],
    ['Petrol consumed', `${num(stats.litres, 2)} L`],
  ];
  document.getElementById('stats').replaceChildren(...cards.map(([label, value]) =>
    el('article', { class: 'stat' }, el('p', { class: 'label' }, label), el('p', { class: 'value' }, String(value)))));
}

async function init() {
  try {
    const health = await api('/api/health');
    document.getElementById('db-status').textContent = `API ${health.status} · database profile: ${health.database}`;
    const [users] = await Promise.all([api('/api/users'), loadStats()]);
    users.forEach((u) => userFilter.append(el('option', { value: u.id }, u.email)));
  } catch (error) {
    document.getElementById('db-status').textContent = `Error: ${error.message}`;
  }
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  userFilter.addEventListener('change', () => (currentTab === 'users' ? selectTab('expenses') : loadTab()));
  search.addEventListener('input', renderTable);
  loadTab();
}

init();
