---
name: mendix-screens-time
description: Time and attendance - 10 ready Mendix screen templates with sketches (createScreen). Keywords: clock in, clock out, mesai, giriş çıkış, timesheet, puantaj, hours, shift.
---

CATEGORY time: Time and attendance (10 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. time.clock.big - Clock in/out with today's list: two big buttons left, today's entries right; stacked on phones
```
┌ Clock in/out with today's list─────────────┐
│TIME CLOCK                                  │
│Clock in when you start, clock out when you…│
│┌───────────────┐ ┌───────────────────────┐ │
││[ ▶ Clock in ] │ │Today                  │ │
││[■ Clock out]  │ │‹ClockIn› – ‹ClockOut› │ │
│└───────────────┘ │····················   │ │
│                  │‹ClockIn› – ‹ClockOut› │ │
│                  │…                      │ │
│                  └───────────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours?, kind?

2. time.clock.kiosk - Kiosk: two huge buttons: a shared screen at the door: only two large buttons, centred
```
┌ Kiosk: two huge buttons────────────────────┐
│           ┌───────────────────┐            │
│           │WELCOME            │            │
│           │Tap to clock in or…│            │
│           │[ ▶ Clock in ]     │            │
│           │[■ Clock out]      │            │
│           └───────────────────┘            │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours?, kind?

3. time.clock.compact - Compact clock bar: a slim bar with both buttons side by side and the last entries under it
```
┌ Compact clock bar──────────────────────────┐
│TIME                                        │
│Your entries today                          │
│┌──────────────────────────────────────────┐│
││[ ▶ Clock in ]       [■ Clock out]        ││
│└──────────────────────────────────────────┘│
│┌──────────────────────────────────────────┐│
││Latest                                    ││
││‹ClockIn› – ‹ClockOut›                    ││
││····················                      ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours?, kind?

4. time.clock.summary - Clock with hours summary: buttons, a card with the entries and their hours, a link to the full timesheet
```
┌ Clock with hours summary───────────────────┐
│MY TIME                                     │
│Clock in and see your hours                 │
│┌────────────┐ ┌──────────────────────────┐ │
││[ ▶ Clock i…│ │Entries                   │ │
││[■ Clock ou…│ │‹ClockIn›        ‹Hours› h│ │
│└────────────┘ │····················      │ │
│               │‹ClockIn›        ‹Hours› h│ │
│               │…                         │ │
│               └──────────────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours, kind?

5. time.timesheet.table - Timesheet table: all entries in a Data grid 2 with a date filter, hours column and export to Excel
```
┌ Timesheet table────────────────────────────┐
│TIMESHEET                                   │
│All time entries                            │
│[🔍 ClockIn]                                │
│ClockIn    ClockOut   Hours      Kind       │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours, kind?

6. time.timesheet.cards - Timesheet as cards: entries as cards (3 / 2 / 1 per row), good on phones
```
┌ Timesheet as cards─────────────────────────┐
│TIMESHEET                                   │
│┌───────────┐ ┌───────────┐ ┌───────────┐   │
││‹ClockIn›  │ │‹ClockIn›  │ │‹ClockIn›  │   │
││‹ClockIn› …│ │‹ClockIn› …│ │‹ClockIn› …│   │
││[‹Kind›]   │ │[‹Kind›]   │ │[‹Kind›]   │   │
│└───────────┘ └───────────┘ └───────────┘   │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours?, kind?

7. time.entry.form - Manual time entry: a form to add or correct an entry: start, end, kind; labels on top
```
┌ Manual time entry──────────────────────────┐
│TIME ENTRY                                  │
│┌──────────────────────────────────────────┐│
││Start *              End                  ││
││[_________________▦] [_________________▦] ││
││Kind                                      ││
││[____________________________]            ││
││                         [Cancel] [ Save ]││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end, hours?, kind?

8. time.shift.cards - Shifts as cards: upcoming shifts as cards (3/2/1), soonest first
```
┌ Shifts as cards────────────────────────────┐
│SHIFTS                                      │
│Upcoming                                    │
│┌───────────┐ ┌───────────┐ ┌───────────┐   │
││‹Role›     │ │‹Role›     │ │‹Role›     │   │
││‹StartTime…│ │‹StartTime…│ │‹StartTime…│   │
│└───────────┘ └───────────┘ └───────────┘   │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, start, end

9. time.shift.table - Shift roster table: all shifts in a table with a date filter and export
```
┌ Shift roster table─────────────────────────┐
│ROSTER                                      │
│[🔍 StartTime]                              │
│Role          StartTime     EndTime         │
│…             …             …               │
│…             …             …               │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, start, end

10. time.shift.list - Shift list (compact): shifts as compact rows in one card; good inside a dashboard
```
┌ Shift list (compact)───────────────────────┐
│MY SHIFTS                                   │
│┌──────────────────────────────────────────┐│
││‹Role›               ‹StartTime› – ‹EndTi…││
││····················                      ││
││‹Role›               ‹StartTime› – ‹EndTi…││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, start, end

