---
description: Tarife göre yeni bir Mendix web veya native widget yaz, test et ve mpk üret
---
Build this Mendix pluggable widget:

$ARGUMENTS

(Format: `<web|native> <WidgetName> <what it does>`.)

Load `mendix-widget-ui-design` and `mendix-web-widget` or `mendix-native-widget`, and follow the build skill's
workflow (section 2) exactly. Check `WIDGETS.md` first: do not build a duplicate.
Show, in Turkish and as tables: the requirements/properties table, the edge-case table, the layout per size class,
then build, test, lint and release. Run `node ../tools/check-mpk.mjs <mpk>` and stop if it does not print OK (widget id must be `<packagePath>.<widgetName lower>.<WidgetName>`). Report the mpk path, version, test results and how to place it on a page.
Add the widget to `WIDGETS.md`. Ask only what you cannot find (max 5 questions).
