import type { EffectiveConfigV1 } from '@runtime-evidence/config';
import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';
import type {
  HttpExecutionFailureCode,
  HttpObservation,
  HttpRequestPreparationErrorCode,
  HttpTargetName,
} from '@runtime-evidence/replay-http';

import type { ScenarioDiagnosticCode } from './diagnostics.ts';

export const VerificationFailureCodes = [
  'VERIFY_NETWORK_DENIED',
  'VERIFY_SIDE_EFFECT_DENIED',
  'VERIFY_TOTAL_TIMEOUT',
  'VERIFY_INTERRUPTED',
  'VERIFY_INTERNAL_ERROR',
] as const;

export type VerificationOwnFailureCode = (typeof VerificationFailureCodes)[number];
export type VerificationFailureCode =
  | HttpExecutionFailureCode
  | HttpRequestPreparationErrorCode
  | ScenarioDiagnosticCode
  | VerificationOwnFailureCode;
export type VerificationFailureKind =
  | 'cleanup'
  | 'interrupted'
  | 'setup'
  | 'target'
  | 'timeout'
  | 'transport';
export type VerificationFailurePhase = 'cleanup' | 'request' | 'setup' | 'startup' | 'total';

export interface VerificationFailure {
  readonly code: VerificationFailureCode;
  readonly kind: VerificationFailureKind;
  readonly message: string;
  readonly phase: VerificationFailurePhase;
  readonly target?: HttpTargetName;
}

export interface VerificationResult {
  readonly durationMs: number;
  readonly failures: readonly VerificationFailure[];
  readonly observations: {
    readonly baseline: HttpObservation | null;
    readonly candidate: HttpObservation | null;
  };
  readonly scenarioId: string;
  /** Execution completeness only. Pass/fail belongs to deterministic comparison. */
  readonly status: 'complete' | 'incomplete';
}

export interface VerifyScenarioOptions {
  readonly config: Pick<EffectiveConfigV1, 'network' | 'targets' | 'timeouts'>;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly maxResponseBodyBytes?: number;
  readonly revisions?: Readonly<Partial<Record<HttpTargetName, string>>>;
  readonly scenario: ScenarioV1;
  readonly selectedResponseHeaders?: readonly string[];
  readonly signal?: AbortSignal;
  readonly terminationGraceMs?: number;
  readonly totalTimeoutMs: number;
}

export interface TargetExecution {
  readonly failure: VerificationFailure | null;
  readonly observation: HttpObservation | null;
}

export interface PairedExecution {
  readonly baseline: TargetExecution;
  readonly candidate: TargetExecution;
}
