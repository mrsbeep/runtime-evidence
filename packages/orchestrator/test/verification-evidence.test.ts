import assert from 'node:assert/strict';
import test from 'node:test';

import type { EffectiveConfigV1 } from '@runtime-evidence/config';
import {
  createEvidenceArtifact,
  RedactedEvidenceValue,
  type ScenarioV1,
} from '@runtime-evidence/evidence-schema';
import type { HttpObservation } from '@runtime-evidence/replay-http';

import {
  createVerificationEvidencePayload,
  type EffectiveReplayPolicy,
  type VerificationResult,
} from '../src/index.ts';

const responseSecret = 'not-a-real-runtime-response-secret';
const secretPathSegment = 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';

function config(): EffectiveConfigV1 {
  return {
    schemaVersion: 1,
    project: { name: 'evidence-policy-test' },
    targets: {
      baseline: { url: 'http://127.0.0.1:4100' },
      candidate: { url: `http://user:${responseSecret}@127.0.0.1:4200` },
    },
    scenarios: { include: ['scenarios/*.yaml'] },
    network: {
      default: 'deny',
      allowHosts: ['127.0.0.1'],
      allowDependencyHosts: ['cache.test'],
    },
    sideEffects: { allowStateChanging: false },
    redaction: { headers: ['authorization'], jsonPaths: [] },
    timeouts: { connectMs: 500, requestMs: 1_000 },
    comparison: {
      ignoredJsonPaths: [],
      normalizedJsonPaths: [],
      maxLatencyRegressionPercent: 20,
    },
  };
}

function scenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: 'runtime-redaction',
    name: 'Runtime redaction',
    provenance: {
      source: 'local-capture',
      redaction: { applied: true, rules: ['header:authorization'], valuesRemoved: 1 },
    },
    safety: { classification: 'read-only', rationale: 'Uses disposable local targets.' },
    request: { method: 'GET', path: '/health' },
  };
}

function observation(name: 'baseline' | 'candidate', content: string): HttpObservation {
  return {
    latencyMs: 10,
    request: { method: 'GET', path: '/health' },
    response: {
      body: { byteLength: Buffer.byteLength(content), content, encoding: 'utf8' },
      headers: { 'content-type': ['application/json'] },
      statusCode: 200,
    },
    target: { name, url: `http://127.0.0.1:${name === 'baseline' ? 4100 : 4200}` },
  };
}

function policy(): EffectiveReplayPolicy {
  return {
    network: {
      default: 'deny',
      allowHosts: ['127.0.0.1'],
      allowDependencyHosts: ['cache.test'],
      applicationRequests: 'enforced',
      hookProcesses: 'not-used',
      platform: 'linux',
    },
    sideEffects: { allowStateChanging: false, isolatedTargets: [] },
  };
}

test('evidence records effective policy without persisting runtime response payloads', () => {
  const baselineBody = JSON.stringify({ [secretPathSegment]: `baseline-${responseSecret}` });
  const candidateBody = JSON.stringify({ [secretPathSegment]: `candidate-${responseSecret}` });
  const result: VerificationResult = {
    durationMs: 12,
    failures: [],
    limitations: ['Application-owned HTTP requests only.'],
    observations: {
      baseline: observation('baseline', baselineBody),
      candidate: observation('candidate', candidateBody),
    },
    policy: policy(),
    scenarioId: 'runtime-redaction',
    status: 'complete',
  };
  const options = {
    config: config(),
    configHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-08-28T16:00:00Z',
    evidenceTargets: {
      baseline: 'http://127.0.0.1:4100',
      candidate: '[environment reference]',
    },
    results: [result],
    runId: 'run-evidence-policy-test',
    scenarios: [scenario()],
    toolVersion: '0.1.0',
  } as const;

  const first = createVerificationEvidencePayload(options);
  const second = createVerificationEvidencePayload(options);
  const difference = first.results[0]?.differences[0];

  assert.deepEqual(first, second);
  assert.equal(first.policy?.network.default, 'deny');
  assert.deepEqual(first.policy?.network.allowDependencyHosts, ['cache.test']);
  assert.equal(first.targets.candidate.url, '[environment reference]');
  assert.equal(difference?.path, '/response/body/[REDACTED]');
  assert.deepEqual(difference?.baseline, RedactedEvidenceValue);
  assert.deepEqual(difference?.candidate, RedactedEvidenceValue);
  assert.ok(first.redaction.rules.includes('evidence:runtime-values'));
  assert.ok(first.redaction.rules.includes('evidence:runtime-path'));
  assert.doesNotMatch(JSON.stringify(first), new RegExp(responseSecret));
  assert.doesNotMatch(JSON.stringify(first), new RegExp(secretPathSegment));
  assert.equal(createEvidenceArtifact(first).policy?.network.applicationRequests, 'enforced');
});

test('incomplete verification cannot become passing evidence', () => {
  const result: VerificationResult = {
    durationMs: 1,
    failures: [
      {
        code: 'VERIFY_NETWORK_DENIED',
        kind: 'policy',
        message: 'HTTP target host is not allowed by configuration.',
        phase: 'startup',
        target: 'candidate',
      },
    ],
    limitations: ['Application-owned HTTP requests only.'],
    observations: { baseline: null, candidate: null },
    policy: policy(),
    scenarioId: 'runtime-redaction',
    status: 'incomplete',
  };
  const payload = createVerificationEvidencePayload({
    config: config(),
    configHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-08-28T16:00:00Z',
    evidenceTargets: {
      baseline: 'http://127.0.0.1:4100',
      candidate: '[environment reference]',
    },
    results: [result],
    runId: 'run-incomplete-policy-test',
    scenarios: [scenario()],
    toolVersion: '0.1.0',
  });

  assert.equal(payload.state, 'incomplete');
  assert.equal(payload.coverage.scenariosCompleted, 0);
  assert.equal(payload.skippedChecks.length, 1);
  assert.match(payload.infrastructureErrors[0] ?? '', /VERIFY_NETWORK_DENIED/);
});
