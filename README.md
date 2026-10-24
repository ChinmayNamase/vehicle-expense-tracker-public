# Vehicle Expense Tracker

**Live website:** https://vehicle-expense-tracker-eta.vercel.app · **Live API health:** https://vehicle-tracker-api-kb2q.onrender.com/api/health

> FSJP (Full Stack Java Programming) course project, Vidyavardhini's College of Engineering & Technology, by **Jay Kanojiya (30), Chinmay Namase (43), Soham Phalke (50) and Soham Kene (32)**.

### How the live version works

| Part | Technology | Hosted on |
|---|---|---|
| Website (frontend) | HTML, CSS, JavaScript, Chart.js | Vercel |
| Own REST API (backend) | Java 21, Spring Boot, Spring Security | Render (Docker, `render.yaml`) |
| Database | PostgreSQL | Neon |

### Why you can trust it

- **All the code is open.** Everything that runs on the website and on the API server is in this repository, so anyone can read it.
- **No secrets in the code.** The database address and admin password are set as environment variables on the hosting service and are never committed. `.env` and `js/config.js` are git-ignored.
- **Passwords are never stored.** Only a BCrypt hash is kept. Login sessions are random 256-bit tokens, and the database only holds their SHA-256 hash.
- **Every user sees only their own data.** Each API query is filtered by the signed-in user's id. Automated tests (`backend-api/src/test`) check that one user cannot read or change another user's records.
- **Only this website may call the API.** CORS is limited to the website's address.
- **Demo data is fake.** `demo/data.sql` uses example.com users and made-up vehicles.

Note: the free API server sleeps when idle, so the first sign-in after a while can take 1–2 minutes. The page shows a "waking up" message and retries automatically.

Found a security problem? Please open an issue (without sensitive details) or contact the authors privately.


A responsive web app for tracking bike and car expenses: fuel fills, petrol litres, distance travelled, mileage (km/L), servicing, insurance and monthly reports. It started as a Google Sheets tracker and keeps the sheet's useful parts. Calculations run automatically, every user's data is stored privately in Supabase, and you can import your old CSV.

Built with plain **HTML, CSS and JavaScript (ES modules)**, with **Supabase** for the database and login, and **Chart.js** for charts. No React, no build step. The browser runs the files as written.

---

## 1. Project introduction

Many people track vehicle running costs in a spreadsheet. Spreadsheets break easily: formulas get overwritten, the first odometer reading gets counted as distance, every row is assumed to be a full tank, and fuel gets counted twice in the totals. This project turns that sheet into a proper multi-user web app with:

- a **database** (PostgreSQL on Supabase) instead of cells,
- **validated forms** instead of free typing,
- **reusable, tested calculation functions** instead of copied formulas,
- **Row Level Security**, so each user only ever sees their own data.

## 2. Features

| Area | What it does |
|---|---|
| Landing page | Intro, feature highlights, dashboard preview, sign up / login |
| Authentication | Register, login, logout, persistent session, password reset, protected pages |
| Dashboard | 8 summary cards, 4 charts, recent transactions, vehicle summary, reminders, date-range and vehicle filters, cost/km mode switch, Quick Add buttons |
| My Vehicles | Add/edit/view/delete bikes and cars. Each vehicle has a details panel modelled on the sheet, a cost-of-ownership breakdown, and its own fuel and expense history |
| Expenses | Add/edit/delete, optional private receipt image, full history table with search, filters, sorting, pagination and CSV export |
| Fuel Tracker | Litres = Amount ÷ Price, filled in as you type, or entered from the pump receipt. Distance between fills, odometer warnings, full-tank mileage, price trend, monthly consumption |
| Maintenance & Insurance | Service records (next date / next km) and insurance policies, with in-app reminders |
| Monthly Reports | Month-by-month table and charts per vehicle and period, CSV export |
| CSV Import | Import your Google Sheets export with preview, row validation, duplicate detection and skipped summary rows |

## 3. Technologies used

