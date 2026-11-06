/**
 * This file was generated from ClientCache.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { DynamicValue } from "mendix";
import { CSSProperties } from "react";

export type ClearOnEnum = "otherMicroflows" | "writes";

export interface ClientCacheProps<Style> {
    name: string;
    style: Style[];
    enabled: DynamicValue<boolean>;
    rules: string;
    clearOn: ClearOnEnum;
    debugMode: boolean;
}

export interface ClientCachePreviewProps {
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
    rules: string;
    clearOn: ClearOnEnum;
    debugMode: boolean;
}
