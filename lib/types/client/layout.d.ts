interface Node {
    id: string;
}
interface Edge {
    from: string;
    to: string;
}
/** Align successors across columns; a dependency within one column advances a row. */
export declare function dependencyRows(ordered: Node[], groups: Array<{
    nodes: Node[];
}>, edges: Edge[]): Map<string, number>;
export {};
