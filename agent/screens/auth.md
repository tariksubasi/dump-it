---
name: mendix-screens-auth
description: Sign-in - 3 ready Mendix screen templates with sketches (createScreen). Keywords: login, giriş, sign in, oturum, password.
---

CATEGORY auth: Sign-in (3 templates)
Show the user 3-5 of these (number + name + thumbnail), let them pick, then: python mx.py screens <template id>

1. auth.login - Sign-in, centred: the standard sign-in form in the middle
```
┌ Sign-in, centred───────────────────────────┐
│SIGN IN                                     │
│[User name______]                           │
│[Password_______]                           │
│[ Sign in ]                                 │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): support?

2. auth.loginWelcome - Sign-in with welcome text: a welcome heading and a short help line under the form
```
┌ Sign-in with welcome text──────────────────┐
│WELCOME BACK                                │
│[User name______]                           │
│[Password_______]                           │
│[ Sign in ]                                 │
│Forgot your password? Ask your administrato…│
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): support?

3. auth.loginSupport - Sign-in with support link: the form and a link to the support site under it
```
┌ Sign-in with support link──────────────────┐
│SIGN IN                                     │
│[User name______]                           │
│[Password_______]                           │
│[ Sign in ]                                 │
│[Get help]                                  │
└────────────────────────────────────────────┘
```
slots (? = optional or guessed): support?

