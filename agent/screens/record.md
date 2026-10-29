---
name: mendix-screens-record
description: One record: details and forms - 14 ready Mendix screen templates with sketches (createScreen). Keywords: detail, details, form, edit, create, view, detay, form, düzenle.
---

CATEGORY record: One record: details and forms (14 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. detail.sections - Details in cards: title and status on top, the fields as label/value rows in a card
```
┌ Details in cards───────────────────────────┐
│‹NAME›                       [ Edit ]       │
│[‹Status›]                                  │
│┌──────────────────────────────────────────┐│
││Details                                   ││
││Detail        ‹Detail›                    ││
││Date          ‹Date›                      ││
││Status        ‹Status›                    ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

2. detail.twoCards - Details in two cards: the fields split over two cards side by side; one under the other on phones
```
┌ Details in two cards───────────────────────┐
│‹NAME›                                      │
│┌───────────────────┐ ┌───────────────────┐ │
││General            │ │More               │ │
││Name  ‹Name›       │ │Date  ‹Date›       │ │
││Detail‹Detail›     │ │Status‹Status›     │ │
│└───────────────────┘ └───────────────────┘ │
│[ Edit ]                                    │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

3. detail.tabs - Details with tabs: a header and tabs: Overview (the main fields) and Details (the rest)
```
┌ Details with tabs──────────────────────────┐
│‹NAME›                       [ Edit ]       │
│‹Detail›                                    │
│[Overview]  Details                         │
│┌──────────────────────────────────────────┐│
││Name          ‹Name›                      ││
││Detail        ‹Detail›                    ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

4. detail.side - Details with side summary: the fields left (8/12), a summary card right with status, date and amount (4/12)
```
┌ Details with side summary──────────────────┐
│‹NAME›                                      │
│┌──────────────────────────┐ ┌────────────┐ │
││Name     ‹Name›           │ │Summary     │ │
││Detail   ‹Detail›         │ │[‹Status›]  │ │
││Date     ‹Date›           │ │‹Date›      │ │
││Status   ‹Status›         │ │‹Amount›    │ │
│└──────────────────────────┘ │[ Edit ]    │ │
│                             └────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

5. detail.related - Details with related list: the record on top and the records linked to it below (e.g. a customer and its orders)
```
┌ Details with related list──────────────────┐
│‹NAME›                                      │
│[‹Status›]                                  │
│┌───────────────┐ ┌───────────────────────┐ │
││Details        │ │Lines                  │ │
││Deta…‹Detail›  │ │‹LineName›             │ │
││Date ‹Date›    │ │····················   │ │
││Stat…‹Status›  │ │‹LineName›             │ │
│└───────────────┘ │…                      │ │
│                  └───────────────────────┘ │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, child, link, childTitle

6. form.twoColumns - Form, two columns: fields in pairs (one per row on phones), labels on top, Save / Cancel
```
┌ Form, two columns──────────────────────────┐
│EDIT ITEM                                   │
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

7. form.single - Form, one column: one field per row everywhere; short forms and phones
```
┌ Form, one column───────────────────────────┐
│       EDIT ITEM                            │
│       ┌──────────────────────────┐         │
│       │Name                      │         │
│       │[________________________]│         │
│       │Detail                    │         │
│       │[________________________]│         │
│       │Date                      │         │
│       │[________________________]│         │
│       │Status                    │         │
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

8. form.sections - Form in sections: the fields in titled cards (General / Details), Save at the end
```
┌ Form in sections───────────────────────────┐
│EDIT ITEM                                   │
│┌──────────────────────────────────────────┐│
││General                                   ││
││Name                 Detail               ││
││[__________________] [__________________] ││
│└──────────────────────────────────────────┘│
│┌──────────────────────────────────────────┐│
││Details                                   ││
││Date                 Status               ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

9. form.help - Form with help panel: the form left (8/12) and a help card right (4/12) that explains the fields
```
┌ Form with help panel───────────────────────┐
│EDIT ITEM                                   │
│┌──────────────────────────┐ Help           │
││Name         Detail       │ Fill in the fi…│
││[__________] [__________] │                │
││Date         Status       │                │
││[__________] [__________] │                │
││         [Cancel] [ Save ]│                │
│└──────────────────────────┘                │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, help?

10. form.steps - Form in numbered steps: the fields grouped as 1, 2, 3 on one page (step boxes), Save at the end
```
┌ Form in numbered steps─────────────────────┐
│NEW ITEM                                    │
│┌──────────────────────────────────────────┐│
││1. Basics                                 ││
││Name                 Status               ││
││[__________________] [__________________] ││
│└──────────────────────────────────────────┘│
│┌──────────────────────────────────────────┐│
││2. Details                                ││
││Detail                                    ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

11. form.popup - Quick edit pop-up: a pop-up (600 px, height auto) with a short form; for small edits
```
┌ Quick edit pop-up──────────────────────────┐
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

12. detail.hero - Details with header band: a coloured header band with title, status and Edit; the fields in a card below
```
┌ Details with header band───────────────────┐
│‹NAME›                       [ Edit ]       │
│‹Detail›                                    │
│[‹Status›]                                  │
│┌──────────────────────────────────────────┐│
││Detail        ‹Detail›                    ││
││Date          ‹Date›                      ││
││Status        ‹Status›                    ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

13. form.review - Review before confirm: a read-only summary of the record with Back and Confirm
```
┌ Review before confirm──────────────────────┐
│PLEASE REVIEW                               │
│Check the details, then confirm.            │
│┌──────────────────────────────────────────┐│
││Name          ‹Name›                      ││
││Detail        ‹Detail›                    ││
││Date          ‹Date›                      ││
││Status        ‹Status›                    ││
││                        [Back] [ Confirm ]││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

14. form.editableList - Edit many at once: an editable list: each row has inputs for its fields and a ✓ that saves the row
```
┌ Edit many at once──────────────────────────┐
│EDIT ITEMS                                  │
│┌──────────────────────────────────────────┐│
││Name       Detail     Date       [•]      ││
││[________] [________] [________]          ││
││····················                      ││
││Name       Detail     Date       [•]      ││
││[________] [________] [________]          ││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

