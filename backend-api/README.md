# Vehicle Expense Tracker: Own Java Server (Spring Boot + own database)

This folder contains our **own backend**: a Java Spring Boot server with its **own database**. It replaces Supabase completely. One server provides everything:

| URL | What it is |
|---|---|
| http://localhost:8081 | **The website** (all pages), now using our own API |
| `/api/auth/*` | **Own login system:** register, login, logout, change password |
| `/api/app/*` | **Own data API:** the logged-in user's vehicles, expenses, fuel logs, services and insurance |
| http://localhost:8081/admin.html | **Admin dashboard:** every user (sign-up and last-login time) and all entries |
| http://localhost:8081/swagger-ui.html | **API documentation** (Swagger) |
| http://localhost:8081/h2-console | **Database console:** browse the tables with SQL |

## Run it
Requirements: JDK 21 or newer and Maven 3.9+ (`run.sh` finds Maven automatically).
```bash
./run.sh
```
Then open http://localhost:8081, click **Sign up free**, and create an account.

- **Admin login** (admin page, Swagger, database console): `admin` / `admin12345`. Change it with `ADMIN_PASSWORD` in `.env`.
- **Database console:** use JDBC URL `jdbc:h2:file:./data/vehicle-tracker`, user `sa`, and an empty password.

## Our own database
- **Engine:** H2, a SQL database written in Java, stored as a file in `backend-api/data/vehicle-tracker.mv.db`. Data is kept between restarts. The `data/` folder is git-ignored.
- **Schema:** `src/main/resources/db/schema.sql` is created automatically on first start.
- **Tables:**
  - `auth.users`: email, name, **BCrypt password hash**, sign-up time, last login
  - `auth.sessions`: login sessions, storing only a SHA-256 hash of each token
  - `vehicles`, `expenses`, `fuel_logs`, `maintenance_records`, `insurance_records`
- **Database rules:** composite foreign keys (a record can only use the same user's vehicle), CHECK constraints (no negative amounts, valid categories, Petrol only from the Fuel Tracker), and ON DELETE CASCADE.

## How login works
1. **Register:** `POST /api/auth/register {email, password, fullName}`. The password must be 8+ characters with a letter and a number. It is stored only as a **BCrypt hash**.
2. **Log in:** `POST /api/auth/login {email, password}`. The server returns a random 256-bit **session token**, and the database stores only its SHA-256 hash.
3. **Use the token:** the website sends `Authorization: Bearer <token>` on every `/api/app/*` call. `TokenAuthenticationFilter` looks up the session and identifies the user.
4. **Log out:** `POST /api/auth/logout` deletes the session.

## Website data API
`{table}` is one of `vehicles`, `expenses`, `fuel_logs`, `maintenance_records` or `insurance_records`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/app/{table}` | List **my** rows (expenses include their fuel details) |
| POST | `/api/app/{table}` | Add one row (JSON object) or many (JSON array, used by CSV import) |
| PATCH | `/api/app/{table}/{id}` | Update one of my rows |
| DELETE | `/api/app/{table}/{id}` | Delete one of my rows |

**Business rules in `AppDataService.java`** (these replace the old database triggers and Row Level Security):
- Every query is limited to `user_id = <logged-in user>`. Other users' rows return 404.
- Writable columns are whitelisted per table.
- A fuel log, service or insurance policy automatically creates and updates **one linked expense** (Petrol, Servicing or Insurance). Linked expenses can't be edited directly, so nothing is counted twice.
- A higher odometer reading updates the vehicle's current odometer.
- Deleting a record deletes its linked expense. Deleting a vehicle deletes everything belonging to it.
- Registration numbers are unique per user (case-insensitive).

## Admin API (admin login, HTTP Basic)
`/api/stats`, `/api/users`, `/api/vehicles`, `/api/expenses` (filters: `userId`, `vehicleId`, `category`, `from`, `to`), `/api/fuel-logs`, `/api/maintenance`, `/api/insurance`. `/api/health` is public.

## Tests
```bash
mvn test
```
14 integration tests, run on an in-memory copy of the database (the `demo` profile):
- registration and login (duplicate email, weak password, wrong password);
- login required, and no browser pop-up for website calls;
- fuel entry creating a linked expense and updating the odometer;
- validation and cascades;
- one user cannot see or change another user's data;
- logout;
- the admin API.

## Code structure
```
backend-api/
├── run.sh                         Start the server (own database)
├── pom.xml                        Maven build; copies the website (../*.html, css, js, assets) into the server
└── src/main/java/com/vehicletracker/api/
    ├── auth/AuthService.java              Register / login / sessions (BCrypt, SHA-256 token hashes)
    ├── auth/TokenAuthenticationFilter.java  Reads "Bearer <token>" on each request
    ├── app/AppDataService.java            Per-user data + business rules
    ├── controller/AuthController.java     /api/auth/*
    ├── controller/AppDataController.java  /api/app/*
    ├── controller/ConfigController.java   /js/config.js tells the website to use this API
    ├── controller/UserController.java, EntryController.java, StatusController.java   Admin API
    ├── repository/TrackerRepository.java  Admin SQL queries
    ├── config/SecurityConfig.java         Who may access what
    └── exception/…                        JSON error responses
src/main/resources/
    ├── db/schema.sql                      Own database tables
    ├── application*.properties            Settings (local = file database, demo = in-memory for tests)
    └── static/admin.*                     Admin dashboard
```

On the website side, `js/api-backend.js` sends the website's data calls to this API. `js/supabase-client.js` picks it automatically when the page is served by this server.
