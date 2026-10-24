// Authentication with Supabase Auth (email + password).
// Supabase stores only a salted password hash; this app never stores passwords.
import { supabase, isConfigured, isLocalMode } from './supabase-client.js';
import { $, alertBox, setButtonLoading, refreshIcons } from './utils.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email) {
  return EMAIL_PATTERN.test(email) ? null : 'Enter a valid email address.';
}

export function validatePassword(password) {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number.';
  return null;
}

/** Only allow redirects to pages of this site (prevents open redirects). */
function safeNextPage() {
  const next = new URLSearchParams(location.search).get('next') || '';
  return /^[a-z-]+\.html(\?[\w=&%-]*)?$/i.test(next) ? next : 'dashboard.html';
}

const pageUrl = (page) => new URL(page, location.href).href;

// ---------------------------------------------------------------------
// Session helpers used by protected pages
// ---------------------------------------------------------------------
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Redirects to login if not signed in. Returns the session otherwise. */
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const here = location.pathname.split('/').pop() + location.search;
    location.replace(`login.html?next=${encodeURIComponent(here)}`);
    return null;
  }
  // If the user signs out in another tab, leave this protected page too.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.replace('login.html');
  });
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace('login.html');
}

// ---------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------
function showMessage(form, message, type = 'error') {
  const box = $('.form-message', form);
  box.replaceChildren(alertBox(message, type));
  refreshIcons();
}

function setFieldError(input, message) {
  const errorEl = document.getElementById(`${input.id}-error`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (errorEl) errorEl.textContent = message || '';
  return !message;
}

function notConfiguredGuard(form) {
  if (isLocalMode) {
    showMessage(form, 'Local mode: Supabase is not connected yet, so your account and data are saved only in this browser. Connect Supabase (README step 9) to store them in the cloud.', 'info');
  }
  if (isConfigured) return false;
  showMessage(form, 'Supabase is not configured yet. Create js/config.js as described in README → "Configure the frontend".', 'warning');
  form.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
  return true;
}

/** Shows a "server is waking up" note when a request is slow (free hosting sleeps when idle). */
async function withWakeUpNotice(form, promise) {
  const timer = setTimeout(() => showMessage(form,
    'The server is waking up after being idle — this can take up to 1–2 minutes the first time. Please wait…', 'info'), 4000);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    $('.form-message', form).replaceChildren();
  }
}

async function redirectIfLoggedIn() {
  if (await getSession()) location.replace(safeNextPage());
}

// ---------------------------------------------------------------------
// login.html
// ---------------------------------------------------------------------
export async function initLoginPage() {
  const form = $('#login-form');
  if (notConfiguredGuard(form)) return;
  supabase.warmUp?.();
  await redirectIfLoggedIn();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    const ok = [setFieldError(form.email, validateEmail(email)),
      setFieldError(form.password, password ? null : 'Enter your password.')].every(Boolean);
    if (!ok) return;

    const button = form.querySelector('button[type=submit]');
    setButtonLoading(button, true, 'Logging in…');
    const { error } = await withWakeUpNotice(form, supabase.auth.signInWithPassword({ email, password }));
    setButtonLoading(button, false);
    if (error) {
      const text = /confirm/i.test(error.message)
        ? 'Please confirm your email address first (check your inbox).'
        : /invalid/i.test(error.message) ? 'Incorrect email or password. New here? Click "Sign up" first — accounts from the earlier version were not copied to the live server.' : error.message;
      showMessage(form, text);
      return;
    }
    location.replace(safeNextPage());
  });
}

// ---------------------------------------------------------------------
// register.html
// ---------------------------------------------------------------------
export async function initRegisterPage() {
  const form = $('#register-form');
  if (notConfiguredGuard(form)) return;
  supabase.warmUp?.();
  await redirectIfLoggedIn();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = form.full_name.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirm = form.confirm_password.value;
    const ok = [
      setFieldError(form.full_name, name ? null : 'Enter your name.'),
      setFieldError(form.email, validateEmail(email)),
      setFieldError(form.password, validatePassword(password)),
      setFieldError(form.confirm_password, confirm === password ? null : 'Passwords do not match.'),
    ].every(Boolean);
    if (!ok) return;

    const button = form.querySelector('button[type=submit]');
    setButtonLoading(button, true, 'Creating account…');
    const { data, error } = await withWakeUpNotice(form, supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name }, emailRedirectTo: pageUrl('login.html') },
    }));
    setButtonLoading(button, false);
    if (error) {
      showMessage(form, error.message);
      return;
    }
    if (data.session) {
      location.replace('dashboard.html'); // email confirmation is disabled in Supabase
      return;
    }
    form.reset();
    showMessage(form, 'Account created! Check your email and click the confirmation link, then log in.', 'success');
  });
}

// ---------------------------------------------------------------------
// reset-password.html — two steps:
//  1) ask for email and send a reset link
//  2) when the user returns from that link, ask for a new password
// ---------------------------------------------------------------------
export async function initResetPage() {
  const requestForm = $('#reset-request-form');
  const updateForm = $('#reset-update-form');
  if (notConfiguredGuard(requestForm)) return;

  const showUpdateForm = () => {
    requestForm.hidden = true;
    updateForm.hidden = false;
    $('#reset-title').textContent = 'Choose a new password';
  };
  if (window.__isPasswordRecovery) showUpdateForm();
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showUpdateForm();
  });

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = requestForm.email.value.trim();
    if (!setFieldError(requestForm.email, validateEmail(email))) return;
    const button = requestForm.querySelector('button[type=submit]');
    setButtonLoading(button, true, 'Sending…');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('reset-password.html') });
    setButtonLoading(button, false);
    // Same message whether or not the account exists (don't reveal accounts)
    showMessage(requestForm, error ? error.message : 'If an account exists for that email, a reset link has been sent.', error ? 'error' : 'success');
  });

  updateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = updateForm.password.value;
    const ok = [
      setFieldError(updateForm.password, validatePassword(password)),
      setFieldError(updateForm.confirm_password, updateForm.confirm_password.value === password ? null : 'Passwords do not match.'),
    ].every(Boolean);
    if (!ok) return;
    if (!(await getSession())) {
      showMessage(updateForm, 'This reset link has expired. Request a new one.');
      return;
    }
    const button = updateForm.querySelector('button[type=submit]');
    setButtonLoading(button, true, 'Updating…');
    const { error } = await supabase.auth.updateUser({ password });
    setButtonLoading(button, false);
    if (error) {
      showMessage(updateForm, error.message);
      return;
    }
    showMessage(updateForm, 'Password updated. Redirecting to your dashboard…', 'success');
    setTimeout(() => location.replace('dashboard.html'), 1500);
  });
}

/** Landing page: switch the nav buttons when already signed in. */
export async function initLandingNav() {
  const session = await getSession().catch(() => null);
  if (!session) return;
  document.querySelectorAll('[data-guest-only]').forEach((el) => { el.hidden = true; });
  document.querySelectorAll('[data-user-only]').forEach((el) => { el.hidden = false; });
}

