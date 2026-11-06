// When to show and hide the overlay. Pure; timers are injected so tests can use fake time.

export interface OverlayTiming {
    showDelayMs: number; // busy shorter than this: never shown (no flicker for quick calls)
    minVisibleMs: number; // once shown, stay at least this long (no flash)
    slowAfterMs: number; // then show the "still working" text and a Hide button
    maxVisibleMs: number; // hard limit: hide even if still busy, until the app is idle again
}

export type OverlayPhase = "hidden" | "visible" | "slow";

export interface OverlayState {
    phase: OverlayPhase;
    suppressed: boolean; // hidden by the limit or by the user until all requests end
}

type Timer = ReturnType<typeof setTimeout>;

export class OverlayController {
    state: OverlayState = { phase: "hidden", suppressed: false };
    private busy = false;
    private shownAt = 0;
    private timers: { show?: Timer; hide?: Timer; slow?: Timer; max?: Timer } = {};

    constructor(
        public timing: OverlayTiming,
        private onChange: (s: OverlayState) => void,
        private now: () => number = () => Date.now()
    ) {}

    setBusy(busy: boolean): void {
        if (busy === this.busy) {
            return;
        }
        this.busy = busy;
        if (busy) {
            this.clear("hide");
            if (this.state.phase === "hidden" && !this.state.suppressed && !this.timers.show) {
                this.timers.show = setTimeout(() => {
                    this.timers.show = undefined;
                    if (this.busy) {
                        this.show();
                    }
                }, this.timing.showDelayMs);
            }
            return;
        }
        // idle
        this.clear("show");
        if (this.state.suppressed) {
            this.set({ phase: "hidden", suppressed: false });
            return;
        }
        if (this.state.phase !== "hidden") {
            const left = this.timing.minVisibleMs - (this.now() - this.shownAt);
            if (left > 0) {
                this.timers.hide = setTimeout(() => {
                    this.timers.hide = undefined;
                    if (!this.busy) {
                        this.hide(false);
                    }
                }, left);
            } else {
                this.hide(false);
            }
        }
    }

    /** User pressed Hide, or a hard limit: stay hidden until the app is idle. */
    dismiss(): void {
        this.hide(this.busy);
    }

    dispose(): void {
        (["show", "hide", "slow", "max"] as const).forEach(k => this.clear(k));
    }

    private show(): void {
        this.shownAt = this.now();
        this.set({ phase: "visible", suppressed: false });
        this.timers.slow = setTimeout(() => {
            this.timers.slow = undefined;
            if (this.state.phase === "visible") {
                this.set({ phase: "slow", suppressed: false });
            }
        }, this.timing.slowAfterMs);
        this.timers.max = setTimeout(() => {
            this.timers.max = undefined;
            this.hide(this.busy);
        }, this.timing.maxVisibleMs);
    }

    private hide(suppress: boolean): void {
        (["show", "hide", "slow", "max"] as const).forEach(k => this.clear(k));
        this.set({ phase: "hidden", suppressed: suppress });
    }

    private clear(k: "show" | "hide" | "slow" | "max"): void {
        const t = this.timers[k];
        if (t) {
            clearTimeout(t);
            this.timers[k] = undefined;
        }
    }

    private set(s: OverlayState): void {
        if (s.phase !== this.state.phase || s.suppressed !== this.state.suppressed) {
            this.state = s;
            this.onChange(s);
        }
    }
}
