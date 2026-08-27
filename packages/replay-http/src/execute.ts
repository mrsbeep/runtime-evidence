import { type ClientRequest, type IncomingMessage, request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { performance } from 'node:perf_hooks';

import { createObservation, normalizeSelectedResponseHeaders } from './response.ts';
import { prepareTargetRequest } from './target.ts';
import type {
  ExecuteHttpRequestOptions,
  HttpExecutionFailure,
  HttpExecutionFailureCode,
  HttpExecutionFailureKind,
  HttpExecutionOutcome,
  HttpExecutionPhase,
  HttpTarget,
  PreparedHttpRequest,
} from './types.ts';

const unavailableErrorCodes = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
]);

function failure(
  target: HttpTarget,
  code: HttpExecutionFailureCode,
  kind: HttpExecutionFailureKind,
  phase: HttpExecutionPhase,
  message: string,
): HttpExecutionOutcome {
  const detail: HttpExecutionFailure = Object.freeze({
    code,
    kind,
    message,
    phase,
    target: target.name,
  });
  return Object.freeze({ failure: detail, ok: false });
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Executes one prepared request and converts all runtime failures into typed, secret-safe data. */
export async function executeHttpRequest(
  target: HttpTarget,
  preparedRequest: PreparedHttpRequest,
  options: ExecuteHttpRequestOptions,
): Promise<HttpExecutionOutcome> {
  validatePositiveInteger(options.connectTimeoutMs, 'connectTimeoutMs');
  validatePositiveInteger(options.requestTimeoutMs, 'requestTimeoutMs');
  const maxResponseBodyBytes = options.maxResponseBodyBytes ?? 1_048_576;
  validatePositiveInteger(maxResponseBodyBytes, 'maxResponseBodyBytes');
  const responseHeaderNames = normalizeSelectedResponseHeaders(options.selectedResponseHeaders);
  const preparedTarget = prepareTargetRequest(target, preparedRequest);

  if (preparedTarget === undefined) {
    return failure(
      target,
      'HTTP_TARGET_INVALID',
      'target',
      'startup',
      'HTTP target URL or headers are invalid.',
    );
  }
  if (options.signal?.aborted) {
    return failure(
      target,
      'HTTP_REQUEST_ABORTED',
      'interrupted',
      'startup',
      'HTTP request was interrupted.',
    );
  }

  return new Promise<HttpExecutionOutcome>((resolvePromise) => {
    const startedAt = performance.now();
    let clientRequest: ClientRequest;
    let connectTimer: NodeJS.Timeout | undefined;
    let requestTimer: NodeJS.Timeout | undefined;
    let responseStarted = false;
    let settled = false;
    let termination: 'aborted' | 'connect-timeout' | 'request-timeout' | 'too-large' | undefined;

    const settle = (outcome: HttpExecutionOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
      }
      if (requestTimer !== undefined) {
        clearTimeout(requestTimer);
      }
      options.signal?.removeEventListener('abort', abort);
      resolvePromise(outcome);
    };

    const terminateWith = (reason: typeof termination, outcome: HttpExecutionOutcome): void => {
      termination = reason;
      clientRequest.destroy();
      settle(outcome);
    };

    const markConnected = (): void => {
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
      if (requestTimer === undefined && !settled) {
        requestTimer = setTimeout(() => {
          terminateWith(
            'request-timeout',
            failure(
              target,
              'HTTP_REQUEST_TIMEOUT',
              'timeout',
              'request',
              'HTTP request timed out.',
            ),
          );
        }, options.requestTimeoutMs);
        requestTimer.unref();
      }
    };

    const abort = (): void => {
      terminateWith(
        'aborted',
        failure(
          target,
          'HTTP_REQUEST_ABORTED',
          'interrupted',
          responseStarted ? 'request' : 'startup',
          'HTTP request was interrupted.',
        ),
      );
    };

    const receiveResponse = (response: IncomingMessage): void => {
      responseStarted = true;
      markConnected();
      const chunks: Buffer[] = [];
      let byteLength = 0;

      response.on('data', (chunk: Buffer | string) => {
        if (settled) {
          return;
        }
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        byteLength += bytes.byteLength;
        if (byteLength > maxResponseBodyBytes) {
          termination = 'too-large';
          response.destroy();
          terminateWith(
            'too-large',
            failure(
              target,
              'HTTP_RESPONSE_TOO_LARGE',
              'transport',
              'request',
              'HTTP response exceeded the configured body limit.',
            ),
          );
          return;
        }
        chunks.push(bytes);
      });

      response.once('aborted', () => {
        if (termination === undefined) {
          settle(
            failure(
              target,
              'HTTP_TRANSPORT_ERROR',
              'transport',
              'request',
              'HTTP response ended unexpectedly.',
            ),
          );
        }
      });

      response.once('error', () => {
        if (termination === undefined) {
          settle(
            failure(
              target,
              'HTTP_TRANSPORT_ERROR',
              'transport',
              'request',
              'HTTP response transport failed.',
            ),
          );
        }
      });

      response.once('end', () => {
        if (settled) {
          return;
        }
        if (response.statusCode === undefined) {
          settle(
            failure(
              target,
              'HTTP_TRANSPORT_ERROR',
              'transport',
              'request',
              'HTTP response did not include a status code.',
            ),
          );
          return;
        }
        settle(
          Object.freeze({
            observation: createObservation(
              target,
              preparedRequest,
              response.statusCode,
              response.headers,
              chunks,
              responseHeaderNames,
              performance.now() - startedAt,
            ),
            ok: true,
          }),
        );
      });
    };

    const requestFunction = preparedTarget.url.protocol === 'https:' ? requestHttps : requestHttp;
    try {
      clientRequest = requestFunction(
        preparedTarget.url,
        {
          agent: false,
          headers: preparedTarget.headers,
          method: preparedRequest.method,
        },
        receiveResponse,
      );
    } catch {
      settle(
        failure(
          target,
          'HTTP_TARGET_INVALID',
          'target',
          'startup',
          'HTTP target could not be initialized.',
        ),
      );
      return;
    }

    connectTimer = setTimeout(() => {
      terminateWith(
        'connect-timeout',
        failure(
          target,
          'HTTP_CONNECT_TIMEOUT',
          'timeout',
          'startup',
          'HTTP target connection timed out.',
        ),
      );
    }, options.connectTimeoutMs);
    connectTimer.unref();

    clientRequest.once('socket', (socket) => {
      if (!socket.connecting) {
        markConnected();
        return;
      }
      socket.once(
        preparedTarget.url.protocol === 'https:' ? 'secureConnect' : 'connect',
        markConnected,
      );
    });

    clientRequest.once('error', (error) => {
      if (settled || termination !== undefined) {
        return;
      }
      const unavailable = !responseStarted && unavailableErrorCodes.has(errorCode(error) ?? '');
      settle(
        failure(
          target,
          unavailable ? 'HTTP_TARGET_UNAVAILABLE' : 'HTTP_TRANSPORT_ERROR',
          unavailable ? 'target' : 'transport',
          responseStarted ? 'request' : 'startup',
          unavailable ? 'HTTP target is unavailable.' : 'HTTP transport failed.',
        ),
      );
    });

    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    if (preparedRequest.body !== undefined) {
      clientRequest.write(preparedRequest.body);
    }
    clientRequest.end();
  });
}
