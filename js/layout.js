// Builds the shared app shell (sidebar + top bar) for every signed-in page,
// so navigation is identical everywhere and lives in one place.
import { isConfigured, isLocalMode, isOwnApi } from './supabase-client.js';
import { requireAuth, signOut } from './auth.js';
import { h, icon, refreshIcons, alertBox, loadingBlock } from './utils.js';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'layout-dashboard' },
  { id: 'vehicles', label: 'My Vehicles', href: 'vehicles.html', icon: 'car-front' },
  { id: 'expenses', label: 'Expenses', href: 'expenses.html', icon: 'receipt-indian-rupee' },
  { id: 'fuel', label: 'Fuel Tracker', href: 'fuel.html', icon: 'fuel' },
  { id: 'maintenance', label: 'Maintenance & Insurance', href: 'maintenance.html', icon: 'wrench' },
  { id: 'reports', label: 'Monthly Reports', href: 'reports.html', icon: 'bar-chart-3' },
  { id: 'import', label: 'Import CSV', href: 'import.html', icon: 'upload' },
];

function sidebar(active, email) {
  return h('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Main navigation' },
    h('a', { class: 'brand', href: 'dashboard.html' },
      h('img', { src: 'assets/logo.svg', alt: '', width: 32, height: 32 }),
      h('span', {}, 'Vehicle Expense Tracker')),
    h('nav', {},
      h('ul', { class: 'nav-list' },
        NAV_ITEMS.map((item) => h('li', {},
          h('a', { href: item.href, class: `nav-link${item.id === active ? ' active' : ''}`, 'aria-current': item.id === active ? 'page' : null },
            icon(item.icon), h('span', {}, item.label)))))),
    h('div', { class: 'sidebar-footer' },
      isLocalMode ? h('p', { class: 'local-badge', title: 'Supabase is not connected. Data is stored in this browser only.' }, icon('hard-drive'), 'Local mode · saved in this browser') : null,
      isOwnApi ? h('p', { class: 'local-badge api-badge', title: 'Data is stored by our own Java Spring Boot API and database.' }, icon('server'), 'Own Java API · own database') : null,
      h('div', { class: 'user-chip', title: email },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, (email || '?').charAt(0).toUpperCase()),
        h('span', { class: 'user-email' }, email)),
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: signOut }, icon('log-out'), 'Log out')));
}

function closeNav() {
  document.body.classList.remove('nav-open');
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded', 'false');
}

function toggleNav() {
  const open = !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', open);
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded', String(open));
}

/**
 * Checks configuration and login, renders the shell and returns
 * { session, main, actions } where `main` is the page content container.
 */
export async function initPage({ active, title, subtitle = '' }) {
  const app = document.getElementById('app');

  if (!isConfigured) {
    app.replaceChildren(h('main', { class: 'setup-screen' },
      h('img', { src: 'assets/logo.svg', alt: '', width: 48, height: 48 }),
      h('h1', {}, 'Almost there — connect Supabase'),
      alertBox('js/config.js is missing or still has placeholder values. Follow README → "Configure the frontend" to add your Supabase URL and publishable key, then reload this page.', 'warning'),
      h('a', { class: 'btn btn-primary', href: 'index.html' }, 'Back to home')));
    refreshIcons();
    return null;
  }

  app.replaceChildren(loadingBlock('Checking your session…'));
  const session = await requireAuth();
  if (!session) return null;

  const actions = h('div', { class: 'page-actions' });
  const main = h('div', { class: 'page-content' });

  app.replaceChildren(
    h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'),
    sidebar(active, session.user.email),
    h('div', { class: 'nav-overlay', onclick: closeNav, 'aria-hidden': 'true' }),
    h('div', { class: 'app-main' },
      h('header', { class: 'topbar' },
        h('button', { type: 'button', id: 'nav-toggle', class: 'icon-btn nav-toggle', 'aria-label': 'Open menu', 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: toggleNav }, icon('menu')),
        h('div', { class: 'page-heading' },
          h('h1', {}, title),
          subtitle ? h('p', { class: 'muted' }, subtitle) : null),
        actions),
      h('main', { id: 'main', tabindex: '-1' }, main)));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });
  window.matchMedia('(min-width: 1024px)').addEventListener('change', closeNav);
  refreshIcons();
  return { session, main, actions };
}

/** Shows a page-level error with a retry button. */
export function renderLoadError(container, error, retry) {
  container.replaceChildren(h('div', { class: 'card' },
    alertBox(`Could not load your data. ${error.message}`, 'error'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: retry }, icon('refresh-cw'), 'Try again')));
  refreshIcons();
}
