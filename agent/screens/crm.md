---
name: mendix-screens-crm
description: Customers and sales (CRM) - 6 ready Mendix screen templates with sketches (createScreen). Keywords: customers, müşteri, crm, pipeline, deals, fırsat, sales.
---

CATEGORY crm: Customers and sales (CRM) (6 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. crm.customers - Customer table: customers with search, segment filter and export
```
┌ Customer table─────────────────────────────┐
│CUSTOMERS                    [ + New custom…│
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

2. crm.customerCards - Customer cards: customers as contact cards (3/2/1)
```
┌ Customer cards─────────────────────────────┐
│CUSTOMERS                    [ + New custom…│
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

3. crm.pipeline - Pipeline by stage: a column per stage with its deals as cards (a board); stacked on phones
```
┌ Pipeline by stage──────────────────────────┐
│PIPELINE                     [ + New deal ] │
│┌───────────────────┐ ┌───────────────────┐ │
││Open               │ │Done               │ │
││‹Name›             │ │‹Name›             │ │
││‹Detail›           │ │‹Detail›           │ │
││‹Date›             │ │‹Date›             │ │
││‹Amount›           │ │‹Amount›           │ │
││···················│ │···················│ │
││‹Name›             │ │‹Name›             │ │
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, stage

4. crm.deals - Deals with stage tabs: deals in tabs per stage, each a table
```
┌ Deals with stage tabs──────────────────────┐
│DEALS                        [ + New deal ] │
│[Open]  Done                                │
│[🔍 Search]                                 │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, stage

5. crm.customer360 - Customer 360: customer details, its deals and a New deal button on one page
```
┌ Customer 360───────────────────────────────┐
│‹NAME›                       [ Edit ]       │
│[‹Status›]                                  │
│┌────────────┐ ┌──────────────────────────┐ │
││Contact     │ │Deals                     │ │
││Det…‹Detail›│ │‹Title›                   │ │
││Date‹Date›  │ │····················      │ │
││Sta…‹Status›│ │‹Title›                   │ │
│└────────────┘ │…                         │ │
│               └──────────────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, child, link, childTitle

6. crm.dealForm - Deal form: a deal: title, amount, stage and close date in pairs
```
┌ Deal form──────────────────────────────────┐
│DEAL                                        │
│┌──────────────────────────────────────────┐│
││Name                 Detail               ││
││[__________________] [__________________] ││
││Date                 Status               ││
││[__________________] [__________________] ││
││                         [Cancel] [ Save ]││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

