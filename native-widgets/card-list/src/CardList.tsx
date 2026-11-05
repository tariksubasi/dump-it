import { ReactElement, useEffect, useLayoutEffect, useRef } from "react";
import classNames from "classnames";
import { ValueStatus } from "mendix";
import { usePersistentState } from "mendix/hooks";

import { CardListContainerProps } from "../typings/CardListProps";
import { buildSearchFilter, nextLimit, normalizeQuery } from "./searchLogic";
import { useDebounced } from "./useDebounced";
import "./ui/CardList.css";

function text(v: { status: ValueStatus; value?: string } | undefined, fallback: string): string {
    return v?.status === ValueStatus.Available && v.value ? v.value : fallback;
}

export function CardList(props: CardListContainerProps): ReactElement {
    const { ds, pageSize } = props;
    // Survives back navigation, like the data source's own filter and limit.
    const [query, setQuery] = usePersistentState<string>(`${props.name}:search`, "");
    const effective = normalizeQuery(useDebounced(query, props.debounceMs), props.minChars);

    const latest = useRef(props);
    useLayoutEffect(() => {
        latest.current = props;
    });

    // Server-side filter (Database/XPath source): applied only when the effective text changes.
    const applied = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (applied.current === effective) {
            return;
        }
        const first = applied.current === undefined;
        applied.current = effective;
        if (first && effective === "") {
            if (ds.limit === Number.POSITIVE_INFINITY) {
                ds.setLimit(pageSize); // first page only; keep a restored filter/limit
            }
            return;
        }
        ds.setFilter(
            buildSearchFilter(
                effective,
                latest.current.searchFields.map(f => f.attr)
            )
        );
        ds.setLimit(pageSize); // new search starts at page 1
    }, [effective, ds, pageSize]);

    // Load on scroll: a sentinel after the last card; the page keeps the only scroll.
    const sentinel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = sentinel.current;
        if (!el || typeof IntersectionObserver === "undefined") {
            return undefined;
        }
        const io = new IntersectionObserver(
            entries => {
                const p = latest.current;
                const limit = entries[0]?.isIntersecting ? nextLimit(p.ds, p.pageSize) : undefined;
                if (limit !== undefined) {
                    p.ds.setLimit(limit);
                }
            },
            { rootMargin: "400px" }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    const items = ds.items ?? [];
    const loading = ds.status === ValueStatus.Loading;
    const firstLoad = loading && items.length === 0;
    const more = nextLimit(ds, pageSize);

    return (
        <div className={classNames("widget-card-list", props.class)} style={props.style}>
            <div className="widget-card-list__search" role="search">
                <input
                    type="search"
                    className="form-control"
                    value={query}
                    placeholder={text(props.placeholder, "Search")}
                    aria-label={text(props.placeholder, "Search")}
                    onChange={e => setQuery(e.target.value)}
                />
                {loading && !firstLoad ? <span className="widget-card-list__busy" aria-hidden="true" /> : null}
            </div>
            <div aria-live="polite" className="widget-card-list__status">
                {!loading && items.length === 0
                    ? effective
                        ? text(props.noResultsText, "No results")
                        : text(props.emptyText, "No items")
                    : null}
            </div>
            <ul className="widget-card-list__grid" aria-busy={loading}>
                {firstLoad
                    ? [0, 1, 2].map(i => <li key={i} className="widget-card-list__card is-skeleton" />)
                    : items.map(item => {
                          const action = props.onClick?.get(item);
                          const run = action?.canExecute && !action.isExecuting ? () => action.execute() : undefined;
                          return (
                              <li key={item.id} className="widget-card-list__card">
                                  <button type="button" className="widget-card-list__hit" onClick={run} disabled={!run}>
                                      <span className="widget-card-list__title">
                                          {props.title.get(item).displayValue}
                                      </span>
                                      {props.subtitle ? (
                                          <span className="widget-card-list__subtitle">
                                              {text(props.subtitle.get(item), "")}
                                          </span>
                                      ) : null}
                                  </button>
                              </li>
                          );
                      })}
            </ul>
            <div ref={sentinel} className="widget-card-list__sentinel" />
            {more !== undefined ? (
                <button
                    type="button"
                    className="btn btn-default widget-card-list__more"
                    onClick={() => ds.setLimit(more)}
                >
                    {text(props.loadMoreText, "Load more")}
                </button>
            ) : null}
        </div>
    );
}
