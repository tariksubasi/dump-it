# Widget catalog

Check this list before building a widget: reuse or extend first. Add a row for every new widget.

| Widget | Platform | Folder | Version | Purpose | Key properties | Used on |
|---|---|---|---|---|---|---|
| BackNavigation | native | `back-navigation/` | 1.0.5 | Android back / iOS swipe: previous page, previous tab, home tab, then system | enabled, onBack, tabBackMode, rootBehavior, confirmWhen, debugMode | layout of the bottom bar pages |
| HtmlViewer | native | `html-viewer/` | 1.0.5 | Show HTML that fits every screen, zoom, offline-safe images, links outside | html, baseUrl, css, sizeMode, zoomable, linkMode, debugMode | news detail |
| CardList | web | `card-list/` | 1.0.0 | Card grid with debounced server-side search (multi-word, several attributes) and load on scroll | ds, title, subtitle, onClick, searchFields, debounceMs, minChars, pageSize | reference for list pages |
| NetworkActivity | native | `network-activity/` | 1.0.1 | Automatic blocking loading overlay for every server request; hides on error/timeout/limits | enabled, showDelayMs, minVisibleMs, slowAfterMs, maxVisibleMs, requestTimeoutMs, ignorePatterns, spinner, debugMode | all layouts |
