import {
  executeHttpRequest,
  type HttpTarget,
  type PreparedHttpRequest,
} from '@runtime-evidence/replay-http';

import { isTargetAllowed, networkDenied } from './verification-policy.ts';
import { interruptedFailure, mapHttpFailure } from './verification-result.ts';
import type { TargetExecution, VerifyScenarioOptions } from './verification-types.ts';

export async function executeVerificationTarget(
  target: HttpTarget,
  request: PreparedHttpRequest,
  options: VerifyScenarioOptions,
  signal: AbortSignal,
  didTotalTimeout: () => boolean,
): Promise<TargetExecution> {
  if (!isTargetAllowed(target, options.config.network.allowHosts)) {
    return networkDenied(target);
  }

  const outcome = await executeHttpRequest(target, request, {
    connectTimeoutMs: options.config.timeouts.connectMs,
    ...(options.maxResponseBodyBytes === undefined
      ? {}
      : { maxResponseBodyBytes: options.maxResponseBodyBytes }),
    requestTimeoutMs: options.config.timeouts.requestMs,
    ...(options.selectedResponseHeaders === undefined
      ? {}
      : { selectedResponseHeaders: options.selectedResponseHeaders }),
    signal,
  });
  if (outcome.ok) {
    return Object.freeze({ failure: null, observation: outcome.observation });
  }
  if (outcome.failure.code === 'HTTP_REQUEST_ABORTED') {
    return Object.freeze({
      failure: interruptedFailure(didTotalTimeout(), target.name),
      observation: null,
    });
  }
  return Object.freeze({ failure: mapHttpFailure(outcome.failure), observation: null });
}
