import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';

import type { ConfigV1, EvidenceV1, ScenarioV1 } from '@runtime-evidence/evidence-schema';

import {
  ACCEPTANCE_CASES,
  type AcceptanceCaseDefinition,
  type AcceptanceCaseId,
  ACCEPTANCE_SECRET_CANARIES,
} from './contract.ts';
import {
  recordAcceptanceResult,
  resetAcceptanceDiagnostics,
  writeAcceptanceDiagnostics,
} from './diagnostics.ts';
import {
  createAcceptanceConfig,
  createAcceptanceProject,
  createAcceptanceScenario,
  createMalformedProject,
  readProjectSources,
  renderEvidenceReports,
  runVerification,
  startTarget,
  type TargetResponder,
  unavailableTargetUrl,
  type VerificationRun,
} from './harness.ts';

const BASELINE_TOKEN_ENV = 'RUNTIME_EVIDENCE_ACCEPTANCE_BASELINE_TOKEN';
const CANDIDATE_TOKEN_ENV = 'RUNTIME_EVIDENCE_ACCEPTANCE_CANDIDATE_TOKEN';
const MISSING_SETUP_ENV = 'RUNTIME_EVIDENCE_ACCEPTANCE_MISSING_SETUP';

function definition(id: AcceptanceCaseId): AcceptanceCaseDefinition {
  const value = ACCEPTANCE_CASES.find((candidate) => candidate.id === id);
  if (value === undefined) {
    throw new TypeError(`Unknown acceptance case: ${id}`);
  }
  return value;
}

function evidenceState(run: VerificationRun | undefined): EvidenceV1['state'] | 'absent' | null {
  return run === undefined ? null : (run.evidence?.state ?? 'absent');
}

async function runAcceptanceCase(
  id: AcceptanceCaseId,
  operation: () => Promise<VerificationRun>,
  assertions: (run: VerificationRun) => void | Promise<void>,
): Promise<void> {
  const expected = definition(id);
  let run: VerificationRun | undefined;

  try {
    run = await operation();
    assert.equal(run.result.exitCode, expected.expectedExitCode);
    assert.equal(evidenceState(run), expected.expectedEvidenceState);
    await assertions(run);
    recordAcceptanceResult(id, {
      evidenceState: evidenceState(run),
      exitCode: run.result.exitCode,
      passed: true,
    });
  } catch (error) {
    recordAcceptanceResult(id, {
      evidenceState: evidenceState(run),
      exitCode: run?.result.exitCode ?? null,
      passed: false,
    });
    throw error;
  }
}

function assertDifference(
  evidence: EvidenceV1 | undefined,
  comparator: string,
  path: string,
): void {
  assert.ok(
    evidence?.results.some((result) =>
      result.differences.some(
        (difference) => difference.comparator === comparator && difference.path === path,
      ),
    ),
    `Expected ${comparator} difference at ${path}.`,
  );
}

function assertInfrastructureError(evidence: EvidenceV1 | undefined, code: string): void {
  assert.ok(evidence?.infrastructureErrors.some((message) => message.includes(code)));
  assert.notEqual(evidence?.state, 'pass');
}

function assertContainsNoCanary(value: string): void {
  for (const canary of ACCEPTANCE_SECRET_CANARIES) {
    assert.ok(!value.includes(canary), 'Acceptance output contained a test secret canary.');
  }
}

