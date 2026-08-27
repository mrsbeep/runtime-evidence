import { validateHeaderName, validateHeaderValue } from 'node:http';

import type { HttpTarget, PreparedHttpRequest } from './types.ts';

export interface PreparedTargetRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly url: URL;
}

function prepareTargetUrl(target: HttpTarget, request: PreparedHttpRequest): URL | undefined {
  try {
    const base = new URL(target.url);
    if (
      (base.protocol !== 'http:' && base.protocol !== 'https:') ||
      base.username !== '' ||
      base.password !== '' ||
      base.pathname !== '/' ||
      base.search !== '' ||
      base.hash !== ''
    ) {
      return undefined;
    }
    return new URL(request.path, base.origin);
  } catch {
    return undefined;
  }
}

function prepareHeaders(
  target: HttpTarget,
  request: PreparedHttpRequest,
): Readonly<Record<string, string>> | undefined {
  const headers = new Map<string, string>();
  for (const [name, value] of [
    ...Object.entries(target.headers ?? {}),
    ...Object.entries(request.headers),
  ]) {
    const normalized = name.toLowerCase();
    try {
      validateHeaderName(normalized);
      validateHeaderValue(normalized, value);
    } catch {
      return undefined;
    }
    headers.set(normalized, value);
  }
  return Object.freeze(Object.fromEntries(headers));
}

export function prepareTargetRequest(
  target: HttpTarget,
  request: PreparedHttpRequest,
): PreparedTargetRequest | undefined {
  const url = prepareTargetUrl(target, request);
  const headers = prepareHeaders(target, request);
  return url === undefined || headers === undefined ? undefined : { headers, url };
}
