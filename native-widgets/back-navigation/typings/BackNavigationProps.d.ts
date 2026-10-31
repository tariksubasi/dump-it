/**
 * This file was generated from BackNavigation.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { ActionValue, DynamicValue } from "mendix";
import { CSSProperties } from "react";

export type RootBehaviorEnum = "system" | "doublePress" | "block" | "action";

export interface BackNavigationProps<Style> {
    name: string;
    style: Style[];
    enabled: DynamicValue<boolean>;
    onBack?: ActionValue;
    iosSwipeBack: boolean;
    debounceMs: number;
    rootBehavior: RootBehaviorEnum;
    onRootBack?: ActionValue;
    exitHint?: DynamicValue<string>;
    confirmWhen: DynamicValue<boolean>;
    confirmTitle?: DynamicValue<string>;
    confirmMessage?: DynamicValue<string>;
    confirmYes?: DynamicValue<string>;
    confirmNo?: DynamicValue<string>;
}

export interface BackNavigationPreviewProps {
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
    onBack: {} | null;
    iosSwipeBack: boolean;
    debounceMs: number | null;
    rootBehavior: RootBehaviorEnum;
    onRootBack: {} | null;
    exitHint: string;
    confirmWhen: string;
    confirmTitle: string;
    confirmMessage: string;
    confirmYes: string;
    confirmNo: string;
}
