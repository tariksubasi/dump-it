---
name: mendix-screens-state
description: State screens - 6 ready Mendix screen templates with sketches (createScreen). Keywords: empty, error, success, 404, no access, maintenance, boş, hata.
---

CATEGORY state: State screens (6 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. state.empty - Empty state: nothing here yet: title, help text, one action
```
┌ Empty state────────────────────────────────┐
│       ┌──────────────────────────┐         │
│       │NOTHING HERE YET          │         │
│       │Add the first one to get …│         │
│       │[ Go back ]               │         │
│       └──────────────────────────┘         │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): none

2. state.success - Success: a confirmation after an action (sent, saved)
```
┌ Success────────────────────────────────────┐
│       ┌──────────────────────────┐         │
│       │ALL DONE                  │         │
│       │Your request was sent. Yo…│         │
│       │[ Go back ]               │         │
│       └──────────────────────────┘         │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): none

3. state.error - Something went wrong: an error page with a way back
```
┌ Something went wrong───────────────────────┐
│       ┌──────────────────────────┐         │
│       │SOMETHING WENT WRONG      │         │
│       │Please try again. If it k…│         │
│       │[ Go back ]               │         │
│       └──────────────────────────┘         │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): none

4. state.noAccess - No access: the user may not open this
```
┌ No access──────────────────────────────────┐
│       ┌──────────────────────────┐         │
│       │YOU DO NOT HAVE ACCESS    │         │
│       │Ask your administrator fo…│         │
│       │[ Go back ]               │         │
│       └──────────────────────────┘         │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): none

5. state.notFound - Not found: the page or record does not exist
```
┌ Not found──────────────────────────────────┐
│       ┌──────────────────────────┐         │
│       │WE COULD NOT FIND THAT    │         │
│       │It may have been moved or…│         │
│       │[ Go back ]               │         │
│       └──────────────────────────┘         │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): none

6. state.maintenance - Maintenance: the app is being updated
```
┌ Maintenance────────────────────────────────┐
│       ┌──────────────────────────┐         │
│       │WE'LL BE RIGHT BACK       │         │
│       │The app is being updated.…│         │
│       │[ Go back ]               │         │
│       └──────────────────────────┘         │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): none

