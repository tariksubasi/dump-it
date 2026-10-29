---
name: mendix-screens-native
description: Native mobile - 5 ready Mendix screen templates with sketches (createScreen). Keywords: native, mobile, mobil, telefon, app.
---

CATEGORY native: Native mobile (5 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. native.list - Native list: a list; tapping an item opens its page (one tap target per item)
```
┌ Native list────────────────────────────────┐
│‹Name›                                      │
│‹Detail›                                    │
│····················                        │
│‹Name›                                      │
│‹Detail›                                    │
│…                                           │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

2. native.form - Native form: a short form; the save button at the bottom of the form
```
┌ Native form────────────────────────────────┐
│Name                                        │
│[____________________________]              │
│Detail                                      │
│[____________________________]              │
│Date                                        │
│[____________________________]              │
│Status                                      │
│[____________________________]              │
│                           [Cancel] [ Save ]│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

3. native.detail - Native details: a read view of the record with an Edit button
```
┌ Native details─────────────────────────────┐
│‹Name›                                      │
│‹Detail›                                    │
│‹Date›                                      │
│‹Status›                                    │
│[Edit]                                      │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

4. native.clock - Native clock in/out: two big buttons for the phone app
```
┌ Native clock in/out────────────────────────┐
│Time clock                                  │
│[ Clock in ]                                │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, start, end

5. native.home - Native home buttons: big full-width buttons to the main native pages
```
┌ Native home buttons────────────────────────┐
│Home                                        │
│[Orders]                                    │
│[Tasks]                                     │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): p1?, p2?

