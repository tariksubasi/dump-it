---
name: mendix-screens-doc
description: Documents and files - 3 ready Mendix screen templates with sketches (createScreen). Keywords: documents, doküman, files, dosya, upload, yükle.
---

CATEGORY doc: Documents and files (3 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. doc.list - Document list: documents in a table; a row opens the document page
```
┌ Document list──────────────────────────────┐
│DOCUMENTS                      [ + Upload ] │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

2. doc.upload - Upload a document: title, category and the file upload in one card
```
┌ Upload a document──────────────────────────┐
│UPLOAD A DOCUMENT                           │
│┌──────────────────────────────────────────┐│
││Detail                                    ││
││[____________________________]            ││
││Date                                      ││
││[____________________________]            ││
││Status                                    ││
││[____________________________]            ││
││<fileManager>                             ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

3. doc.cards - Documents as cards: documents as cards with their category
```
┌ Documents as cards─────────────────────────┐
│DOCUMENTS                      [ + Upload ] │
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

