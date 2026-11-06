export class FakeXhr {
    listeners: Record<string, Array<() => void>> = {};
    throwOnSend = false;
    open(_m: string, _u: string): void {
        // recorded by the patch
    }
    send(_b?: unknown): void {
        if (this.throwOnSend) {
            throw new Error("send failed");
        }
    }
    addEventListener(t: string, fn: () => void): void {
        (this.listeners[t] ??= []).push(fn);
    }
    fire(t: string): void {
        (this.listeners[t] ?? []).forEach(f => f());
    }
    finish(outcome: "load" | "error" | "timeout" | "abort"): void {
        this.fire(outcome);
        this.fire("loadend");
    }
}
