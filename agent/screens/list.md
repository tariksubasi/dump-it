---
name: mendix-screens-list
description: Lists of records - 12 ready Mendix screen templates with sketches (createScreen). Keywords: list, table, grid, overview, cards, liste, tablo, master detail.
---

CATEGORY list: Lists of records (12 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. list.table - Table with search: header + Data grid 2 with a search box and a status filter; row click opens the edit page
```
┌ Table with search──────────────────────────┐
│ITEMS                        [ + New item ] │
│Search, filter and open                     │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

2. list.tableExport - Table with export: as the table, with an Export to Excel button above it
```
┌ Table with export──────────────────────────┐
│ITEMS                        [ + New item ] │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

3. list.tableCard - Table in a card: the table on a raised card with a section title; calm for dashboards
```
┌ Table in a card────────────────────────────┐
│ITEMS                        [ + New item ] │
│┌──────────────────────────────────────────┐│
││All records                               ││
││[🔍 Search] [🔍 Status]                   ││
││Name      Detail    Date      Status      ││
││…         …         …         …           ││
││…         …         …         …           ││
││                                 ‹ 1 2 ›  ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

4. list.cards - Cards 3/2/1: cards that wrap: 3 per row on desktop, 2 on tablet, 1 on phone; best for end users
```
┌ Cards 3/2/1────────────────────────────────┐
│ITEMS                        [ + New item ] │
│[🔍 Search]                                 │
│┌───────────┐ ┌───────────┐ ┌───────────┐   │
││‹Name›     │ │‹Name›     │ │‹Name›     │   │
││‹Detail›   │ │‹Detail›   │ │‹Detail›   │   │
││‹Date›     │ │‹Date›     │ │‹Date›     │   │
││‹Amount›   │ │‹Amount›   │ │‹Amount›   │   │
││[‹Status›] │ │[‹Status›] │ │[‹Status›] │   │
│└───────────┘ └───────────┘ └───────────┘   │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

5. list.cardsWide - Wide cards 2/1: two large cards per row, one on tablet and phone; room for more text
```
┌ Wide cards 2/1─────────────────────────────┐
│ITEMS                        [ + New item ] │
│[🔍 Search]                                 │
│┌───────────────────┐ ┌───────────────────┐ │
││‹Name›             │ │‹Name›             │ │
││‹Detail›           │ │‹Detail›           │ │
││‹Date›             │ │‹Date›             │ │
││‹Amount›           │ │‹Amount›           │ │
││[‹Status›]         │ │[‹Status›]         │ │
│└───────────────────┘ └───────────────────┘ │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

6. list.cardsDense - Small cards 4/2/1: four small cards per row for many records
```
┌ Small cards 4/2/1──────────────────────────┐
│ITEMS                        [ + New item ] │
│[🔍 Search]                                 │
│┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
││‹Name›  │ │‹Name›  │ │‹Name›  │ │‹Name›  │ │
││‹Detail›│ │‹Detail›│ │‹Detail›│ │‹Detail›│ │
││‹Date›  │ │‹Date›  │ │‹Date›  │ │‹Date›  │ │
││‹Amount›│ │‹Amount›│ │‹Amount›│ │‹Amount›│ │
││[‹Statu…│ │[‹Statu…│ │[‹Statu…│ │[‹Statu…│ │
│└────────┘ └────────┘ └────────┘ └────────┘ │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

7. list.rows - Rows with a ⋮ menu: one row per record: title, status, and a menu with Edit / Delete
```
┌ Rows with a ⋮ menu─────────────────────────┐
│ITEMS                        [ + New item ] │
│┌──────────────────────────────────────────┐│
││‹Name›                   [‹Status›] ⋮     ││
││‹Detail›                 ‹Date›           ││
││                         ‹Amount›         ││
││····················                      ││
││‹Name›                   [‹Status›] ⋮     ││
││‹Detail›                 ‹Date›           ││
││                         ‹Amount›         ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

8. list.masterDetail - Master-detail: a list left (4/12) and the selected record right (8/12); stacked on phones
```
┌ Master-detail──────────────────────────────┐
│ITEMS                        [ + New item ] │
│┌────────────┐ ┌──────────────────────────┐ │
││‹Name›      │ │‹NAME›                    │ │
││‹Detail›    │ │‹Detail›                  │ │
││············│ │[‹Status›]                │ │
││‹Name›      │ │Detail   ‹Detail›         │ │
││‹Detail›    │ │Date     ‹Date›           │ │
││…           │ │Status   ‹Status›         │ │
│└────────────┘ │[Edit]                    │ │
│               └──────────────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

9. list.statusTabs - Tabs per status: a tab with all records and one tab per status value
```
┌ Tabs per status────────────────────────────┐
│ITEMS                        [ + New item ] │
│[All]  Open   Done                          │
│‹Name›                    [‹Status›] ⋮      │
│‹Detail›                  ‹Date›            │
│                          ‹Amount›          │
│····················                        │
│‹Name›                    [‹Status›] ⋮      │
│‹Detail›                  ‹Date›            │
│                          ‹Amount›          │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status, amount?, cols, fields, edit?

10. list.searchHero - Search first: a big title and search on top, cards under it; for finding one record fast
```
┌ Search first───────────────────────────────┐
│FIND ITEM                                   │
│Type a name to search                       │
│[🔍 Search]                                 │
│┌───────────┐ ┌───────────┐ ┌───────────┐   │
││‹Name›     │ │‹Name›     │ │‹Name›     │   │
││‹Detail›   │ │‹Detail›   │ │‹Detail›   │   │
││‹Date›     │ │‹Date›     │ │‹Date›     │   │
││‹Amount›   │ │‹Amount›   │ │‹Amount›   │   │
││[‹Status›] │ │[‹Status›] │ │[‹Status›] │   │
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

11. list.plainRows - Plain rows: rows without a card or menu; the lightest list
```
┌ Plain rows─────────────────────────────────┐
│ITEMS                        [ + New item ] │
│‹Name›                    [‹Status›]        │
│‹Detail›                  ‹Date›            │
│                          ‹Amount›          │
│····················                        │
│‹Name›                    [‹Status›]        │
│‹Detail›                  ‹Date›            │
│                          ‹Amount›          │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

12. list.tableSide - Table + help card: the table (9/12) and a card with a short explanation and New (3/12)
```
┌ Table + help card──────────────────────────┐
│ITEMS                                       │
│[🔍 Search] [🔍 Status]          ┌────────┐ │
│Name    Detail  Date    Status   │About   │ │
│…       …       …       …        │All ite…│ │
│…       …       …       …        │[ + New…│ │
│                       ‹ 1 2 ›   └────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

