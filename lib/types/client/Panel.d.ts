import { type SVGProps } from 'react';
import { TaskLensClient } from './api.js';
export interface BoundProps {
    api: TaskLensClient;
    boundSessionId: string;
}
export declare function LensIcon({ size, ...props }: SVGProps<SVGSVGElement> & {
    size?: number;
}): import("react").JSX.Element;
export declare function Panel({ api, boundSessionId }: BoundProps): import("react").JSX.Element;
export declare function Header({ api, boundSessionId, open }: BoundProps & {
    open: () => void;
}): import("react").JSX.Element;
