interface Node { id: string }
interface Edge { from: string; to: string }
/** Align successors across columns; a dependency within one column advances a row. */
export function dependencyRows(ordered: Node[], groups: Array<{ nodes: Node[] }>, edges: Edge[]): Map<string, number> {
  const columns = new Map(groups.flatMap((group, index) => group.nodes.map(node => [node.id, index] as const)));
  const rows = new Map<string, number>(), last = new Map<number, number>();
  for (const node of ordered) {
    const column = columns.get(node.id)!; let row = (last.get(column) ?? -1) + 1;
    for (const edge of edges.filter(edge => edge.to === node.id)) {
      const predecessor = rows.get(edge.from); if (predecessor === undefined) continue;
      row = Math.max(row, predecessor + (columns.get(edge.from)! >= column ? 1 : 0));
    }
    rows.set(node.id, row); last.set(column, row);
  }
  return rows;
}
