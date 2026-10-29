---
name: mendix-screens-request
description: Requests and approvals (leave, expenses, purchases) - 6 ready Mendix screen templates with sketches (createScreen). Keywords: leave, izin, request, talep, approve, onay, reject, vacation.
---

CATEGORY request: Requests and approvals (leave, expenses, purchases) (6 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. request.form - Request form: a request with dates and reason; Submit sets the status
```
┌ Request form───────────────────────────────┐
│NEW REQUEST                                 │
│Fill in the dates and the reason, then subm…│
│┌──────────────────────────────────────────┐│
││Name                 Detail               ││
││[__________________] [__________________] ││
││Date                                      ││
││[____________________________]            ││
││                       [Cancel] [ Submit ]││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount?, cols, fields, edit?

2. request.mine - My requests: my requests as cards with their status label; New request on top
```
┌ My requests────────────────────────────────┐
│MY REQUESTS                  [ + New reques…│
│[🔍 Search]                                 │
│┌───────────┐ ┌───────────┐ ┌───────────┐   │
││‹Name›     │ │‹Name›     │ │‹Name›     │   │
││‹Detail›   │ │‹Detail›   │ │‹Detail›   │   │
││‹FromDate› │ │‹FromDate› │ │‹FromDate› │   │
││‹Amount›   │ │‹Amount›   │ │‹Amount›   │   │
││[‹Status›] │ │[‹Status›] │ │[‹Status›] │   │
│└───────────┘ └───────────┘ └───────────┘   │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount?, cols, fields, edit?

3. request.approve - Approve requests: submitted requests as rows with Approve and Reject buttons
```
┌ Approve requests───────────────────────────┐
│APPROVALS                                   │
│Requests waiting for you                    │
│┌──────────────────────────────────────────┐│
││‹Name›               ‹FromDate› [Approve] ││
││‹Detail›             ‹Amount›   [Reject]  ││
││····················                      ││
││‹Name›               ‹FromDate› [Approve] ││
││‹Detail›             ‹Amount›   [Reject]  ││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount?, cols, fields, edit?

4. request.overview - Requests by status: counts per status on top (stat cards), all requests below in a table
```
┌ Requests by status─────────────────────────┐
│REQUESTS                     [ + New reques…│
│┌───────────────────┐ ┌───────────────────┐ │
││Open               │ │Done               │ │
││‹STAT1›            │ │‹STAT2›            │ │
│└───────────────────┘ └───────────────────┘ │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount?, cols, fields, edit?

5. request.history - Request history: all my requests as rows: dates, status label; newest first
```
┌ Request history────────────────────────────┐
│REQUEST HISTORY              [ + New reques…│
│┌──────────────────────────────────────────┐│
││‹Name›                   [‹Status›]       ││
││‹Detail›                 ‹FromDate›       ││
││                         ‹Amount›         ││
││····················                      ││
││‹Name›                   [‹Status›]       ││
││‹Detail›                 ‹FromDate›       ││
││                         ‹Amount›         ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount?, cols, fields, edit?

6. request.table - Requests table (HR): every request in a table with status filter and export; for HR
```
┌ Requests table (HR)────────────────────────┐
│ALL REQUESTS                                │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount?, cols, fields, edit?

