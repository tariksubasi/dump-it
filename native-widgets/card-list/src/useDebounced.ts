import { useEffect, useState } from "react";

/** The value, updated only after it stayed the same for `ms` milliseconds. */
export function useDebounced<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), Math.max(0, ms));
        return () => clearTimeout(t);
    }, [value, ms]);
    return debounced;
}
