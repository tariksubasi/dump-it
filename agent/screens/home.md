---
name: mendix-screens-home
description: Home pages - 3 ready Mendix screen templates with sketches (createScreen). Keywords: home, ana sayfa, landing, start, menu.
---

CATEGORY home: Home pages (3 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. home.tiles - Home with tiles: a greeting and a tile per main page (4/2/1 per row)
```
┌ Home with tiles────────────────────────────┐
│WELCOME                                     │
│Where do you want to go?                    │
│┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
││Orders  │ │Custome…│ │Reports │ │Settings│ │
││[Open]  │ │[Open]  │ │[Open]  │ │[Open]  │ │
│└────────┘ └────────┘ └────────┘ └────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): greeting?, p1?, p2?, p3?, p4?

2. home.navList - Home with a link list: a greeting and a simple list of links (good on phones)
```
┌ Home with a link list──────────────────────┐
│WELCOME                                     │
│┌──────────────────────────────────────────┐│
││Orders  ›                                 ││
││Customers  ›                              ││
││Reports  ›                                ││
││Settings  ›                               ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): greeting?, p1?, p2?, p3?, p4?

3. home.welcome - Welcome with shortcuts: a greeting band and shortcut buttons as a row (stacked on phones)
```
┌ Welcome with shortcuts─────────────────────┐
│GOOD MORNING                                │
│What do you want to do today?               │
│[Orders]       [Customers]    [Reports]     │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): greeting?, p1?, p2?, p3?

