import type { SanitizedCaptureDraft } from './types.ts';

const preparedDrafts = new WeakSet<object>();

export function markPrepared(draft: SanitizedCaptureDraft): SanitizedCaptureDraft {
  preparedDrafts.add(draft);
  return draft;
}

export function isPrepared(draft: SanitizedCaptureDraft): boolean {
  return preparedDrafts.has(draft);
}
