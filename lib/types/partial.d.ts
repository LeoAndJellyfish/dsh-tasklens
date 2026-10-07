/** Recover only fully serialized operations, with the model's explicit version fields.
 * All recovered objects still pass the normal source, scope and transaction validators.
 * Incomplete strings/objects are never completed or inferred. */
export declare function completeGraphPrefix(output: string): unknown | null;
