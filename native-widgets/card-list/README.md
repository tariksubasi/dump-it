# CardList (web)

Cards for a list, with **server-side search** (debounced, multi-word, several attributes) and **load on scroll**.
The page keeps the only scroll (no nested scroll). Columns follow the widget's own width: 1 / 2 / 3 / 4 at
< 600 / 600 / 840 / 1200 px (CSS container queries). Package: `dist/1.0.0/dumpit.CardList.mpk`.

| Property | Use |
|---|---|
| Data source | **Database or XPath** → search and paging run in the database. Microflow/nanoflow sources load everything and filter in the browser |
| Title / Subtitle | per card |
| On click | per card (open page, call a flow) |
| Search in | attributes (String) searched with *contains*; every typed word must match one of them; non-filterable attributes are skipped |
| Delay / Minimum characters | debounce (default 300 ms) / minimum length (default 2) |
| Page size | items per load (default 20); "Load more" button as a fallback for keyboards and old browsers |
| Texts | placeholder, empty, no results, load more (en_US + tr_TR) |

Behavior: the search text survives back navigation (`usePersistentState`), a new search starts at page 1, a small
spinner shows while the next page loads, skeleton cards on the first load, off-screen cards are not painted
(`content-visibility: auto`).

```bash
npm install && npm run release   # npm test: 7 tests (debounce, filter shape, paging, empty vs no results)
```
