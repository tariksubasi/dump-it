---
name: mendix-screens-dash
description: Dashboards - 7 ready Mendix screen templates with sketches (createScreen). Keywords: dashboard, kpi, stats, özet, overview, home.
---

CATEGORY dash: Dashboards (7 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. dash.kpiList - Stats + recent list: 4 stat cards (total and per status) and the latest records
```
┌ Stats + recent list────────────────────────┐
│DASHBOARD                                   │
│At a glance                                 │
│┌────────────┐ ┌────────────┐ ┌───────────┐ │
││Total       │ │Open        │ │Done       │ │
││‹STAT1›     │ │‹STAT2›     │ │‹STAT3›    │ │
│└────────────┘ └────────────┘ └───────────┘ │
│┌──────────────────────────────────────────┐│
││Recent                                    ││
││‹Name›                      [‹Status›]    ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status, amount?, cols, fields, edit?

2. dash.split - Stats + list + actions: stats on top; recent records (8/12) and a quick actions card (4/12)
```
┌ Stats + list + actions─────────────────────┐
│DASHBOARD                                   │
│┌────────────┐ ┌────────────┐ ┌───────────┐ │
││Total       │ │Open        │ │Done       │ │
││‹STAT1›     │ │‹STAT2›     │ │‹STAT3›    │ │
│└────────────┘ └────────────┘ └───────────┘ │
│┌──────────────────────────┐ ┌────────────┐ │
││Recent                    │ │Quick actio…│ │
││‹Name›           [‹Status…│ │[ + New ite…│ │
││‹Detail›                  │ └────────────┘ │
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status, amount?, cols, fields, edit?

3. dash.table - Stats + full table: stats on top, the whole list as a table under them
```
┌ Stats + full table─────────────────────────┐
│OVERVIEW                     [ + New item ] │
│┌────────────┐ ┌────────────┐ ┌───────────┐ │
││Total       │ │Open        │ │Done       │ │
││‹STAT1›     │ │‹STAT2›     │ │‹STAT3›    │ │
│└────────────┘ └────────────┘ └───────────┘ │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status, amount?, cols, fields, edit?

4. dash.statusColumns - Status columns: a column per status with the latest records in it; stacked on phones
```
┌ Status columns─────────────────────────────┐
│BY STATUS                                   │
│┌───────────────────┐ ┌───────────────────┐ │
││Open               │ │Done               │ │
││‹Name›             │ │‹Name›             │ │
││‹Detail›           │ │‹Detail›           │ │
││···················│ │···················│ │
││‹Name›             │ │‹Name›             │ │
││‹Detail›           │ │‹Detail›           │ │
││…                  │ │…                  │ │
│└───────────────────┘ └───────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status, amount?, cols, fields, edit?

5. dash.chart - Stats + chart: stats on top and a column chart of the amount over the date (needs the Charts widget)
```
┌ Stats + chart──────────────────────────────┐
│DASHBOARD                                   │
│┌────────────┐ ┌────────────┐ ┌───────────┐ │
││Total       │ │Open        │ │Done       │ │
││‹STAT1›     │ │‹STAT2›     │ │‹STAT3›    │ │
│└────────────┘ └────────────┘ └───────────┘ │
│┌──────────────────────────────────────────┐│
││Trend                                     ││
││┌──────────────────────┐                  ││
│││column chart          │                  ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status, amount, cols, fields, edit?

6. dash.personal - My day: two cards side by side: my open items and my latest notifications
```
┌ My day─────────────────────────────────────┐
│MY DAY                                      │
│┌───────────────────┐ ┌───────────────────┐ │
││Tasks              │ │Notices            │ │
││‹Title›            │ │‹Message›          │ │
││···················│ │···················│ │
││‹Title›            │ │‹Message›          │ │
││…                  │ │…                  │ │
│└───────────────────┘ └───────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, second, secondTitle

7. dash.statsOnly - Big stats: only stat cards (total and per status), large and clear
```
┌ Big stats──────────────────────────────────┐
│NUMBERS                                     │
│┌────────────┐ ┌────────────┐ ┌───────────┐ │
││Total       │ │Open        │ │Done       │ │
││‹STAT1›     │ │‹STAT2›     │ │‹STAT3›    │ │
│└────────────┘ └────────────┘ └───────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status, amount?, cols, fields, edit?

