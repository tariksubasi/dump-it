---
name: mendix-screens-task
description: Tasks and to-dos - 5 ready Mendix screen templates with sketches (createScreen). Keywords: tasks, görev, todo, board, kanban, due, deadline.
---

CATEGORY task: Tasks and to-dos (5 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. task.inbox - Task inbox: open tasks as rows with a ✓ button; done ones hidden
```
┌ Task inbox─────────────────────────────────┐
│MY TASKS                     [ + New task ] │
│What is open                                │
│┌──────────────────────────────────────────┐│
││‹Name›                          [•]       ││
││‹Detail›                                  ││
││····················                      ││
││‹Name›                          [•]       ││
││‹Detail›                                  ││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, done, priority?

2. task.board - Task board by priority: a column per priority (as a board), each with its open tasks; stacked on phones
```
┌ Task board by priority─────────────────────┐
│BOARD                        [ + New task ] │
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
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, done, priority

3. task.today - Due soon: tasks due in the next 7 days, sorted by date
```
┌ Due soon───────────────────────────────────┐
│DUE SOON                                    │
│The next 7 days                             │
│┌──────────────────────────────────────────┐│
││‹Name›                      ‹Date›        ││
││‹Detail›                    ‹Amount›      ││
││····················                      ││
││‹Name›                      ‹Date›        ││
││‹Detail›                    ‹Amount›      ││
││…                                         ││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, done, priority?

4. task.cards - Tasks as cards: open tasks as cards with their due date (3/2/1)
```
┌ Tasks as cards─────────────────────────────┐
│TASKS                        [ + New task ] │
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
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, done

5. task.detail - Task details: a task with its description and a Done check box; Save
```
┌ Task details───────────────────────────────┐
│‹NAME›                                      │
│‹Date›                                      │
│‹Amount›                                    │
│┌──────────────────────────────────────────┐│
││Detail                                    ││
││[____________________________]            ││
││Date                                      ││
││[____________________________]            ││
││Status                                    ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, done

