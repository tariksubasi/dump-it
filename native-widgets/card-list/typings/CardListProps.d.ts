/**
 * This file was generated from CardList.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { DynamicValue, ListActionValue, ListAttributeValue, ListExpressionValue, ListValue } from "mendix";
import { CSSProperties } from "react";

export interface SearchFieldsType {
    attr: ListAttributeValue<string>;
}

export interface SearchFieldsPreviewType {
    attr: string;
}

export interface CardListContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    ds: ListValue;
    title: ListAttributeValue<string>;
    subtitle?: ListExpressionValue<string>;
    onClick?: ListActionValue;
    searchFields: SearchFieldsType[];
    debounceMs: number;
    minChars: number;
    placeholder?: DynamicValue<string>;
    pageSize: number;
    loadMoreText?: DynamicValue<string>;
    emptyText?: DynamicValue<string>;
    noResultsText?: DynamicValue<string>;
}

export interface CardListPreviewProps {
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
    ds: {} | { caption: string } | { type: string } | null;
    title: string;
    subtitle: string;
    onClick: {} | null;
    searchFields: SearchFieldsPreviewType[];
    debounceMs: number | null;
    minChars: number | null;
    placeholder: string;
    pageSize: number | null;
    loadMoreText: string;
    emptyText: string;
    noResultsText: string;
}
