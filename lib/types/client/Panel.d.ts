import { TaskLensClient } from './api.js';
export { LensIcon } from './common.js';
export interface BoundProps {
    api: TaskLensClient;
    boundSessionId: string;
}
export declare function Panel({ api, boundSessionId }: BoundProps): import("react").JSX.Element;
export declare function Header({ api, boundSessionId, open }: BoundProps & {
    open: () => void;
}): import("react").JSX.Element;
