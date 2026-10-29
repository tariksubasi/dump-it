---
name: mendix-screens-report
description: Reports and charts - 5 ready Mendix screen templates with sketches (createScreen). Keywords: report, rapor, chart, grafik, trend, pie.
---

CATEGORY report: Reports and charts (5 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. report.columns - Column chart + table: a column chart of the amount per date, the records under it with export
```
┌ Column chart + table───────────────────────┐
│REPORT                                      │
│┌──────────────────────────────────────────┐│
││┌──────────────────────┐                  ││
│││column chart          │                  ││
│││▁▃▅▇▅▃                │                  ││
││└──────────────────────┘                  ││
│└──────────────────────────────────────────┘│
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status?, amount, cols, fields, edit?

2. report.line - Trend line: a line chart of the amount over time in a wide card
```
┌ Trend line─────────────────────────────────┐
│TREND                                       │
│┌──────────────────────────────────────────┐│
││┌──────────────────────┐                  ││
│││line chart            │                  ││
│││▁▃▅▇▅▃                │                  ││
││└──────────────────────┘                  ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status?, amount, cols, fields, edit?

3. report.pie - Share per record: a pie chart of the amount per record next to the top list
```
┌ Share per record───────────────────────────┐
│SHARE                                       │
│┌───────────────────┐ ┌───────────────────┐ │
││┌─────────────────┐│ │Top                │ │
│││pie chart        ││ │‹Name›       [‹Sta…│ │
│││▁▃▅▇▅▃           ││ │‹Detail›           │ │
││└─────────────────┘│ │···················│ │
│└───────────────────┘ │‹Name›       [‹Sta…│ │
│                      │‹Detail›           │ │
│                      │…                  │ │
│                      └───────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status?, amount, cols, fields, edit?

4. report.area - Area chart: an area chart of the amount over time
```
┌ Area chart─────────────────────────────────┐
│VOLUME                                      │
│┌──────────────────────────────────────────┐│
││┌──────────────────────┐                  ││
│││area chart            │                  ││
│││▁▃▅▇▅▃                │                  ││
││└──────────────────────┘                  ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status?, amount, cols, fields, edit?

5. report.bar - Bar chart + list: a bar chart and the records next to it
```
┌ Bar chart + list───────────────────────────┐
│COMPARE                                     │
│┌───────────────────────┐ ┌───────────────┐ │
││┌─────────────────────┐│ │Records        │ │
│││bar chart            ││ │‹Name›         │ │
│││▁▃▅▇▅▃               ││ │···············│ │
││└─────────────────────┘│ │‹Name›         │ │
│└───────────────────────┘ │…              │ │
│                          └───────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date, status?, amount, cols, fields, edit?

