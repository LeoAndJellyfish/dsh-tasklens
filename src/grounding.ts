/** Compare complete numeric tokens; 12 does not establish a claim about 2. */
export function missingNumbers(text: string, evidence: string[]): string[] {
  const tokens = (value: string) => value.normalize('NFKC').replace(/(\d)[,，](?=\d{3}(?:\D|$))/g, '$1').match(/\d+(?:\.\d+)?/g) ?? [];
  const supported = new Set(evidence.flatMap(tokens));
  return [...new Set(tokens(text))].filter(value => !supported.has(value));
}
