import { performance } from 'node:perf_hooks';

import {
  type HttpExecutionFailure,
  HttpRequestPreparationError,
  type HttpTargetName,
} from '@runtime-evidence/replay-http';

import type { ScenarioLifecycleError } from './hooks.ts';
import type {
  EffectiveReplayPolicy,
  PairedExecution,
  VerificationFailure,
  VerificationResult,
} from './verification-types.ts';

export function mapHttpFailure(detail: HttpExecutionFailure): VerificationFailure {
  return Object.freeze({
    code: detail.code,
    kind: detail.kind,
    message: detail.message,
    phase: detail.phase,
    target: detail.target,
  });
}

export function interruptedFailure(
  timedOut: boolean,
  target?: HttpTargetName,
): VerificationFailure {
  return Object.freeze({
    code: timedOut ? 'VERIFY_TOTAL_TIMEOUT' : 'VERIFY_INTERRUPTED',
    kind: timedOut ? 'timeout' : 'interrupted',
    message: timedOut
      ? 'Verification exceeded its total timeout.'
      : 'Verification was interrupted.',
    phase: 'total',
    ...(target === undefined ? {} : { target }),
  });
}

export function lifecycleFailures(
  error: ScenarioLifecycleError<PairedExecution>,
  timedOut: boolean,
  interrupted: boolean,
): readonly VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  if (timedOut || interrupted) {
    failures.push(interruptedFailure(timedOut));
  } else if (error.cause instanceof HttpRequestPreparationError) {
    failures.push(
      Object.freeze({
        code: error.cause.code,
        kind: 'setup',
        message: error.cause.message,
        phase: 'setup',
      }),
    );
  } else if (error.phase !== 'cleanup') {
    const hookTimedOut = error.code === 'SCENARIO_HOOK_TIMEOUT';
    failures.push(
      Object.freeze({
        code: error.code,
        kind: hookTimedOut ? 'timeout' : 'setup',
        message: hookTimedOut ? 'Scenario setup hook timed out.' : 'Scenario setup failed.',
        phase: 'setup',
      }),
    );
  }

  for (const cleanup of error.cleanupFailures) {
    const cleanupTimedOut = cleanup.code === 'SCENARIO_HOOK_TIMEOUT';
    failures.push(
      Object.freeze({
        code: cleanup.code,
        kind: cleanupTimedOut ? 'timeout' : 'cleanup',
        message: cleanupTimedOut ? 'Scenario cleanup hook timed out.' : 'Scenario cleanup failed.',
        phase: 'cleanup',
      }),
    );
  }
  return Object.freeze(failures);
}

export function finalizeResult(
  scenarioId: string,
  startedAt: number,
  execution: PairedExecution | undefined,
  failures: readonly VerificationFailure[],
  policy: EffectiveReplayPolicy,
  limitations: readonly string[],
): VerificationResult {
  const targetFailures =
    execution === undefined
      ? []
      : [execution.baseline.failure, execution.candidate.failure].filter(
          (failure): failure is VerificationFailure => failure !== null,
        );
  const allFailures = Object.freeze([...targetFailures, ...failures]);
  return Object.freeze({
    durationMs: Math.max(0, performance.now() - startedAt),
    failures: allFailures,
    limitations: Object.freeze([...limitations]),
    observations: Object.freeze({
      baseline: execution?.baseline.observation ?? null,
      candidate: execution?.candidate.observation ?? null,
    }),
    scenarioId,
    policy,
    status: allFailures.length === 0 ? 'complete' : 'incomplete',
  });
}
