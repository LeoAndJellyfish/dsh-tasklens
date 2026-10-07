const balancedEnd = (text: string, start: number): number | null => {
  const stack: string[] = []; let string = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (string) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    if (c === '{' || c === '[') stack.push(c);
    if (c === '}' || c === ']') {
      if (stack.pop() !== (c === '}' ? '{' : '[')) return null;
      if (!stack.length) return i + 1;
    }
  }
  return null;
};
/** Recover only fully serialized operations, with the model's explicit version fields.
 * All recovered objects still pass the normal source, scope and transaction validators.
 * Incomplete strings/objects are never completed or inferred. */
export function completeGraphPrefix(output: string): unknown | null {
  const text = output.trim().replace(/^```(?:json)?\s*/i, '');
  const root = /^\{\s*"graphPatch"\s*:\s*(\{)/.exec(text); if (!root) return null;
  const start = root[0].length - 1; let patch: Record<string, unknown>;
  try {
    const end = balancedEnd(text, start);
    if (end !== null) patch = JSON.parse(text.slice(start, end));
    else {
      const key = /"operations"\s*:\s*\[/.exec(text.slice(start)); if (!key) return null;
      const offset = start + key.index;
      patch = JSON.parse(text.slice(start, offset).replace(/,\s*$/, '') + '}');
      let position = offset + key[0].length; const operations: unknown[] = [];
      while (operations.length < 80) {
        while (/\s/.test(text[position] ?? '') && position < text.length) position++;
        if (operations.length) { if (text[position] !== ',') break; position++; while (/\s/.test(text[position] ?? '') && position < text.length) position++; }
        if (text[position] !== '{') break;
        const itemEnd = balancedEnd(text, position); if (itemEnd === null) break;
        operations.push(JSON.parse(text.slice(position, itemEnd))); position = itemEnd;
      }
      patch.operations = operations;
    }
  } catch { return null; }
  if (!Number.isInteger(patch.baseGraphVersion) || typeof patch.sourceRevision !== 'string' || !Array.isArray(patch.operations) || !patch.operations.length || patch.operations.length > 80) return null;
  return { graphPatch: patch, factCandidates: [], needsContext: [], briefing: {} };
}
