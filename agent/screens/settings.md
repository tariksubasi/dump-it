---
name: mendix-screens-settings
description: Settings, profile, users - 4 ready Mendix screen templates with sketches (createScreen). Keywords: settings, ayarlar, profile, profil, preferences, users, kullanıcı.
---

CATEGORY settings: Settings, profile, users (4 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. settings.profile - Profile: a profile card (name, email) and the editable fields in sections
```
┌ Profile────────────────────────────────────┐
│PROFILE                                     │
│┌────────────┐ ┌──────────────────────────┐ │
││‹NAME›      │ │Details                   │ │
││‹Detail›    │ │Detail       Date         │ │
│└────────────┘ │[__________] [__________] │ │
│               │Status                    │ │
│               │[_______________________] │ │
│               └──────────────────────────┘ │
│                           [Cancel] [ Save ]│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

2. settings.toggles - Preferences (switches): the yes/no settings as check boxes in one card, Save at the end
```
┌ Preferences (switches)─────────────────────┐
│PREFERENCES                                 │
│┌──────────────────────────────────────────┐│
││Email Me                                  ││
││[____________________________]            ││
││Dark                                      ││
││[____________________________]            ││
││                         [Cancel] [ Save ]││
│└──────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, flags

3. settings.users - User management: people in a table with search and status filter; New on top
```
┌ User management────────────────────────────┐
│USERS                        [ + New user ] │
│Who has access                              │
│[🔍 Search] [🔍 Status]                     │
│Name       Detail     Date       Status     │
│…          …          …          …          │
│…          …          …          …          │
│                                   ‹ 1 2 ›  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

4. settings.accordion - Settings in groups: the settings in collapsible groups (accordion), Save at the end
```
┌ Settings in groups─────────────────────────┐
│SETTINGS                                    │
│▾ General                                   │
│  Name                                      │
│  [____________________________]            │
│  Detail                                    │
│  [____________________________]            │
│  Date                                      │
│  [____________________________]            │
│  Status                                    │
│ …                                          │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): entity, title, subtitle?, date?, status?, amount?, cols, fields, edit?

