# Shop Inventory

A complete inventory management web app for a retail shop: products, stock
movements with a full audit trail, a point-of-sale screen, suppliers, reports
and multi-user access.

Runs on plain Node.js with a Postgres database. There is no build step and no
native compilation — `npm install` then `npm start`.

---

## Quick start

```bash
npm install
createdb shop_dev                  # any Postgres you can reach
cp .env.example .env               # then set DATABASE_URL and JWT_SECRET
npm start
```

Open <http://localhost:3000> and sign in:

| Username | Password   |
| -------- | ---------- |
| `admin`  | `admin123` |

**Change that password from Settings before anyone else can reach the app.**

The first run creates the schema, an admin account, and a small demo
catalogue (16 products, 5 categories, 3 suppliers) so the screens aren't empty.
To start completely empty instead:

```bash
SKIP_DEMO_DATA=1 npm start
```

---

## What it does

**Dashboard** — stock value, today's and this month's sales and profit, a
14-day revenue chart, low-stock alerts, top sellers, recent activity, and stock
value broken down by category.

**Products** — full catalogue with search across name/SKU/barcode, filters by
category, supplier and stock level, sortable columns, and paging. Each product
carries a cost price, selling price, reorder level, unit, shelf location and
barcode. Opening a product shows its margin and complete stock history.

**New Sale (point of sale)** — search or scan a barcode, build a cart, apply a
discount and tax, and complete the sale. Stock is decremented atomically and a
printable receipt is produced. Overselling is rejected before anything is
written.

**Stock** — every quantity change is recorded: stock in (deliveries), stock out
(damage, loss, internal use), stocktake adjustments, sales and returns. Each
row keeps the before and after quantity, a reference, a note and the user who
did it. Filter by product, type or date range.

**Sales** — invoice history with search and date filters. Open any invoice to
see its lines and profit, reprint the receipt, or void it — voiding returns
every line to stock and keeps the invoice on record marked as voided.

**Categories & Suppliers** — organise the catalogue and keep supplier contact
details alongside the products and stock value you hold from each.

**Reports** — stock valuation (cost vs retail vs potential profit), a reorder
list with suggested quantities and estimated cost grouped by supplier, and a
sales & profit report over any date range. Everything exports to CSV.

**Users & Settings** — three roles, shop name, currency symbol and default tax
rate.

### Roles

| Role      | Can do                                                       |
| --------- | ------------------------------------------------------------ |
| `admin`   | Everything, including managing users and settings            |
| `manager` | Everything except user management                            |
| `staff`   | Record sales and stock movements; cannot edit the catalogue   |

---

## Project layout

```
server.js              Express app, route mounting, error handling
src/
  db.js                Schema, indexes, settings, transaction helper
  auth.js              scrypt password hashing, JWT cookie sessions, guards
  helpers.js           Input validation and the HTTP error type
  seed.js              Default admin + demo catalogue
  routes/              One router per resource
public/
  index.html           App shell (login gate + SPA)
  css/app.css          Design tokens and all styling
  js/api.js            Fetch wrapper
  js/ui.js             Escaping, formatting, modals, toasts, charts
  js/app.js            Hash router and session handling
  js/views/            One module per screen
api/index.js           Vercel serverless entry point
vercel.json            Routes every request to the app
```

---

## Database

Nine tables: `users`, `settings`, `categories`, `suppliers`, `products`,
`stock_movements`, `sales`, `sale_items`.

Two rules the schema enforces:

1. **`products.quantity` is never edited directly.** It only moves through
   `/api/stock` and the sales endpoint, and every change writes a
   `stock_movements` row recording the before and after values. The stock
   history always reconciles with the current quantity.

2. **Multi-step writes are transactional.** A sale that touches five products
   either commits every line and every stock decrement, or none of them. A sale
   that runs out of stock on its last line leaves the database untouched.

Products that appear on past invoices are archived rather than deleted, so
invoice history never changes retroactively.

### Backup

```bash
pg_dump "$DATABASE_URL" > shop-$(date +%F).sql
```