- **HTML5 / CSS3 / vanilla JavaScript (ES2020 modules)**
- **Supabase**: PostgreSQL database, Auth (email + password) and Storage (receipts)
- **@supabase/supabase-js v2** (loaded from the jsDelivr CDN)
- **Chart.js 4** for charts, **Lucide** for icons, **Inter** font from Google Fonts
- **Node.js** (optional) for the local dev server, config generator and unit tests. The app itself needs no Node.
- **Git + GitHub** for version control, **Netlify or Vercel** for hosting

## 4. Folder structure

```
vehicle-expense-tracker/
├── index.html               Landing page
├── login.html               Login
├── register.html            Sign up
├── reset-password.html      Forgot password + set new password
├── dashboard.html           Dashboard
├── vehicles.html            My Vehicles (list + ?id= detail view)
├── expenses.html            Add expenses + complete expense history
├── fuel.html                Fuel Tracker
├── maintenance.html         Maintenance & Insurance
├── reports.html             Monthly Reports
├── import.html              Google Sheets CSV import
├── css/
│   ├── style.css            Design tokens, buttons, cards, tables, landing + auth pages
│   ├── dashboard.css        App shell (sidebar/top bar), stat cards, charts, vehicles
│   ├── forms.css            Inputs, validation messages, dialogs, live calculation panel
│   └── responsive.css       Tablet/mobile layouts, print styles
├── js/
│   ├── config.example.js    Template for js/config.js (Supabase URL + publishable key)
│   ├── supabase-client.js   Creates the Supabase client (or local mode if not configured)
│   ├── local-backend.js     Local mode: browser-storage auth + data when Supabase isn't set up
│   ├── auth.js              Login, register, reset, logout, requireAuth()
│   ├── api.js               ALL database/storage queries (data access layer)
│   ├── calculations.js      ALL calculation rules (pure functions, unit tested)
│   ├── importer.js          CSV column detection + row validation (pure, unit tested)
│   ├── utils.js             Formatting (₹, dates), safe DOM builder, dialogs, toasts, CSV
│   ├── layout.js            Shared sidebar/top bar and page start-up
│   ├── components.js        Stat cards, filter bar, charts, vehicle panel, reminders, fuel table
│   ├── forms.js             Vehicle / expense / fuel / maintenance / insurance forms
│   ├── dashboard.js         One script per page…
│   ├── vehicles.js
│   ├── expenses.js
│   ├── fuel.js
│   ├── maintenance.js
│   ├── reports.js
│   └── import.js
├── assets/
│   ├── logo.svg
│   └── sample-import.csv    Example spreadsheet export (also used as demo data)
├── sql/
│   ├── schema.sql           Tables, constraints, indexes, triggers
│   └── policies.sql         Row Level Security + private storage bucket policies
├── scripts/
│   ├── generate-config.mjs  Writes js/config.js from .env / environment variables
│   └── serve.mjs            Tiny local web server (no dependencies)
├── tests/
│   └── calculations.test.mjs  Unit tests for calculations and CSV import
├── .env.example
├── netlify.toml / vercel.json
└── package.json
```

Compared with the original brief I added a few files to keep things readable: `api.js` (all queries in one place), `forms.js` (shared forms for the Quick Add buttons and module pages), `layout.js`, `components.js`, `importer.js`, `reset-password.html` and `import.html`.

## 5. Prerequisites

