---
name: mendix-screens-notice
description: Notifications - 2 ready Mendix screen templates with sketches (createScreen). Keywords: notifications, bildirim, messages, alerts, inbox.
---

CATEGORY notice: Notifications (2 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. notice.center - Notification center: tabs Unread / All; a ✓ marks one as read
```
┌ Notification center────────────────────────┐
│NOTIFICATIONS                               │
│[Unread]  All                               │
│┌──────────────────────────────────────────┐│
││‹Name›                             [•]    ││
││‹Detail›                                  ││
││‹Date›                                    ││
││‹Amount›                                  ││
││····················                      ││
││‹Name›                             [•]    ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?, seen

2. notice.feed - Notification feed: the newest notifications as a simple feed
```
┌ Notification feed──────────────────────────┐
│ACTIVITY                                    │
│┌──────────────────────────────────────────┐│
││‹Name›                   [‹Status›]       ││
││‹Detail›                 ‹Date›           ││
││                         ‹Amount›         ││
││····················                      ││
││‹Name›                   [‹Status›]       ││
││‹Detail›                 ‹Date›           ││
││                         ‹Amount›         ││
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

