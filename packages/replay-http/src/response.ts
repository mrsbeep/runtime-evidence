import { validateHeaderName, type IncomingHttpHeaders } from 'node:http';

import type {
  HttpObservation,
  HttpResponseBody,
  HttpTarget,
  PreparedHttpRequest,
} from './types.ts';

const defaultSelectedResponseHeaders = [
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
] as const;
const sensitiveResponseHeaders = new Set([
  'authorization',
  'cookie',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'www-authenticate',
  'x-api-key',
]);

export function normalizeSelectedResponseHeaders(
  headers: readonly string[] | undefined,
): readonly string[] {
  const selected = new Set<string>(['content-type']);
  for (const header of headers ?? defaultSelectedResponseHeaders) {
    const normalized = header.toLowerCase();
    try {
      validateHeaderName(normalized);
    } catch {
      throw new TypeError('Selected response headers must contain valid HTTP header names.');
    }
    if (!sensitiveResponseHeaders.has(normalized)) {
      selected.add(normalized);
    }
  }
  return Object.freeze([...selected].sort());
}

function selectHeaders(
  headers: IncomingHttpHeaders,
  selected: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      selected.flatMap((name) => {
        const value = headers[name];
        if (value === undefined) {
          return [];
        }
        return [[name, Object.freeze(Array.isArray(value) ? [...value] : [value])]];
      }),
    ),
  );
}

function isTextual(contentType: string | string[] | undefined): boolean {
  const normalized = Array.isArray(contentType) ? contentType[0] : contentType;
  if (normalized === undefined) {
    return true;
  }
  const mediaType = normalized.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType.endsWith('+json') ||
    mediaType === 'application/xml' ||
    mediaType.endsWith('+xml')
  );
}

function encodeBody(
  chunks: readonly Buffer[],
  contentType: string | string[] | undefined,
): HttpResponseBody {
  const bytes = Buffer.concat(chunks);
  if (isTextual(contentType)) {
    try {
      return Object.freeze({
        byteLength: bytes.byteLength,
        content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        encoding: 'utf8' as const,
      });
    } catch {
      // Invalid UTF-8 remains comparable as binary data.
    }
  }
  return Object.freeze({
    byteLength: bytes.byteLength,
    content: bytes.toString('base64'),
    encoding: 'base64' as const,
  });
}

export function createObservation(
  target: HttpTarget,
  request: PreparedHttpRequest,
  statusCode: number,
  headers: IncomingHttpHeaders,
  bodyChunks: readonly Buffer[],
  selectedResponseHeaders: readonly string[],
  latencyMs: number,
): HttpObservation {
  return Object.freeze({
    latencyMs: Math.max(0, latencyMs),
    request: Object.freeze({ method: request.method, path: request.path }),
    response: Object.freeze({
      body: encodeBody(bodyChunks, headers['content-type']),
      headers: selectHeaders(headers, selectedResponseHeaders),
      statusCode,
    }),
    target: Object.freeze({
      name: target.name,
      ...(target.revision === undefined ? {} : { revision: target.revision }),
      url: target.url,
    }),
  });
}
