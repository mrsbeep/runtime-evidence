function isPlainRecord(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function arrayValues(value: readonly unknown[]): readonly unknown[] {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('Canonical JSON arrays must be dense data arrays.');
    }
  }
  const allowedKeys = new Set(['length', ...value.map((_, index) => String(index))]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw new TypeError('Canonical JSON arrays must not contain additional properties.');
  }
  return value;
}

function recordEntries(value: object): readonly (readonly [string, unknown])[] {
  return Reflect.ownKeys(value).map((key) => {
    if (typeof key !== 'string') {
      throw new TypeError('Canonical JSON objects must not contain symbol properties.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('Canonical JSON objects must contain enumerable data properties.');
    }
    return [key, descriptor.value] as const;
  });
}

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON numbers must be finite.');
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new TypeError('Canonical JSON values must be JSON-compatible.');
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new TypeError('Canonical JSON objects must use a plain object prototype.');
  }
  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON values must not contain cycles.');
  }

  ancestors.add(value);
  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${arrayValues(value)
      .map((item) => serializeCanonical(item, ancestors))
      .join(',')}]`;
  } else {
    const entries = [...recordEntries(value)].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    serialized = `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${serializeCanonical(item, ancestors)}`)
      .join(',')}}`;
  }
  ancestors.delete(value);
  return serialized;
}

/** Serializes a JSON-compatible value with recursively sorted object keys. */
export function canonicalizeJson(value: unknown): string {
  return serializeCanonical(value, new Set<object>());
}
