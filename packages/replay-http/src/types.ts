import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';

export type HttpMethod = ScenarioV1['request']['method'];
export type HttpTargetName = 'baseline' | 'candidate';

export interface HttpTarget {
  readonly headers?: Readonly<Record<string, string>>;
  readonly name: HttpTargetName;
  readonly revision?: string;
  readonly url: string;
}

/** Runtime-only request. Header values may contain secrets and must never be logged or persisted. */
export interface PreparedHttpRequest {
  readonly body?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: HttpMethod;
  readonly path: string;
}

export interface HttpResponseBody {
  readonly byteLength: number;
  readonly content: string;
  readonly encoding: 'base64' | 'utf8';
}

export interface HttpObservationTarget {
  readonly name: HttpTargetName;
  readonly revision?: string;
  readonly url: string;
}

export interface HttpObservation {
  readonly latencyMs: number;
  readonly request: {
    readonly method: HttpMethod;
    readonly path: string;
  };
  readonly response: {
    readonly body: HttpResponseBody;
    readonly headers: Readonly<Record<string, readonly string[]>>;
    readonly statusCode: number;
  };
  readonly target: HttpObservationTarget;
}

export const HttpExecutionFailureCodes = [
  'HTTP_TARGET_INVALID',
  'HTTP_TARGET_UNAVAILABLE',
  'HTTP_CONNECT_TIMEOUT',
  'HTTP_REQUEST_TIMEOUT',
  'HTTP_REQUEST_ABORTED',
  'HTTP_TRANSPORT_ERROR',
  'HTTP_RESPONSE_TOO_LARGE',
] as const;

export type HttpExecutionFailureCode = (typeof HttpExecutionFailureCodes)[number];
export type HttpExecutionFailureKind = 'interrupted' | 'target' | 'timeout' | 'transport';
export type HttpExecutionPhase = 'request' | 'startup';

export interface HttpExecutionFailure {
  readonly code: HttpExecutionFailureCode;
  readonly kind: HttpExecutionFailureKind;
  readonly message: string;
  readonly phase: HttpExecutionPhase;
  readonly target: HttpTargetName;
}

export type HttpExecutionOutcome =
  | { readonly ok: true; readonly observation: HttpObservation }
  | { readonly failure: HttpExecutionFailure; readonly ok: false };

export interface ExecuteHttpRequestOptions {
  readonly connectTimeoutMs: number;
  readonly maxResponseBodyBytes?: number;
  readonly requestTimeoutMs: number;
  readonly selectedResponseHeaders?: readonly string[];
  readonly signal?: AbortSignal;
}
