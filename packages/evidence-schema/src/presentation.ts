import { canonicalizeJson } from './canonical-json.ts';

export const RedactedEvidenceValue = Object.freeze({ state: 'redacted' }) as Readonly<{
  state: 'redacted';
}>;

export function isRedactedEvidenceValue(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Reflect.get(value, 'state') === 'redacted'
  );
}

function replaceRedactedValues(value: unknown, ancestors: Set<object>): unknown {
  if (isRedactedEvidenceValue(value)) {
    return '[REDACTED]';
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (ancestors.has(value)) {
    throw new TypeError('Evidence presentation values must not contain cycles.');
  }

  ancestors.add(value);
  const replaced = Array.isArray(value)
    ? value.map((item) => replaceRedactedValues(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, replaceRedactedValues(item, ancestors)]),
      );
  ancestors.delete(value);
  return replaced;
}

/** Produces deterministic display JSON while replacing every redaction marker. */
export function formatEvidenceValue(value: unknown): string {
  return canonicalizeJson(replaceRedactedValues(value, new Set<object>()));
}
