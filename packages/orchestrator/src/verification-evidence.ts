import type { ComparisonDifference, ComparisonResult } from '@runtime-evidence/comparators';
import { compareHttpObservations } from '@runtime-evidence/comparators';
import type { EffectiveConfigV1 } from '@runtime-evidence/config';
import {
  canonicalizeJson,
  type EvidencePayloadV1,
  type EvidenceV1,
  RedactedEvidenceValue,
  type ScenarioV1,
} from '@runtime-evidence/evidence-schema';

import type { EffectiveReplayPolicy, VerificationResult } from './verification-types.ts';

export interface CreateVerificationEvidenceOptions {
  readonly config: EffectiveConfigV1;
  readonly configHash: string;
  readonly createdAt: string;
  readonly evidenceTargets: Readonly<Record<'baseline' | 'candidate', string>>;
  readonly results: readonly VerificationResult[];
  readonly runId: string;
  readonly scenarios: readonly ScenarioV1[];
  readonly toolVersion: string;
}

interface EvidenceRedactionState {
  readonly rules: Set<string>;
  valuesRemoved: number;
}

const secretLikePath =
  /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+=-]{8,}|\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^/\s]+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const hookEnforcementRank: Readonly<
  Record<EffectiveReplayPolicy['network']['hookProcesses'], number>
> = {
  'not-used': 0,
  'externally-isolated': 1,
  unsupported: 2,
};
const stateRank: Readonly<Record<EvidenceV1['state'], number>> = {
  pass: 0,
  advisory: 1,
  fail: 2,
  incomplete: 3,
};

function safeTargetUrl(value: string): string {
  if (value === '[environment reference]' || value === '[invalid target]') {
    return value;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    ) {
      return url.origin;
    }
  } catch {
    // The generic marker below cannot expose malformed target input.
  }
  return '[invalid target]';
}

function evidencePath(path: string, redaction: EvidenceRedactionState): string {
  if (!secretLikePath.test(path)) {
    return path;
  }
  redaction.rules.add('evidence:runtime-path');
  redaction.valuesRemoved += 1;
  return path.startsWith('/response/headers/')
    ? '/response/headers/[REDACTED]'
    : '/response/body/[REDACTED]';
}

function shouldRedactDifference(difference: ComparisonDifference): boolean {
  return (
    difference.comparator === 'body.exact' ||
    difference.comparator === 'header' ||
    difference.comparator === 'json.structure' ||
    difference.comparator === 'json.validity'
  );
}

function evidenceDifference(
  difference: ComparisonDifference,
  redaction: EvidenceRedactionState,
): EvidenceV1['results'][number]['differences'][number] {
  const redact = shouldRedactDifference(difference);
  if (redact) {
    redaction.rules.add('evidence:runtime-values');
    redaction.valuesRemoved += 2;
  }
  return {
    baseline: redact ? RedactedEvidenceValue : difference.baseline,
    candidate: redact ? RedactedEvidenceValue : difference.candidate,
    comparator: difference.comparator,
    message: difference.message,
    path: evidencePath(difference.path, redaction),
    severity: difference.severity,
  };
}

function compareResult(
  result: VerificationResult,
  config: EffectiveConfigV1,
): ComparisonResult | undefined {
  const { baseline, candidate } = result.observations;
  return result.status === 'complete' && baseline !== null && candidate !== null
    ? compareHttpObservations({ baseline, candidate }, config.comparison)
    : undefined;
}

