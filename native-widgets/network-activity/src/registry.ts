// Several pages (layouts) can hold this widget at once. Only one instance draws the overlay: the last focused one.

type Entry = { id: number; focused: boolean; order: number };
const entries: Entry[] = [];
const listeners = new Set<() => void>();
let order = 0;

function emit(): void {
    listeners.forEach(l => l());
}

export function register(id: number, focused: boolean): void {
    entries.push({ id, focused, order: ++order });
    emit();
}

export function setFocused(id: number, focused: boolean): void {
    const e = entries.find(x => x.id === id);
    if (e && e.focused !== focused) {
        e.focused = focused;
        if (focused) {
            e.order = ++order;
        }
        emit();
    }
}

export function unregister(id: number): void {
    const i = entries.findIndex(x => x.id === id);
    if (i >= 0) {
        entries.splice(i, 1);
        emit();
    }
}

/** The last focused instance; if none is focused, the last registered one. */
export function leader(): number | undefined {
    const focused = entries.filter(e => e.focused);
    const pool = focused.length ? focused : entries;
    return pool.reduce<Entry | undefined>((a, b) => (!a || b.order > a.order ? b : a), undefined)?.id;
}

export function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function count(): number {
    return entries.length;
}
