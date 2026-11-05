import { ListAttributeValue, ListValue } from "mendix";
import { and, attribute, contains, literal, or } from "mendix/filters/builders";

export type Filter = Parameters<ListValue["setFilter"]>[0];

const MAX_WORDS = 5;

/** Trimmed, single-spaced text; "" when shorter than minChars (no filter). */
export function normalizeQuery(text: string, minChars: number): string {
    const q = text.replace(/\s+/g, " ").trim();
    return q.length >= Math.max(1, minChars) ? q : "";
}

/**
 * Server-side search filter: every word must be found in at least one field.
 * "ali yılmaz" over [name, email] -> and(or(name~ali, email~ali), or(name~yılmaz, email~yılmaz)).
 * Fields that are not filterable are skipped (setFilter would fail at runtime).
 */
export function buildSearchFilter(query: string, fields: Array<ListAttributeValue<string> | undefined>): Filter {
    const usable = fields.filter((f): f is ListAttributeValue<string> => !!f && f.filterable);
    if (!query || usable.length === 0) {
        return undefined;
    }
    const words = query.split(" ").slice(0, MAX_WORDS);
    const perWord = words.map(w => {
        const parts = usable.map(f => contains(attribute(f.id), literal(w)));
        return parts.length === 1 ? parts[0] : or(...parts);
    });
    return perWord.length === 1 ? perWord[0] : and(...perWord);
}

/** The next limit for "load more", or undefined when there is nothing to load. */
export function nextLimit(
    ds: Pick<ListValue, "limit" | "hasMoreItems" | "status">,
    pageSize: number
): number | undefined {
    if (!ds.hasMoreItems || ds.status === "loading") {
        return undefined;
    }
    const current = Number.isFinite(ds.limit) ? ds.limit : 0;
    return current + Math.max(1, pageSize);
}