function aggregatePolicy(
  results: readonly VerificationResult[],
): NonNullable<EvidenceV1['policy']> {
  const first = results[0];
  if (first === undefined) {
    throw new TypeError('At least one verification result is required.');
  }
  const { hookProcesses: _firstHookProcesses, ...firstNetworkPolicy } = first.policy.network;
  const policyIdentity = canonicalizeJson({
    network: firstNetworkPolicy,
    sideEffects: first.policy.sideEffects,
  });
  for (const result of results.slice(1)) {
    const { hookProcesses: _hookProcesses, ...networkPolicy } = result.policy.network;
    if (
      canonicalizeJson({ network: networkPolicy, sideEffects: result.policy.sideEffects }) !==
      policyIdentity
    ) {
      throw new TypeError('Verification results must share one effective replay policy.');
    }
  }
  const hookProcesses = results.reduce(
    (current, result) =>
      hookEnforcementRank[result.policy.network.hookProcesses] > hookEnforcementRank[current]
        ? result.policy.network.hookProcesses
        : current,
    first.policy.network.hookProcesses,
  );
  return {
    network: {
      ...first.policy.network,
      allowHosts: [...first.policy.network.allowHosts],
      allowDependencyHosts: [...first.policy.network.allowDependencyHosts],
      hookProcesses,
    },
    sideEffects: {
      ...first.policy.sideEffects,
      isolatedTargets: [...first.policy.sideEffects.isolatedTargets],
    },
  };
}

function aggregateState(states: readonly EvidenceV1['state'][]): EvidenceV1['state'] {
  return states.reduce(
    (current, state) => (stateRank[state] > stateRank[current] ? state : current),
    'pass',
  );
}

function recordScenarioRedaction(scenario: ScenarioV1, redaction: EvidenceRedactionState): void {
  const metadata = scenario.provenance.redaction;
  if (metadata === undefined) {
    return;
  }
  for (const rule of metadata.rules) {
    redaction.rules.add(rule);
  }
  redaction.valuesRemoved += metadata.valuesRemoved;
}

/** Creates a deterministic, sanitized evidence payload from typed verification results. */
export function createVerificationEvidencePayload(
  options: CreateVerificationEvidenceOptions,
): EvidencePayloadV1 {
  if (options.results.length !== options.scenarios.length || options.results.length === 0) {
    throw new TypeError('Verification results and scenarios must be non-empty and aligned.');
  }

  const redaction: EvidenceRedactionState = {
    rules: new Set(['evidence:runtime-payload-boundary']),
    valuesRemoved: 0,
  };
  const evidenceResults: EvidenceV1['results'] = options.results.map((result, index) => {
    const scenario = options.scenarios[index];
    if (scenario === undefined || scenario.id !== result.scenarioId) {
      throw new TypeError('Verification results and scenarios must use the same stable order.');
    }
    recordScenarioRedaction(scenario, redaction);
    const comparison = compareResult(result, options.config);
    return {
      scenarioId: result.scenarioId,
      state: comparison?.status ?? ('incomplete' as const),
      durationMs: result.durationMs,
      differences:
        comparison?.differences.map((difference) => evidenceDifference(difference, redaction)) ??
        [],
    };
  });
  const failures = options.results.flatMap((result) =>
    result.failures.map((failure) =>
      [result.scenarioId, failure.target ?? 'verification', failure.code, failure.message].join(
        ': ',
      ),
    ),
  );
  const limitations = [...new Set(options.results.flatMap((result) => result.limitations))].sort();

  return {
    schemaVersion: 1,
    toolVersion: options.toolVersion,
    runId: options.runId,
    createdAt: options.createdAt,
    project: options.config.project.name,
    state: aggregateState(evidenceResults.map((result) => result.state)),
    config: { schemaVersion: 1, sha256: options.configHash },
    targets: {
      baseline: { name: 'baseline', url: safeTargetUrl(options.evidenceTargets.baseline) },
      candidate: { name: 'candidate', url: safeTargetUrl(options.evidenceTargets.candidate) },
    },
    results: evidenceResults,
    coverage: {
      scenariosSelected: options.results.length,
      scenariosCompleted: options.results.filter((result) => result.status === 'complete').length,
      assertionsEvaluated:
        options.results.filter((result) => result.status === 'complete').length * 4,
    },
    policy: aggregatePolicy(options.results),
    limitations,
    skippedChecks: options.results.flatMap((result) =>
      result.status === 'complete'
        ? []
        : [
            {
              check: `scenario:${result.scenarioId}`,
              reason: 'A complete baseline and candidate observation pair was unavailable.',
            },
          ],
    ),
    infrastructureErrors: failures,
    redaction: {
      applied: true,
      rules: [...redaction.rules].sort(),
      valuesRemoved: redaction.valuesRemoved,
    },
  };
}