- A free [Supabase](https://supabase.com) account
- A modern browser (Chrome, Edge, Firefox or Safari)
- **Node.js 18+** (recommended, for `npm start` and tests). Without Node, any static server works, e.g. `python3 -m http.server`.
- Git and a GitHub account (for deployment)

## 6. Create a Supabase project

1. Go to <https://supabase.com/dashboard> and click **New project**.
2. Pick a name (e.g. `vehicle-expense-tracker`), set a strong database password (save it somewhere safe), choose the region closest to you (e.g. *Mumbai*), then click **Create**.
3. Wait about a minute for the project to start.

## 7. Run the SQL schema and RLS policies

1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the whole of `sql/schema.sql` and click **Run**. You should see "Success. No rows returned".
3. Open a new query, paste `sql/policies.sql` and click **Run**.
4. Check **Table Editor**: you should see `vehicles`, `expenses`, `fuel_logs`, `maintenance_records` and `insurance_records`, each marked **RLS enabled**. **Storage** should show a private bucket called `receipts`.

Both files can safely be run again (they use `if not exists` / `drop … if exists`).

## 8. Configure authentication

In **Authentication → Sign In / Providers**, make sure **Email** is enabled.

In **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:5500` while developing (change it to your live URL after deploying).
- **Redirect URLs**: add
  - `http://localhost:5500/login.html`
  - `http://localhost:5500/reset-password.html`
  - and later the same two pages on your deployed domain, e.g. `https://your-app.netlify.app/reset-password.html`.

**Email confirmation:** by default Supabase asks new users to confirm their email. For a quick classroom demo you can switch off **Confirm email** under *Authentication → Sign In / Providers → Email*. New accounts will then go straight to the dashboard. Supabase's built-in email service is rate-limited (a few emails per hour). That's fine for testing; set up custom SMTP for real use.

## 9. Configure the frontend

The browser needs two **public** values: the project URL and the **publishable key**. Find them under **Project Settings → API Keys** (use the `sb_publishable_…` key, or the legacy `anon` key on older projects).

> **Security:** the publishable/anon key is designed to be public. Your data is protected by the Row Level Security policies, not by hiding this key. **Never** put the `service_role` / `sb_secret_…` key in any frontend file. `scripts/generate-config.mjs` refuses to write one.

Choose **one** of these options:

**Option A, using .env (recommended):**

```bash
cp .env.example .env
```

Edit `.env`:

```
SUPABASE_URL=https://abcdefghijklm.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then `npm run config` (or `npm start`, which runs it for you) writes `js/config.js`.

**Option B, by hand:** copy `js/config.example.js` to `js/config.js` and paste the two values in.

`js/config.js` and `.env` are listed in `.gitignore`, so they are never committed.

**Local mode (no Supabase yet):** if `js/config.js` is missing or still has placeholder values, the app runs in *local mode* (`js/local-backend.js`). Sign-up, login and all features work, but accounts and data are stored only in that browser's localStorage. Passwords are kept as salted PBKDF2 hashes, never as plain text. The sidebar shows "Local mode · saved in this browser". Password-reset emails and receipt uploads need Supabase. Once you add your Supabase keys, the app uses Supabase automatically; local data is not migrated.

## 10. Run the website locally

The JavaScript uses ES modules, which browsers **do not allow from `file://` URLs**, so double-clicking `index.html` will not work. Serve the folder over HTTP instead:

```bash
npm start
```

Then open <http://localhost:5500>. (`npm start` needs no `npm install`; there are no dependencies.)

Alternatives: `python3 -m http.server 5500`, or the VS Code **Live Server** extension (its default port is also 5500).

Run the unit tests:

```bash
npm test
```

## 11. Create a test account

1. Open <http://localhost:5500> → **Sign up free**.
2. Enter a name, email and password (at least 8 characters, with a letter and a number).
3. If email confirmation is on, click the link in the email, then log in. Otherwise you land on the dashboard straight away.
4. To check password reset: **Log in → Forgot password?**, enter your email, open the link and choose a new password.

## 12. Add a vehicle

**My Vehicles → Add vehicle**. The required fields are type, fuel type, make, model, registration number and current odometer (0 for a new vehicle). The chassis number, engine number, dates, purchase price and tank capacity are optional. Anything you leave empty shows as "—" in the details panel. Nothing is made up.

## 13. Add an expense and a fuel entry

- **Fuel:** **Fuel Tracker → Add fuel entry** (or **Add Fuel** on the dashboard). Enter the amount paid and the price per litre, and the litres appear straight away (₹658 ÷ ₹104 = **6.33 L**). Add the odometer reading and tick **Full tank** if you filled up completely. The green *Live calculation* panel shows the previous reading, the distance and the cost per km before you save.
- **Other expenses:** **Expenses → Add expense**. If you choose the *Petrol* category, the form sends you to the fuel form, so litres and odometer are never missing.
- **Service / insurance:** **Maintenance & Insurance → Add service / Add policy**. These automatically appear in your expenses as *Servicing* / *Insurance*.
- **Import your sheet:** **Import CSV**. Download the sample file to see the expected format.

## 14. Deploy the website

Push the project to GitHub first:

```bash
git init
```

```bash
git add . && git commit -m "Vehicle Expense Tracker"
```

Create an empty repository on GitHub, then follow its instructions to `git remote add origin …` and `git push -u origin main`.

**Netlify:** *Add new site → Import from Git* → pick the repository. `netlify.toml` already sets build command `npm run build` and publish directory `.`. Under *Site configuration → Environment variables* add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, then **Deploy**.

**Vercel:** *Add New → Project* → import the repository. `vercel.json` sets the build command and output directory. Add the same two environment variables, then **Deploy**.

The build step only runs `scripts/generate-config.mjs`, which creates `js/config.js` on the server from those variables.

**After deploying**, go back to Supabase → *Authentication → URL Configuration*: set the **Site URL** to your live URL and add `https://<your-domain>/login.html` and `https://<your-domain>/reset-password.html` to **Redirect URLs**.

## 15. Common errors and troubleshooting

| Problem | Cause / fix |
|---|---|
| Blank page, console shows CORS or "Failed to load module script" | You opened the file directly (`file://`). Use `npm start` and `http://localhost:5500`. |
| Sidebar says "Local mode" | `js/config.js` is missing or has placeholders, so data is only saved in this browser. See step 9 to connect Supabase. |
| "Invalid API key" | The key was copied wrongly, or you used the secret key. Use the publishable/anon key. |
| `relation "public.vehicles" does not exist` | `sql/schema.sql` was not run, or was run in a different project. |
| "new row violates row-level security policy" | `sql/policies.sql` was not run, or you are not logged in. |
| "Please confirm your email address first" | Click the confirmation email link, or turn off *Confirm email* (step 8). |
| Reset/confirmation link opens the wrong site or localhost | Fix **Site URL** and **Redirect URLs** (step 8). |
| "Email rate limit exceeded" | Supabase's built-in mailer is limited. Wait, or configure custom SMTP. |
| "This expense is linked to a fuel record" | Fuel, service and insurance rows are edited from their own module. The Edit button opens the right form for you. |
| Receipt upload fails | Run `policies.sql` (it creates the private `receipts` bucket). Images only, up to 5 MB. |
| Mileage shows "Estimated" | You have fewer than two consecutive **full-tank** fills. Tick *Full tank* on complete fill-ups. |
| A fuel row shows "Check odometer" | Its reading is lower than the previous one (probably a typo). Edit the entry to correct it. |
| Charts missing | The Chart.js CDN is blocked (offline/firewall). The numbers still work. |

## 16. How the calculations work

All rules live in `js/calculations.js` as small pure functions and are covered by `tests/calculations.test.mjs`. Values are kept at full precision and **rounded only for display**. Any calculation that would divide by zero, or use missing or invalid data, returns `null`, and the app shows "—".

| Value | Rule |
|---|---|
| **Petrol litres** | `Amount paid ÷ Price per litre` (₹658 ÷ ₹104 = 6.3269 → shown as 6.33 L). If you tick *Enter litres manually*, the pump-receipt litres are used instead for consumption, mileage and average price. The typed price per litre is still saved for the price-trend chart, and the form shows the effective price (amount ÷ litres) so you can spot typos. |
| **Distance travelled** | `Current odometer − previous valid odometer` **of the same vehicle**, e.g. 348.2 − 185 = **163.2 km**. The **first reading is a baseline** and is never counted as distance. A reading **lower** than the previous one is flagged *Check odometer*, gives no distance (never negative), and the next entry is measured from the last valid reading. Entries without a reading are skipped. |
| **Mileage (full-tank method)** | Between two consecutive **full-tank** fills: `(odometer at 2nd full − odometer at 1st full) ÷ litres added after the 1st full up to and including the 2nd` (partial top-ups in between count). Labelled **Full-tank**. |
| **Mileage (estimated)** | When there aren't two full-tank fills: `(last reading − first reading) ÷ litres bought from the first fill up to, but not including, the last one`. Labelled **Estimated**, because it assumes the tank level was similar at the first and last fill. Every purchase is never assumed to be a full tank. |
| **Average petrol price** | `Total amount ÷ total litres` (weighted, so a big fill counts more than a small one). |
| **Cost per km (per fuel row)** | `Amount of this fill ÷ distance since the previous fill`, the same as the spreadsheet's "Cost Per KM" column. |
| **Cost per km (overall)** | Selectable on the dashboard. **Fuel only:** `Petrol expenses ÷ distance`. **All running costs:** `(all expenses except Bike/Car Purchase) ÷ distance`. The rule in use is shown under the card. |
| **Ownership cost** | `Purchase cost + running expenses`. Purchase cost = your *Bike/Car Purchase* expenses if any, otherwise the purchase price saved on the vehicle. Never both, so it isn't double counted. |
| **Monthly running distance** | Each interval's distance is credited to the month of the later reading. The average per month is total distance ÷ months between the first and last reading. |
| **Date ranges** | The distance timeline is built from the **full history first** and filtered afterwards, so the first entry in a range keeps its distance. Mileage for a range also uses the full-tank fill just before the range as its starting point. |

**No double counting:** a fuel purchase is one row in `fuel_logs` *and* one linked row in `expenses`. Money totals are calculated **only** from `expenses`, and fuel statistics **only** from `fuel_logs`.

## 17. Database relationships and security

```
auth.users (Supabase)
   │ 1
   │ *
vehicles ──1───*── expenses  ◄── the single money ledger
   │                  ▲ 1
   │                  │ 0..1 (expense_id, ON DELETE CASCADE)
   ├──1───*── fuel_logs ─────────┤
   ├──1───*── maintenance_records ┤
   └──1───*── insurance_records ──┘
```

- Every table has `user_id` (default `auth.uid()`) and `created_at` / `updated_at`.
- **Linked expenses via triggers:** inserting/updating a fuel log, service record or insurance policy automatically creates/updates its row in `expenses` (category *Petrol*, *Servicing* or *Insurance*). Deleting either side deletes the other. A trigger blocks direct edits to linked expense rows, and a CHECK constraint means *Petrol* expenses can only come from the Fuel Tracker. One fact is stored in one place.
- **Ownership is enforced by the database itself:**
  - **Row Level Security** on all five tables: `select / insert / update / delete` are allowed only where `user_id = auth.uid()`. Anonymous visitors have no access at all.
  - **Composite foreign keys** `(vehicle_id, user_id) → vehicles(id, user_id)`: a record can only point at a vehicle owned by the *same* user. Changing an ID in the URL or in a request can never reach someone else's data. Another user's vehicle ID simply shows "Vehicle not found".
- **Constraints:** amounts and readings are `numeric` (never text) and non-negative; price and litres must be > 0; registration numbers are unique per user (case-insensitive); expiry must be after the start date; and so on.
- **Receipts:** private `receipts` bucket, files stored as `<user-id>/<random>.jpg`. Storage policies only allow access to your own folder, and images are shown with short-lived signed URLs.
- **Frontend safety:** all user text is inserted with `textContent` (the `h()` helper in `utils.js`), never `innerHTML`, which prevents XSS. CSV exports escape formula-like cells. Login redirects only go to pages of this site.
- Passwords are handled entirely by Supabase Auth (salted hashes). The app never stores them.

**What was tested:** the unit tests cover every calculation and import rule. `schema.sql` and `policies.sql` were run (twice) on a real PostgreSQL engine with stand-in `auth` and `storage` schemas. That check confirmed the triggers, the constraints, cascades both ways, and that a second user can't read, insert into, update or delete the first user's data. The storage policies were applied but not behaviour-tested, because they depend on Supabase's real storage service. Test them in your own project by uploading a receipt.

## 18. Explaining the project in a viva

**One-minute pitch:** *"I converted my Google Sheets vehicle tracker into a secure multi-user web app. The frontend is plain HTML, CSS and JavaScript modules. Supabase provides PostgreSQL, authentication and file storage. Each fuel entry calculates litres from amount ÷ price, distance from the odometer difference, and mileage between full-tank fills. Row Level Security in the database makes sure each user can only access their own rows."*

**Architecture (3 layers):**
1. *Presentation*: HTML pages + CSS; `layout.js`, `components.js` and `forms.js` build the UI.
2. *Logic*: `calculations.js` and `importer.js`, pure functions with unit tests.
3. *Data*: `api.js` talks to Supabase; PostgreSQL enforces constraints, triggers and RLS.

**Likely questions:**

- *Why no separate backend (Flask)?* Supabase already exposes a secure REST API, and RLS enforces authorisation inside the database. A Flask layer would add code without adding security.
- *Isn't the API key in the browser a risk?* It's the publishable key, which is meant to be public. The secret key is never in the frontend. Even with the public key, RLS only returns the logged-in user's rows.
- *How do you prevent double counting fuel?* Money totals use only `expenses`; litres and mileage use only `fuel_logs`. A trigger keeps the two in sync, and a constraint stops manual *Petrol* expenses.
- *Why isn't the first odometer reading counted?* It's where the vehicle already was when tracking began, not a distance driven during tracking. Counting it would inflate the distance and make cost per km too low.
- *Why the full-tank method?* With partial fills you don't know how much fuel was actually burnt. Between two full tanks the fuel burnt equals the fuel added, so km/L is exact. Otherwise the app labels the figure *Estimated*.
- *What if someone types a wrong odometer reading?* The form warns before saving, the entry is flagged *Check odometer*, it's excluded from distance (never negative), and it can be edited.
- *How did you prevent XSS?* User data is only ever set via `textContent`/DOM nodes, never `innerHTML`.
- *How is the CSV import safe?* Each row is validated (date, amount, price/litres). Summary rows without a date are skipped, duplicates (same vehicle, date, amount and description) are detected, and you confirm before anything is written.
- *How did you test it?* `npm test` runs the unit tests (litres, distance, baseline, odometer decrease, full-tank vs estimated mileage, date ranges, cost per km, CSV parsing). The SQL was tested for RLS isolation between two users.

**Demo script:** sign up → add a bike → add fuel ₹658 at ₹104/L (show 6.33 L) with odometer 185 (baseline) → add a second fill at 348.2 km (show 163.2 km and cost/km) → mark two full tanks to show mileage → import `assets/sample-import.csv` → dashboard and monthly report → log in as a second user to show the data is isolated.

---

### Optional demo data

There is no SQL seed script that writes fake statistics. For demo data, import `assets/sample-import.csv` from the **Import CSV** page into a vehicle. It contains a purchase, five fuel fills (some with pump litres, some calculated), accessories and insurance, a ₹0 free-service row (rejected by validation) and three spreadsheet summary rows (skipped), so it also shows off the validation.

### Limitations / possible extensions

- Reminders appear inside the app only. No email or push notifications are sent.
- Fuel fields are labelled *Petrol*, as in the original sheet, but work for any liquid fuel. EV charging isn't modelled separately.
- Possible next steps: email reminders through a Supabase Edge Function plus a cron job, PDF report export, dark mode, and offline support (PWA).

---

## Own Java server (no Supabase): Spring Boot + own database

The `backend-api/` folder is our **own backend**. It's a Java Spring Boot server with its own H2 database, which replaces Supabase. Run `backend-api/run.sh` and open **http://localhost:8081**. The same server serves:
- the website;
- its own login system (`/api/auth/*`, with BCrypt password hashes and session tokens);
- its own data API (`/api/app/*`);
- an admin dashboard listing all users and entries (`/admin.html`);
- Swagger documentation (`/swagger-ui.html`).

See [backend-api/README.md](backend-api/README.md). When the website is served by this server, `js/supabase-client.js` automatically uses `js/api-backend.js` (own API) instead of Supabase.
