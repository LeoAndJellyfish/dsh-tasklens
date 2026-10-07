import { type Roadmap } from '../schema.js';
export declare function Graph({ graph, selected, onSelect }: {
    graph: Roadmap;
    selected: string | null;
    onSelect: (id: string) => void;
}): import("react").JSX.Element;
