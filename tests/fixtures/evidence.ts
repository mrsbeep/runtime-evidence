import { type EvidencePayloadV1, RedactedEvidenceValue } from '@runtime-evidence/evidence-schema';

export function mixedEvidencePayload(): EvidencePayloadV1 {
  return {
    schemaVersion: 1,
    toolVersion: '0.1.0',
    runId: 'run-report-test',
    createdAt: '2026-08-27T15:30:00Z',
    project: 'checkout & <api>',
    state: 'incomplete',
    config: {
      schemaVersion: 1,
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    targets: {
      baseline: { name: 'baseline', url: 'http://127.0.0.1:4100' },
      candidate: { name: 'candidate', url: 'http://127.0.0.1:4200' },
    },
    results: [
      {
        scenarioId: 'status-regression',
        state: 'fail',
        durationMs: 10,
        differences: [
          {
            comparator: 'status',
            path: '/response/statusCode',
            severity: 'error',
            message: 'Status < changed & requires review.',
            baseline: 200,
            candidate: 503,
          },
        ],
      },
      {
        scenarioId: 'latency-warning',
        state: 'advisory',
        durationMs: 5,
        differences: [
          {
            comparator: 'latency.relative',
            path: '/latencyMs',
            severity: 'warning',
            message: 'Latency approached the configured boundary.',
            baseline: 100,
            candidate: 119,
          },
        ],
      },
      {
        scenarioId: 'expected-header',
        state: 'pass',
        durationMs: 2,
        differences: [
          {
            comparator: 'header',
            path: '/response/headers/authorization',
            severity: 'info',
            message: 'Authorization values were intentionally redacted.',
            baseline: { authorization: RedactedEvidenceValue },
            candidate: { authorization: RedactedEvidenceValue },
          },
        ],
      },
      {
        scenarioId: 'candidate-unavailable',
        state: 'incomplete',
        durationMs: 3,
        differences: [],
      },
    ],
    coverage: {
      scenariosSelected: 4,
      scenariosCompleted: 3,
      assertionsEvaluated: 3,
    },
    limitations: ['Database side effects were not evaluated.'],
    skippedChecks: [{ check: 'response-body', reason: 'No candidate response was available.' }],
    infrastructureErrors: ['Candidate connection was refused.'],
    redaction: {
      applied: true,
      rules: ['header:authorization'],
      valuesRemoved: 2,
    },
  };
}
