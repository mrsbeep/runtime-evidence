import type { HttpTarget, HttpTargetName } from '@runtime-evidence/replay-http';

import type {
  TargetExecution,
  VerificationFailure,
  VerifyScenarioOptions,
} from './verification-types.ts';

function normalizeHost(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
}

export function isTargetAllowed(target: HttpTarget, allowHosts: readonly string[]): boolean {
  try {
    const hostname = normalizeHost(new URL(target.url).hostname);
    return allowHosts.some((allowedHost) => normalizeHost(allowedHost) === hostname);
  } catch {
    // Invalid targets are diagnosed by the HTTP executor rather than misreported as policy denial.
    return true;
  }
}

function targetFromConfig(
  name: HttpTargetName,
  config: VerifyScenarioOptions['config'],
  revision: string | undefined,
): HttpTarget {
  const configured = config.targets[name];
  return Object.freeze({
    ...(configured.headers === undefined ? {} : { headers: configured.headers }),
    name,
    ...(revision === undefined ? {} : { revision }),
    url: configured.url,
  });
}

export function configuredTargets(options: VerifyScenarioOptions): {
  readonly baseline: HttpTarget;
  readonly candidate: HttpTarget;
} {
  return Object.freeze({
    baseline: targetFromConfig('baseline', options.config, options.revisions?.baseline),
    candidate: targetFromConfig('candidate', options.config, options.revisions?.candidate),
  });
}

export function networkDenied(target: HttpTarget): TargetExecution {
  return Object.freeze({
    failure: Object.freeze({
      code: 'VERIFY_NETWORK_DENIED',
      kind: 'target',
      message: 'HTTP target host is not allowed by configuration.',
      phase: 'startup',
      target: target.name,
    }),
    observation: null,
  });
}

export function sideEffectDenied(): VerificationFailure {
  return Object.freeze({
    code: 'VERIFY_SIDE_EFFECT_DENIED',
    kind: 'setup',
    message: 'State-changing scenarios require an explicit policy that is not available.',
    phase: 'setup',
  });
}
