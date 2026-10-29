---
name: mendix-screens-shop
description: Products, stock and orders - 7 ready Mendix screen templates with sketches (createScreen). Keywords: products, ürün, catalog, stock, stok, orders, sipariş, invoice.
---

CATEGORY shop: Products, stock and orders (7 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. shop.catalog - Product catalog: products as cards with price; search on top
```
┌ Product catalog────────────────────────────┐
│PRODUCTS                     [ + New produc…│
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

2. shop.stock - Stock table: products with stock and price in a table; export
```
┌ Stock table────────────────────────────────┐
│STOCK                                       │
│Products and quantities                     │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

3. shop.orders - Order table: orders with number, date, total and status; status filter
```
┌ Order table────────────────────────────────┐
│ORDERS                       [ + New order ]│
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

4. shop.order - Order with lines: an order header (number, date, status) and its lines below
```
┌ Order with lines───────────────────────────┐
│‹NAME›                       [‹Status›]     │
│‹Date›                                      │
│‹Amount›                                    │
│┌──────────────────────────────────────────┐│
││Lines                                     ││
││‹Description›               ‹Price›       ││
││····················                      ││
││‹Description›               ‹Price›       ││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, child, link, lineText, lineAmount?

5. shop.product - Product page: product name, big price, stock and the details; Edit
```
┌ Product page───────────────────────────────┐
│‹NAME›                    ┌───────────────┐ │
│‹Detail›                  │‹PRICE›        │ │
│                          │In stock: ‹Sto…│ │
│                          │[ Edit ]       │ │
│                          └───────────────┘ │
│┌──────────────────────────────────────────┐│
││Name          ‹Name›                      ││
││Detail        ‹Detail›                    ││
││Date          ‹Date›                      ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount, cols, fields, edit?, qty

6. shop.lowStock - Low stock: products with fewer than 10 in stock, as rows
```
┌ Low stock──────────────────────────────────┐
│LOW STOCK                                   │
│Fewer than 10 left                          │
│┌──────────────────────────────────────────┐│
││‹Name›                      ‹Stock›       ││
││‹Detail›                                  ││
││····················                      ││
││‹Name›                      ‹Stock›       ││
││‹Detail›                                  ││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount, cols, fields, edit?, qty

7. shop.orderCards - Orders as cards: orders as cards with total and status (3/2/1)
```
┌ Orders as cards────────────────────────────┐
│ORDERS                       [ + New order ]│
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

