import type { SVGProps } from 'react';
import { type TaskStatus } from '../schema.js';
export declare function LensIcon({ size, ...props }: SVGProps<SVGSVGElement> & {
    size?: number;
}): import("react").JSX.Element;
export declare function Icon({ kind, spin }: {
    kind: 'refresh' | 'settings' | 'pause' | 'play' | 'chevron' | 'arrow' | 'history' | 'source';
    spin?: boolean;
}): import("react").JSX.Element;
export declare function StatusIcon({ status }: {
    status: TaskStatus;
}): import("react").JSX.Element;
export declare function Badge({ status }: {
    status: TaskStatus;
}): import("react").JSX.Element;
export declare const time: (n: number) => string;
export declare function ranges(values: number[]): string;
