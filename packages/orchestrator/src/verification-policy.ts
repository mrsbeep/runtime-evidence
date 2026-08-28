import type { HttpTarget, HttpTargetName } from '@runtime-evidence/replay-http';
import { normalizeNetworkHost } from '@runtime-evidence/config';

import type {
  EffectiveReplayPolicy,
  TargetExecution,
  VerificationFailure,
  VerifyScenarioOptions,
} from './verification-types.ts';

export interface ReplayPolicyEvaluation {
  readonly failures: readonly VerificationFailure[];
  readonly limitations: readonly string[];
  readonly policy: EffectiveReplayPolicy;
}

function normalizedHosts(hosts: readonly string[]): readonly string[] | undefined {
  const normalized = hosts.map(normalizeNetworkHost);
  if (normalized.some((host) => host === undefined)) {
    return undefined;
  }
  const values = normalized as string[];
  const unique = [...new Set(values)];
  return unique.length === values.length ? Object.freeze(unique.sort()) : undefined;
}

function platform(): EffectiveReplayPolicy['network']['platform'] {
  return process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32'
    ? process.platform
    : 'other';
}

export function isTargetAllowed(target: HttpTarget, allowHosts: readonly string[]): boolean {
  try {
    const hostname = normalizeNetworkHost(new URL(target.url).hostname);
    const allowed = normalizedHosts(allowHosts);
    return hostname !== undefined && allowed !== undefined && allowed.includes(hostname);
  } catch {
    // Invalid targets are diagnosed by the HTTP executor rather than misreported as policy denial.
    return true;
  }
}

function failure(
  code: VerificationFailure['code'],
  message: string,
  phase: VerificationFailure['phase'],
  target?: HttpTargetName,
): VerificationFailure {
  return Object.freeze({
    code,
    kind: 'policy',
    message,
    phase,
    ...(target === undefined ? {} : { target }),
  });
}

function effectivePolicy(
  options: VerifyScenarioOptions,
  allowHosts: readonly string[],
  allowDependencyHosts: readonly string[],
  hookProcesses: EffectiveReplayPolicy['network']['hookProcesses'],
): EffectiveReplayPolicy {
  const isolatedTargets = (['baseline', 'candidate'] as const).filter(
    (target) => options.config.targets[target].isolation !== undefined,
  );
  return Object.freeze({
    network: Object.freeze({
      default: 'deny',
      allowHosts: [...allowHosts],
      allowDependencyHosts: [...allowDependencyHosts],
      applicationRequests: 'enforced',
      hookProcesses,
      platform: platform(),
    }),
    sideEffects: Object.freeze({
      allowStateChanging: options.config.sideEffects?.allowStateChanging ?? false,
      isolatedTargets: [...isolatedTargets],
    }),
  });
}

export function evaluateReplayPolicy(
  options: VerifyScenarioOptions,
  targets: Readonly<Record<HttpTargetName, HttpTarget>>,
): ReplayPolicyEvaluation {
  const configuredTargetHosts = options.config.network.allowHosts;
  const configuredDependencyHosts = options.config.network.allowDependencyHosts ?? [];
  const allowHosts = normalizedHosts(configuredTargetHosts);
  const allowDependencyHosts = normalizedHosts(configuredDependencyHosts);
  const hasHooks =
    (options.scenario.setup?.length ?? 0) > 0 || (options.scenario.cleanup?.length ?? 0) > 0;
  const hookProcesses = !hasHooks
    ? 'not-used'
    : options.config.network.hookIsolation === undefined
      ? 'unsupported'
      : 'externally-isolated';
  const policy = effectivePolicy(
    options,
    allowHosts ?? [],
    allowDependencyHosts ?? [],
    hookProcesses,
  );
  const limitations = [
    'Runtime Evidence enforces destinations for its own HTTP requests; operating-system egress is not virtualized.',
  ];
  const failures: VerificationFailure[] = [];

  if (allowHosts === undefined || allowDependencyHosts === undefined) {
    failures.push(
      failure(
        'VERIFY_POLICY_INVALID',
        'Network policy contains an invalid or ambiguous hostname.',
        'startup',
      ),
    );
  } else {
    for (const target of [targets.baseline, targets.candidate]) {
      if (!isTargetAllowed(target, allowHosts)) {
        failures.push(networkDenied(target).failure as VerificationFailure);
      }
    }
  }

  if (hookProcesses === 'unsupported') {
    limitations.push(
      'Hook-process network isolation requires an externally managed container or virtual machine.',
    );
    failures.push(
      failure(
        'VERIFY_NETWORK_ENFORCEMENT_UNSUPPORTED',
        'Scenario hooks require declared external network isolation.',
        'setup',
      ),
    );
  } else if (hookProcesses === 'externally-isolated') {
    limitations.push(
      'Hook-process network isolation is externally declared and is not independently verified.',
    );
  }

  if (options.scenario.safety.classification === 'state-changing') {
    if (!policy.sideEffects.allowStateChanging) {
      failures.push(sideEffectDenied());
    }
    for (const target of [targets.baseline, targets.candidate]) {
      if (options.config.targets[target.name].isolation === undefined) {
        failures.push(
          failure(
            'VERIFY_TARGET_NOT_ISOLATED',
            'State-changing verification requires declared target isolation.',
            'setup',
            target.name,
          ),
        );
      }
    }
    const cleanupIsDeclaredIdempotent = (options.scenario.cleanup ?? []).every(
      (hook) => hook.idempotent === true,
    );
    if (!cleanupIsDeclaredIdempotent) {
      failures.push(
        failure(
          'VERIFY_CLEANUP_NOT_IDEMPOTENT',
          'State-changing cleanup hooks must declare idempotent behavior.',
          'setup',
        ),
      );
    }
    if (policy.sideEffects.isolatedTargets.length > 0) {
      limitations.push(
        'Target isolation is externally declared and is not independently verified.',
      );
    }
  }

  return Object.freeze({
    failures: Object.freeze(failures),
    limitations: Object.freeze([...new Set(limitations)].sort()),
    policy,
  });
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
    kind: 'policy',
    message: 'State-changing scenarios require explicit policy authorization.',
    phase: 'setup',
  });
}
