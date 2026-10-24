// OWN API backend: used when the website is served by our Java Spring Boot server.
// It offers the same small interface the rest of the app already uses
// (auth.* and from(table).select/insert/update/delete), but every call goes
// to OUR REST API (/api/auth/*, /api/app/*) and our own database.
//
// Login: the server returns a random session token, which is kept in this
// browser and sent as "Authorization: Bearer <token>" on every request.

const SESSION_KEY = 'vet.api.session.v1';

const clone = (value) => JSON.parse(JSON.stringify(value));

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function createApiClient(baseUrl = '') {
  const listeners = new Set();
  const notify = (event, session) => listeners.forEach((fn) => fn(event, session));

  // Logging out in another tab logs this tab out too
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_KEY && !event.newValue) notify('SIGNED_OUT', null);
  });

  /** Calls the API and returns { data, error } like the Supabase client does. */
  async function request(method, path, body) {
    const session = loadSession();
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    // The free server sleeps when idle and needs up to ~2 minutes to wake up,
    // so keep retrying network errors / "gateway" errors for a while.
    let response;
    const giveUpAt = Date.now() + 150_000;
    for (;;) {
      try {
        response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (![502, 503, 504].includes(response.status)) break;
      } catch {
        response = null;
      }
      if (Date.now() > giveUpAt) {
        if (response) break;
        return { data: null, error: { message: 'Cannot reach the server. Check your internet connection and try again.' } };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (response.status === 401 && path.startsWith('/api/app/')) {
      saveSession(null);
      notify('SIGNED_OUT', null);
      return { data: null, error: { message: 'JWT expired — please log in again' } };
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) return { data: null, error: { code: json?.code, message: json?.message || `HTTP ${response.status}` } };
    return { data: json, error: null };
  }

  // ------------------------------------------------------------- auth
  const startSession = (result) => {
    const session = result.session;
    saveSession(session);
    notify('SIGNED_IN', session);
    return session;
  };

  const auth = {
    async getSession() {
      return { data: { session: loadSession() }, error: null };
    },
    async signUp({ email, password, options = {} }) {
      const { data, error } = await request('POST', '/api/auth/register', { email, password, fullName: options.data?.full_name || '' });
      if (error) return { data: { user: null, session: null }, error };
      const session = startSession(data);
      return { data: { user: session.user, session }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const { data, error } = await request('POST', '/api/auth/login', { email, password });
      if (error) return { data: { session: null }, error };
      return { data: { session: startSession(data) }, error: null };
    },
    async signOut() {
      await request('POST', '/api/auth/logout');
      saveSession(null);
      notify('SIGNED_OUT', null);
      return { error: null };
    },
    async resetPasswordForEmail() {
      return { data: null, error: { message: 'Password reset emails are not available on this server. Log in and change your password, or ask the admin.' } };
    },
    async updateUser({ password }) {
      const { error } = await request('POST', '/api/auth/password', { password });
      return { data: error ? null : { user: loadSession()?.user }, error };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
  };

  // ------------------------------------------------------------- tables
  class ApiQuery {
    constructor(table) {
      Object.assign(this, { table, op: 'select', filters: [], orders: [], limits: null, payload: null, single_: false });
    }

    select() { return this; }
    order(column, { ascending = true } = {}) { this.orders.push([column, ascending]); return this; }
    range(from, to) { this.limits = [from, to]; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    insert(values) { this.op = 'insert'; this.payload = values; return this; }
    update(values) { this.op = 'update'; this.payload = values; return this; }
    delete() { this.op = 'delete'; return this; }
    single() { this.single_ = true; return this; }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    idFilter() {
      const filter = this.filters.find(([column]) => column === 'id');
      if (!filter) throw new Error(`${this.op} on ${this.table} needs .eq('id', …)`);
      return encodeURIComponent(filter[1]);
    }

    async execute() {
      const path = `/api/app/${this.table}`;
      let result;
      if (this.op === 'insert') {
        result = await request('POST', path, clone(this.payload));
      } else if (this.op === 'update') {
        result = await request('PATCH', `${path}/${this.idFilter()}`, clone(this.payload));
        if (!result.error) result.data = [result.data];
      } else if (this.op === 'delete') {
        result = await request('DELETE', `${path}/${this.idFilter()}`);
        if (!result.error) result.data = [];
      } else {
        result = await request('GET', path);
        if (!result.error) {
          let rows = result.data.filter((row) => this.filters.every(([c, v]) => row[c] === v));
          for (const [column, ascending] of [...this.orders].reverse()) {
            rows = [...rows].sort((a, b) => (a[column] === b[column] ? 0 : (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1)));
          }
          if (this.limits) rows = rows.slice(this.limits[0], this.limits[1] + 1);
          result.data = rows;
        }
      }
      if (result.error) return result;
      return { data: this.single_ ? result.data[0] ?? null : result.data, error: null };
    }
  }

  // Receipt images need file storage, which this server does not provide yet.
  const unavailable = async () => ({ data: null, error: { message: 'Receipt uploads are not available on this server. Save the expense without a receipt.' } });
  const storage = { from: () => ({ upload: unavailable, createSignedUrl: unavailable, remove: async () => ({ data: [], error: null }) }) };

  /** Starts waking up the (sleeping) server early; result is ignored. */
  const warmUp = () => fetch(`${baseUrl}/api/health`).catch(() => {});

  return { auth, storage, from: (table) => new ApiQuery(table), isApi: true, warmUp };
}