On Supabase, daily backups are taken for you (Project Settings → Database →
Backups). Or use the CSV exports in Settings → Data & backup.

---

## Configuration

Copy `.env.example` to `.env` (`npm start` already reads it). `JWT_SECRET` is
generated for you on first setup; if you deploy this anywhere, set your own:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Variable         | Default          | Purpose                                  |
| ---------------- | ---------------- | ---------------------------------------- |
| `PORT`           | `3000`           | Port to listen on                        |
| `JWT_SECRET`     | —                | Signs session cookies. Change it.        |
| `SESSION_HOURS`  | `12`             | How long a login lasts                   |
| `DATABASE_URL`   | —                | Postgres connection string. Required.    |
| `SHOP_TZ`        | `Asia/Dhaka`     | Decides when "today" rolls over          |
| `ADMIN_PASSWORD` | —                | First admin's password; random if unset  |
| `DATABASE_SSL`   | auto             | `on`/`off` to override TLS detection     |
| `NODE_ENV`       | `development`    | Set to `production` for secure cookies   |

---

## Scripts

| Command         | What it does                                          |
| --------------- | ----------------------------------------------------- |
| `npm start`     | Run the server                                         |
| `npm run dev`   | Run with auto-restart on file changes                  |
| `npm run seed`  | Seed an empty database                                 |
| `npm run reset` | **Wipe all data** and re-seed from scratch             |
| `npm run convert-currency` | Re-price an existing database into another currency |

---

## Currency

The app ships set to Bangladeshi Taka (**৳**) with South Asian lakh grouping,
so amounts read as `৳1,23,456.78`. The demo catalogue is priced at typical
Bangladeshi retail levels.

Change the symbol and grouping any time in **Settings → Shop details**. A live
preview shows the effect before you save. Three grouping styles are available:

| Setting  | Renders as     |
| -------- | -------------- |
| `en-IN`  | `৳1,23,456.78` (lakh grouping — the default) |
| `en-US`  | `৳123,456.78`  |
| `bn-BD`  | `৳১,২৩,৪৫৬.৭৮` (Bengali digits) |

### Converting a database that already holds prices

Changing the symbol in Settings only changes the label — it does not touch the
numbers. If your products are already priced in another currency, convert the
stored values:

```bash
npm run convert-currency -- --rate 122.5           # preview, writes nothing
npm run convert-currency -- --rate 122.5 --apply   # actually convert
```

Set `--rate` to the exchange rate you want to apply (old currency → new). This
multiplies every stored money value — product cost and selling prices, past
invoice totals and line items, and the unit costs recorded on stock movements —
so historical sales stay comparable with new ones in your reports. Pass
`--symbol` and `--locale` to override the Taka defaults.

Back up the database before running it with `--apply`; there is no undo.

---

## Deploying

The app runs anywhere Node does. It is also set up for Vercel, where
`api/index.js` serves the Express app as a serverless function and
`vercel.json` routes every path to it.

Because serverless instances start cold and share nothing, the database must
be a hosted Postgres rather than a local file. Supabase's free tier works;
use its **pooled** connection string (port 6543), not the direct one — many
short-lived function instances would otherwise exhaust the connection limit.

```bash
vercel env add DATABASE_URL production   # the pooled Supabase URI
vercel env add JWT_SECRET production     # 48 random bytes, hex
vercel env add NODE_ENV production       # "production"
vercel --prod
```

The schema is created and the admin seeded on the first request, guarded by a
Postgres advisory lock so several cold instances cannot seed twice.

Set `ADMIN_PASSWORD` before the first deploy to choose the admin password;
without it a random one is generated and printed once to the function log.

---

## Notes on security

Passwords are hashed with scrypt and a per-user salt, and compared in constant
time. Sessions are signed JWTs in an `httpOnly`, `sameSite=lax` cookie, and the
user record is re-read on every request so deactivating an account takes effect
immediately. All SQL uses bound parameters, and every value rendered into the
page is HTML-escaped.

Two things to do before putting this on a public network: set a real
`JWT_SECRET`, and put it behind HTTPS with `NODE_ENV=production` so session
cookies are marked secure.
