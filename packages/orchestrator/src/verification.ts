import { performance } from 'node:perf_hooks';

import { prepareScenarioRequest } from '@runtime-evidence/replay-http';

import {
  type RunScenarioLifecycleOptions,
  ScenarioLifecycleError,
  runScenarioLifecycle,
} from './hooks.ts';
import { configuredTargets, sideEffectDenied } from './verification-policy.ts';
import { finalizeResult, interruptedFailure, lifecycleFailures } from './verification-result.ts';
import { executeVerificationTarget } from './verification-target.ts';
import type {
  PairedExecution,
  VerificationFailure,
  VerificationResult,
  VerifyScenarioOptions,
} from './verification-types.ts';

function validateTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('totalTimeoutMs must be a positive safe integer.');
  }
}

/** Runs one validated scenario against baseline and candidate without making a pass/fail claim. */
export async function verifyScenario(options: VerifyScenarioOptions): Promise<VerificationResult> {
  validateTimeout(options.totalTimeoutMs);
  const startedAt = performance.now();

  if (options.scenario.safety.classification === 'state-changing') {
    return finalizeResult(options.scenario.id, startedAt, undefined, [sideEffectDenied()]);
  }

  let totalTimedOut = false;
  let interrupted = options.signal?.aborted ?? false;
  const totalController = new AbortController();
  const onInterrupt = (): void => {
    interrupted = true;
  };
  options.signal?.addEventListener('abort', onInterrupt, { once: true });
  const signal =
    options.signal === undefined
      ? totalController.signal
      : AbortSignal.any([options.signal, totalController.signal]);
  const totalTimer = setTimeout(() => {
    totalTimedOut = true;
    totalController.abort();
  }, options.totalTimeoutMs);
  totalTimer.unref();

  const targets = configuredTargets(options);
  let execution: PairedExecution | undefined;
  let failures: readonly VerificationFailure[] = [];

  try {
    execution = await runScenarioLifecycle(
      options.scenario,
      async () => {
        const request = prepareScenarioRequest(
          options.scenario,
          options.environment ?? process.env,
        );
        const [baseline, candidate] = await Promise.all([
          executeVerificationTarget(
            targets.baseline,
            request,
            options,
            signal,
            () => totalTimedOut,
          ),
          executeVerificationTarget(
            targets.candidate,
            request,
            options,
            signal,
            () => totalTimedOut,
          ),
        ]);
        return Object.freeze({ baseline, candidate });
      },
      {
        cwd: options.cwd,
        ...(options.environment === undefined ? {} : { environment: options.environment }),
        signal,
        ...(options.terminationGraceMs === undefined
          ? {}
          : { terminationGraceMs: options.terminationGraceMs }),
      } satisfies RunScenarioLifecycleOptions,
    );

    const alreadyInterrupted = [execution.baseline.failure, execution.candidate.failure].some(
      (failure) =>
        failure?.code === 'VERIFY_TOTAL_TIMEOUT' || failure?.code === 'VERIFY_INTERRUPTED',
    );
    if ((totalTimedOut || interrupted) && !alreadyInterrupted) {
      failures = [interruptedFailure(totalTimedOut)];
    }
  } catch (error) {
    if (error instanceof ScenarioLifecycleError) {
      const lifecycleError = error as ScenarioLifecycleError<PairedExecution>;
      execution = lifecycleError.operationResult;
      failures = lifecycleFailures(lifecycleError, totalTimedOut, interrupted);
    } else {
      failures = [
        Object.freeze({
          code: 'VERIFY_INTERNAL_ERROR',
          kind: 'transport',
          message: 'Verification failed unexpectedly.',
          phase: 'request',
        }),
      ];
    }
  } finally {
    clearTimeout(totalTimer);
    options.signal?.removeEventListener('abort', onInterrupt);
  }

  return finalizeResult(options.scenario.id, startedAt, execution, failures);
}
