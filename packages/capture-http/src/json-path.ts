import { captureError } from './diagnostics.ts';

export type JsonPathSegment = number | string;

function invalid(index: number): never {
  throw captureError(
    'CAPTURE_JSON_PATH_INVALID',
    'Configured JSON path is outside the supported deterministic subset.',
    `/redaction/jsonPaths/${index}`,
  );
}

function quotedSegment(
  expression: string,
  offset: number,
  index: number,
): { readonly nextOffset: number; readonly segment: string } {
  let cursor = offset + 1;
  let escaped = false;
  while (cursor < expression.length) {
    const character = expression[cursor];
    if (character === '"' && !escaped) {
      break;
    }
    escaped = character === '\\' && !escaped;
    if (character !== '\\') {
      escaped = false;
    }
    cursor += 1;
  }
  if (cursor >= expression.length || expression[cursor + 1] !== ']') {
    invalid(index);
  }

  let segment: unknown;
  try {
    segment = JSON.parse(expression.slice(offset, cursor + 1));
  } catch {
    invalid(index);
  }
  if (typeof segment !== 'string' || segment.length === 0) {
    invalid(index);
  }
  return { nextOffset: cursor + 2, segment };
}

/** Parses root, dot-property, quoted-property, and array-index JSON paths. */
export function parseJsonPath(expression: string, index: number): readonly JsonPathSegment[] {
  if (!expression.startsWith('$')) {
    invalid(index);
  }

  const segments: JsonPathSegment[] = [];
  let offset = 1;
  while (offset < expression.length) {
    const character = expression[offset];
    if (character === '.') {
      const start = offset + 1;
      let end = start;
      while (end < expression.length && !['.', '['].includes(expression[end] ?? '')) {
        end += 1;
      }
      if (end === start) {
        invalid(index);
      }
      const segment = expression.slice(start, end);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
        invalid(index);
      }
      segments.push(segment);
      offset = end;
      continue;
    }
    if (character !== '[') {
      invalid(index);
    }
    const start = offset + 1;
    if (expression[start] === '"') {
      const quoted = quotedSegment(expression, start, index);
      segments.push(quoted.segment);
      offset = quoted.nextOffset;
      continue;
    }
    const end = expression.indexOf(']', start);
    const token = end === -1 ? '' : expression.slice(start, end);
    if (!/^(?:0|[1-9]\d*)$/.test(token)) {
      invalid(index);
    }
    const arrayIndex = Number(token);
    if (!Number.isSafeInteger(arrayIndex)) {
      invalid(index);
    }
    segments.push(arrayIndex);
    offset = end + 1;
  }
  return Object.freeze(segments);
}
