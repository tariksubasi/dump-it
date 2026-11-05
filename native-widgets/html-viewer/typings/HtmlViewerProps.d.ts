/**
 * This file was generated from HtmlViewer.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { ActionValue, DynamicValue, EditableValue } from "mendix";
import { CSSProperties } from "react";

export type SizeModeEnum = "content" | "parent";

export type WideTablesEnum = "fit" | "scroll";

export type LinkModeEnum = "external" | "action" | "none";

export interface HtmlViewerProps<Style> {
    name: string;
    style: Style[];
    html: DynamicValue<string>;
    baseUrl?: DynamicValue<string>;
    css: string;
    allowScripts: boolean;
    sizeMode: SizeModeEnum;
    maxHeight: number;
    wideTables: WideTablesEnum;
    zoomable: boolean;
    fullscreenButton: boolean;
    maxZoom: number;
    linkMode: LinkModeEnum;
    linkAttribute?: EditableValue<string>;
    onLinkPress?: ActionValue;
    onLoad?: ActionValue;
    onError?: ActionValue;
    offlineCache: boolean;
    emptyText?: DynamicValue<string>;
    errorText?: DynamicValue<string>;
    retryText?: DynamicValue<string>;
    linkErrorText?: DynamicValue<string>;
    openLabel?: DynamicValue<string>;
    closeLabel?: DynamicValue<string>;
}

export interface HtmlViewerPreviewProps {
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
    html: string;
    baseUrl: string;
    css: string;
    allowScripts: boolean;
    sizeMode: SizeModeEnum;
    maxHeight: number | null;
    wideTables: WideTablesEnum;
    zoomable: boolean;
    fullscreenButton: boolean;
    maxZoom: number | null;
    linkMode: LinkModeEnum;
    linkAttribute: string;
    onLinkPress: {} | null;
    onLoad: {} | null;
    onError: {} | null;
    offlineCache: boolean;
    emptyText: string;
    errorText: string;
    retryText: string;
    linkErrorText: string;
    openLabel: string;
    closeLabel: string;
}