async function withEnvironment<T>(
  values: Readonly<Record<string, string | undefined>>,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = new Map(Object.keys(values).map((name) => [name, process.env[name]] as const));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await operation();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function localProject(
  context: TestContext,
  baselineUrl: string,
  candidateUrl: string,
  scenario: ScenarioV1 = createAcceptanceScenario(),
  configOverrides: {
    readonly baselineHeaders?: ConfigV1['targets']['baseline']['headers'];
    readonly candidateHeaders?: ConfigV1['targets']['candidate']['headers'];
    readonly comparison?: Partial<ConfigV1['comparison']>;
    readonly timeouts?: Partial<ConfigV1['timeouts']>;
  } = {},
) {
  return createAcceptanceProject(
    context,
    createAcceptanceConfig({ baselineUrl, candidateUrl, ...configOverrides }),
    scenario,
  );
}

before(resetAcceptanceDiagnostics);
after(writeAcceptanceDiagnostics);

test('matching baseline and candidate behavior passes', { concurrency: false }, async (context) => {
  await runAcceptanceCase(
    'matching-behavior',
    async () => {
      const response = { body: { service: { ready: true, version: 1 } } };
      const baselineUrl = await startTarget(context, () => response);
      const candidateUrl = await startTarget(context, () => response);
      return runVerification(await localProject(context, baselineUrl, candidateUrl));
    },
    (run) => {
      assert.equal(run.result.envelope.code, 'CLI_VERIFY_COMPLETE');
      assert.equal(run.evidence?.coverage.scenariosCompleted, 1);
      assert.deepEqual(run.evidence?.results[0]?.differences, []);
    },
  );
});

test('status and nested JSON regressions fail at stable fields', {
  concurrency: false,
}, async (context) => {
  await runAcceptanceCase(
    'status-and-json-regression',
    async () => {
      const baselineUrl = await startTarget(context, () => ({
        body: { account: { plan: 'pro' }, ready: true },
        statusCode: 200,
      }));
      const candidateUrl = await startTarget(context, () => ({
        body: { account: { plan: 'bad' }, ready: true },
        statusCode: 503,
      }));
      return runVerification(await localProject(context, baselineUrl, candidateUrl));
    },
    (run) => {
      assert.equal(run.result.envelope.code, 'CLI_VERIFY_FAILED');
      assertDifference(run.evidence, 'status', '/response/statusCode');
      assertDifference(run.evidence, 'json.structure', '/response/body/account/plan');
    },
  );
});

test('authorization-sensitive changes redact fixture secrets', {
  concurrency: false,
}, async (context) => {
  await runAcceptanceCase(
    'authorization-regression',
    async () => {
      const expectedAuthorization = `Bearer ${ACCEPTANCE_SECRET_CANARIES[0]}`;
      const responder: TargetResponder = (request) =>
        request.headers.authorization === expectedAuthorization
          ? { body: { access: 'allow' }, statusCode: 200 }
          : { body: { access: 'deny!' }, statusCode: 401 };
      const baselineUrl = await startTarget(context, responder);
      const candidateUrl = await startTarget(context, responder);
      const project = await localProject(
        context,
        baselineUrl,
        candidateUrl,
        createAcceptanceScenario(),
        {
          baselineHeaders: { authorization: { env: BASELINE_TOKEN_ENV } },
          candidateHeaders: { authorization: { env: CANDIDATE_TOKEN_ENV } },
        },
      );
      return withEnvironment(
        {
          [BASELINE_TOKEN_ENV]: expectedAuthorization,
          [CANDIDATE_TOKEN_ENV]: `Bearer ${ACCEPTANCE_SECRET_CANARIES[1]}`,
        },
        () => runVerification(project),
      );
    },
    async (run) => {
      assertDifference(run.evidence, 'status', '/response/statusCode');
      assertDifference(run.evidence, 'json.structure', '/response/body/access');
      const reports = await renderEvidenceReports(run);
      assertContainsNoCanary(
        [
          run.stdout,
          run.stderr,
          JSON.stringify(run.evidence),
          reports,
          await readProjectSources(run.project),
        ].join('\n'),
      );
    },
  );
});

test('latency budget regression uses deterministic delay controls', {
  concurrency: false,
}, async (context) => {
  await runAcceptanceCase(
    'latency-regression',
    async () => {
      const baselineUrl = await startTarget(context, () => ({ body: { ready: true } }));
      const candidateUrl = await startTarget(context, () => ({
        body: { ready: true },
        delayMs: 200,
      }));
      const project = await localProject(
        context,
        baselineUrl,
        candidateUrl,
        createAcceptanceScenario(),
        { comparison: { maxLatencyRegressionMs: 50 } },
      );
      return runVerification(project);
    },
    (run) => assertDifference(run.evidence, 'latency.absolute', '/latencyMs'),
  );
});

test('an unavailable candidate is incomplete', { concurrency: false }, async (context) => {
  await runAcceptanceCase(
    'unavailable-target',
    async () => {
      const baselineUrl = await startTarget(context, () => ({ body: { ready: true } }));
      const candidateUrl = await unavailableTargetUrl();
      return runVerification(await localProject(context, baselineUrl, candidateUrl));
    },
    (run) => assertInfrastructureError(run.evidence, 'HTTP_TARGET_UNAVAILABLE'),
  );
});

test('a candidate request timeout is incomplete', { concurrency: false }, async (context) => {
  await runAcceptanceCase(
    'request-timeout',
    async () => {
      const baselineUrl = await startTarget(context, () => ({ body: { ready: true } }));
      const candidateUrl = await startTarget(context, () => ({
        body: { ready: true },
        delayMs: 200,
      }));
      const project = await localProject(
        context,
        baselineUrl,
        candidateUrl,
        createAcceptanceScenario(),
        { timeouts: { requestMs: 30 } },
      );
      return runVerification(project);
    },
    (run) => assertInfrastructureError(run.evidence, 'HTTP_REQUEST_TIMEOUT'),
  );
});

test('failed request setup is incomplete before target execution', {
  concurrency: false,
}, async (context) => {
  let requestCount = 0;
  await runAcceptanceCase(
    'failed-setup',
    async () => {
      const responder = () => {
        requestCount += 1;
        return { body: { unexpected: true } };
      };
      const baselineUrl = await startTarget(context, responder);
      const candidateUrl = await startTarget(context, responder);
      const scenario = createAcceptanceScenario({
        request: {
          method: 'GET',
          path: '/acceptance',
          headers: { 'x-acceptance-setup': { env: MISSING_SETUP_ENV } },
        },
      });
      const project = await localProject(context, baselineUrl, candidateUrl, scenario);
      return withEnvironment({ [MISSING_SETUP_ENV]: undefined }, () => runVerification(project));
    },
    (run) => {
      assert.equal(requestCount, 0);
      assertInfrastructureError(run.evidence, 'HTTP_REQUEST_ENV_MISSING');
    },
  );
});

test('caller interruption is incomplete', { concurrency: false }, async (context) => {
  await runAcceptanceCase(
    'interrupted-verification',
    async () => {
      const baselineUrl = await startTarget(context, () => ({ body: { ready: true } }));
      const candidateUrl = await startTarget(context, () => ({
        body: { ready: true },
        delayMs: 300,
      }));
      const project = await localProject(context, baselineUrl, candidateUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40);
      try {
        return await runVerification(project, controller.signal);
      } finally {
        clearTimeout(timer);
      }
    },
    (run) => {
      assert.equal(run.result.envelope.code, 'CLI_INTERRUPTED');
      assertInfrastructureError(run.evidence, 'VERIFY_INTERRUPTED');
    },
  );
});

test('malformed configuration cannot emit passing evidence', {
  concurrency: false,
}, async (context) => {
  await runAcceptanceCase(
    'malformed-configuration',
    async () => runVerification(await createMalformedProject(context)),
    (run) => {
      assert.equal(run.result.envelope.status, 'invalid-input');
      assert.equal(run.result.envelope.code, 'CONFIG_PARSE_FAILED');
      assert.equal(run.evidence, undefined);
    },
  );
});
