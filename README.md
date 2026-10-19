# Sample POS

A demo point-of-sale for a small gym: register, inventory, sales, expenses, payroll, analytics and staff logins.

**No backend.** The app's real database (the schema and patches in `supabase/`) runs inside the browser with [PGlite](https://pglite.dev) and is saved in IndexedDB. On first open it is filled with dummy data: about three months of sales, stock, bills, employees and pay runs. Each visitor gets their own copy; the ↺ button in the header resets it.

## Run

```
npm install
npm run dev
```

Sign in with one of the demo accounts on the login screen (password `demo1234`):

| Account | Role |
| --- | --- |
| admin@demo.test | admin: everything |
| sam@demo.test, jo@demo.test | staff: register and inventory |
| pat@demo.test | inactive: no access |

`npm run build` makes a static site in `dist/`; host it anywhere (`vercel.json` has the SPA rewrite for Vercel).

## How it fits together

- `src/lib/db.js` opens the in-browser database, builds it on first run and holds the reset.
- `src/lib/seed.js` makes the dummy data, through the same database functions the app uses.
- `src/lib/supabase.js` is a stand-in for the Supabase client: the pages call `supabase.from(...)`, `.rpc(...)`, `.auth`, `.storage` as usual and it answers from the local database, with row-level security applied for the signed-in demo user.
- `src/lib/staff.js` holds the admin account rules (add a login, reset a password) that would run on a server with a real backend.

To point it at a real Supabase project instead, swap `src/lib/supabase.js` back to `createClient(url, anonKey)` from `@supabase/supabase-js`, run `supabase/schema.sql` and the numbered patches in order, and move `staff.js` into a server function with the service-role key.

## What each part does

- **Register** (staff + admin): checkout, cash change, receipt.
- **Inventory** (staff + admin): receive deliveries, count shelves, write off spoilage, add and edit products and prices (admins can also delete). Stock only changes through these actions, and every change is in the product's History with who made it.
- **Sales**: every receipt with filters, cash-in-drawer totals, and voiding with a reason (admin).
- **Staff** (admin only): add logins with a temporary password, change access (admin, staff, inactive), set a new password. There is always at least one admin.
- **Expenses** (admin only): one-off expenses and a monthly-bills checklist (rent, electricity, water…), with optional receipt photos/PDFs. Never deleted: voided with a reason, and every edit is logged.
- **Payroll** (admin only): employees, pay runs from draft to finalized, SSS + PhilHealth + Pag-IBIG + BIR withholding settled month-to-date, editable rate tables with effective dates. Finalizing posts salaries and employer contributions to Expenses.
- **Reports** (admin only): Analytics › Download PDF for a sales & profit report; each pay run has a payslips PDF.
- **Analytics** (admin only): General, Merchandise, Memberships and Staff tabs for any date range.
- **Receipt printing**: optional, through a small local helper for ESC/POS printers (`public/helper/`). Without it, Print receipt just says the helper isn't running; the receipt still shows on screen.

## Tests

`npm test` runs every suite. `npm run test:demo` builds the demo database in memory and checks the Supabase stand-in; `npm run test:db` checks permissions, checkout, stock and reports in the schema itself; `npm run test:payroll`, `test:pdf`, `test:receipt` and `test:api` cover the rest.
