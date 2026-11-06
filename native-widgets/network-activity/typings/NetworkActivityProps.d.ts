/**
 * This file was generated from NetworkActivity.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { DynamicValue } from "mendix";
import { CSSProperties } from "react";

export type SpinnerEnum = "ringPulse" | "ring" | "native";

export interface NetworkActivityProps<Style> {
    name: string;
    style: Style[];
    enabled: DynamicValue<boolean>;
    showDelayMs: number;
    minVisibleMs: number;
    slowAfterMs: number;
    maxVisibleMs: number;
    requestTimeoutMs: number;
    ignorePatterns: string;
    spinner: SpinnerEnum;
    debugMode: boolean;
    message?: DynamicValue<string>;
    slowMessage?: DynamicValue<string>;
    hideText?: DynamicValue<string>;
}

export interface NetworkActivityPreviewProps {
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    enabled: string;
    showDelayMs: number | null;
    minVisibleMs: number | null;
    slowAfterMs: number | null;
    maxVisibleMs: number | null;
    requestTimeoutMs: number | null;
    ignorePatterns: string;
    spinner: SpinnerEnum;
    debugMode: boolean;
    message: string;
    slowMessage: string;
    hideText: string;
}
