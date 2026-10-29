---
name: mendix-screens
description: Catalog of ready Mendix screen templates (createScreen) - the router: which category has which screens. Use it when the user asks for a screen or page; then open the category file and let the user pick a sketch.
---

# Screen catalog

SCREEN CATALOG: pick a category, then: python mx.py screens <category>

| Category | Templates | Use for (keywords) |
|---|---|---|
| dash | 7 | Dashboards: dashboard, kpi, stats, özet, overview, home |
| report | 5 | Reports and charts: report, rapor, chart, grafik, trend, pie |
| settings | 4 | Settings, profile, users: settings, ayarlar, profile, profil, preferences, users, kullanıcı |
| state | 6 | State screens: empty, error, success, 404, no access, maintenance, boş, hata |
| home | 3 | Home pages: home, ana sayfa, landing, start, menu |
| auth | 3 | Sign-in: login, giriş, sign in, oturum, password |
| native | 5 | Native mobile: native, mobile, mobil, telefon, app |
| request | 6 | Requests and approvals (leave, expenses, purchases): leave, izin, request, talep, approve, onay, reject, vacation |
| task | 5 | Tasks and to-dos: tasks, görev, todo, board, kanban, due, deadline |
| crm | 6 | Customers and sales (CRM): customers, müşteri, crm, pipeline, deals, fırsat, sales |
| shop | 7 | Products, stock and orders: products, ürün, catalog, stock, stok, orders, sipariş, invoice |
| doc | 3 | Documents and files: documents, doküman, files, dosya, upload, yükle |
| notice | 2 | Notifications: notifications, bildirim, messages, alerts, inbox |
| record | 14 | One record: details and forms: detail, details, form, edit, create, view, detay, form, düzenle |
| list | 12 | Lists of records: list, table, grid, overview, cards, liste, tablo, master detail |
| time | 10 | Time and attendance: clock in, clock out, mesai, giriş çıkış, timesheet, puantaj, hours, shift |

98 templates. Show the user 3-5 sketches of one category, let them pick a number, then createScreen.

## How to use it (always these steps)

1. Find the category of the request in the table above (its keywords).
2. Open guides/screens/<category>.md (or run `python mx.py screens <category>`).
3. Show the user 3-5 of its sketches, numbered, each with its one-line description. Ask which one (or ask about two
   that differ most first). Never build before the user picked a number.
4. Write `edits/<name>.json` with one createScreen: the template id, the user's module and page name, and the slots
   (at least the entity; attributes left out are guessed by type and listed in the dry run).
5. `python mx.py dryrun <name>.json`. Show the user the summary (and the guessed slots). After apply:
   `python mx.py preview <Module.Page>`.

Options of every template: "density": "compact" (tighter spacing), "cardClass": "acme-card" (the company kit's card),
"menu": "Responsive" (a menu item), "roles": ["Module.Role"].
