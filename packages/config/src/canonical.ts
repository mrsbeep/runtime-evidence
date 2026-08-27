import { createHash } from 'node:crypto';

import type { ConfigV1 } from '@runtime-evidence/evidence-schema';

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical configuration values must contain finite numbers.');
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new TypeError('Canonical configuration values must be JSON-compatible.');
  }

  if (ancestors.has(value)) {
    throw new TypeError('Canonical configuration values must not contain cycles.');
  }

  ancestors.add(value);

  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => serializeCanonical(item, ancestors)).join(',')}]`;
  } else {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    serialized = `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${serializeCanonical(item, ancestors)}`)
      .join(',')}}`;
  }

  ancestors.delete(value);
  return serialized;
}

/** Produces stable JSON by recursively sorting object keys while preserving array order. */
export function canonicalizeConfig(config: ConfigV1): string {
  return serializeCanonical(config, new Set<object>());
}

/** Hashes a validated, defaulted configuration without resolving secret values. */
export function hashConfig(config: ConfigV1): string {
  return createHash('sha256').update(canonicalizeConfig(config), 'utf8').digest('hex');
}
