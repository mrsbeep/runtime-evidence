import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';
import {
  loadScenarios,
  ScenarioLifecycleError,
  ScenarioLoadError,
  runScenarioLifecycle,
  type ScenarioHook,
} from '@runtime-evidence/orchestrator';

const hookHelperPath = fileURLToPath(new URL('./fixtures/hook-helper.ts', import.meta.url));

function scenario(
  id: string,
  options: Partial<Pick<ScenarioV1, 'cleanup' | 'setup'>> = {},
): ScenarioV1 {
  return {
    schemaVersion: 1,
    id,
    name: `Scenario ${id}`,
    tags: ['smoke', 'readiness'],
    provenance: {
      source: 'hand-authored',
      reference: `test/${id}`,
    },
    safety: {
      classification: 'read-only',
      rationale: 'Reads a local test endpoint without changing state.',
    },
    request: {
      method: 'GET',
      path: '/health',
      headers: {
        authorization: { env: 'SCENARIO_TOKEN' },
      },
    },
    ...options,
  };
}

async function createProject(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-scenarios-'));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  return directory;
}

async function writeScenario(root: string, relativePath: string, value: unknown): Promise<void> {
  const filePath = join(root, ...relativePath.split('/'));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function writeScenarioSource(
  root: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const filePath = join(root, ...relativePath.split('/'));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, source, 'utf8');
}

async function expectLoadError(action: () => Promise<unknown>): Promise<ScenarioLoadError> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof ScenarioLoadError);
    return error;
  }
  assert.fail('Expected scenario loading to fail.');
}

async function expectLifecycleError(
  action: () => Promise<unknown>,
): Promise<ScenarioLifecycleError> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof ScenarioLifecycleError);
    return error;
  }
  assert.fail('Expected scenario lifecycle to fail.');
}

function helperHook(
  logPath: string,
  value: string,
  options: {
    readonly delayMs?: number;
    readonly env?: ScenarioHook['env'];
    readonly exitCode?: number;
    readonly mode?: 'append' | 'environment';
    readonly timeoutMs?: number;
  } = {},
): ScenarioHook {
  return {
    command: process.execPath,
    args: [
      hookHelperPath,
      options.mode ?? 'append',
      logPath,
      value,
      String(options.delayMs ?? 0),
      String(options.exitCode ?? 0),
    ],
    ...(options.env === undefined ? {} : { env: options.env }),
    timeoutMs: options.timeoutMs ?? 2_000,
  };
}

test('discovers portable paths deterministically and preserves scenario metadata', async (context) => {
  const project = await createProject(context);
  const classifications = ['safe', 'mocked', 'read-only', 'state-changing'] as const;

  await writeScenarioSource(
    project,
    'scenarios/nested/0-safe.yaml',
    `
schemaVersion: 1
id: "scenario-safe"
name: "Scenario scenario-safe"
tags:
  - "smoke"
  - "readiness"
provenance:
  source: "hand-authored"
  reference: "test/scenario-safe"
safety:
  classification: "safe"
  rationale: "Classification safe is explicit for this test."
request:
  method: "GET"
  path: "/health"
  headers:
    authorization:
      env: "SCENARIO_TOKEN"
`,
  );

  for (const [index, classification] of classifications.slice(1).entries()) {
    await writeScenario(project, `scenarios/nested/${index + 1}-${classification}.yaml`, {
      ...scenario(`scenario-${classification}`),
      safety: {
        classification,
        rationale: `Classification ${classification} is explicit for this test.`,
      },
    });
  }
  await writeScenario(project, 'scenarios/excluded/ignored.yml', scenario('ignored'));

  const loaded = await loadScenarios({
    rootDirectory: project,
    include: ['scenarios/**/*.{yaml,yml}'],
    exclude: ['scenarios/excluded/**'],
  });

  assert.deepEqual(
    loaded.map(({ relativePath }) => relativePath),
    [
      'scenarios/nested/0-safe.yaml',
      'scenarios/nested/1-mocked.yaml',
      'scenarios/nested/2-read-only.yaml',
      'scenarios/nested/3-state-changing.yaml',
    ],
  );
  assert.deepEqual(
    loaded.map(({ scenario: loadedScenario }) => loadedScenario.safety.classification),
    classifications,
  );
  assert.deepEqual(loaded[0]?.scenario.tags, ['smoke', 'readiness']);
  assert.deepEqual(loaded[0]?.scenario.provenance, {
    source: 'hand-authored',
    reference: 'test/scenario-safe',
  });
  assert.deepEqual(loaded[0]?.scenario.request.headers?.authorization, {
    env: 'SCENARIO_TOKEN',
  });
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded[0]?.scenario));
});

test('reports duplicate identifiers in stable file order', async (context) => {
  const project = await createProject(context);
  await writeScenario(project, 'scenarios/a.yaml', scenario('duplicate'));
  await writeScenario(project, 'scenarios/b.yaml', scenario('duplicate'));

  const error = await expectLoadError(() =>
    loadScenarios({ rootDirectory: project, include: ['scenarios/*.yaml'] }),
  );

  assert.equal(error.code, 'SCENARIO_DUPLICATE_ID');
  assert.equal(error.diagnostics.length, 2);
  assert.ok(error.diagnostics[0]?.filePath?.endsWith(join('scenarios', 'a.yaml')));
  assert.ok(error.diagnostics[1]?.filePath?.endsWith(join('scenarios', 'b.yaml')));
  assert.ok(error.diagnostics.every(({ path }) => path === '/id'));
});

test('validates a scenario before it can execute', async (context) => {
  const project = await createProject(context);
  const invalid = scenario('missing-safety') as unknown as Record<string, unknown>;
  delete invalid.safety;
  await writeScenario(project, 'scenarios/invalid.yaml', invalid);

  const error = await expectLoadError(() =>
    loadScenarios({ rootDirectory: project, include: ['scenarios/*.yaml'] }),
  );

  assert.equal(error.code, 'SCENARIO_VALIDATION_FAILED');
  assert.ok(error.diagnostics.some(({ path }) => path === '/safety'));
});

test('rejects inline secrets without returning their values', async (context) => {
  const project = await createProject(context);
  const inlineSecret = 'never-return-this-value';
  const unsafeScenario = scenario('inline-secret', {
    setup: [
      {
        command: process.execPath,
        args: [],
        env: { API_TOKEN: inlineSecret },
        timeoutMs: 1_000,
      },
    ],
  });
  await writeScenario(project, 'scenarios/unsafe.yaml', unsafeScenario);

  const error = await expectLoadError(() =>
    loadScenarios({ rootDirectory: project, include: ['scenarios/*.yaml'] }),
  );

  assert.equal(error.code, 'SCENARIO_INLINE_SECRET');
  assert.equal(error.diagnostics[0]?.path, '/setup/0/env/API_TOKEN');
  assert.doesNotMatch(JSON.stringify(error), new RegExp(inlineSecret));
});

test('rejects platform-specific and traversing discovery patterns', async (context) => {
  const project = await createProject(context);

  for (const pattern of ['scenarios\\*.yaml', '../scenarios/*.yaml']) {
    const error = await expectLoadError(() =>
      loadScenarios({ rootDirectory: project, include: [pattern] }),
    );
    assert.equal(error.code, 'SCENARIO_PATTERN_INVALID');
    assert.equal(error.diagnostics[0]?.path, '/include/0');
  }
});

test('runs setup, operation, and cleanup in order with late environment resolution', async (context) => {
  const project = await createProject(context);
  const logPath = join(project, 'lifecycle.log');
  const marker = 'resolved-at-hook-start';
  const loadedScenario = scenario('successful-lifecycle', {
    setup: [
      helperHook(logPath, 'HOOK_TOKEN', {
        env: { HOOK_TOKEN: { env: 'SCENARIO_TOKEN' } },
        mode: 'environment',
      }),
    ],
    cleanup: [helperHook(logPath, 'cleanup')],
  });

  const result = await runScenarioLifecycle(
    loadedScenario,
    async () => {
      await appendFile(logPath, 'operation\n', 'utf8');
      return 'complete';
    },
    {
      cwd: project,
      environment: { SCENARIO_TOKEN: marker },
    },
  );

  assert.equal(result, 'complete');
  assert.equal(await readFile(logPath, 'utf8'), `${marker}\noperation\ncleanup\n`);
});

test('attempts cleanup after an operation failure', async (context) => {
  const project = await createProject(context);
  const logPath = join(project, 'failure.log');
  const loadedScenario = scenario('failed-operation', {
    cleanup: [helperHook(logPath, 'cleanup-after-failure')],
  });

  const error = await expectLifecycleError(() =>
    runScenarioLifecycle(
      loadedScenario,
      () => {
        throw new Error('operation failed');
      },
      { cwd: project },
    ),
  );

  assert.equal(error.code, 'SCENARIO_OPERATION_FAILED');
  assert.equal(await readFile(logPath, 'utf8'), 'cleanup-after-failure\n');
});

test('times out setup and still attempts cleanup', async (context) => {
  const project = await createProject(context);
  const logPath = join(project, 'timeout.log');
  const loadedScenario = scenario('timed-out-setup', {
    setup: [helperHook(logPath, 'late-setup', { delayMs: 1_000, timeoutMs: 25 })],
    cleanup: [helperHook(logPath, 'cleanup-after-timeout')],
  });

  const error = await expectLifecycleError(() =>
    runScenarioLifecycle(loadedScenario, () => 'not-run', {
      cwd: project,
      terminationGraceMs: 25,
    }),
  );

  assert.equal(error.code, 'SCENARIO_HOOK_TIMEOUT');
  assert.equal(error.phase, 'setup');
  assert.equal(await readFile(logPath, 'utf8'), 'cleanup-after-timeout\n');
});

test('attempts cleanup when the operation is interrupted', async (context) => {
  const project = await createProject(context);
  const logPath = join(project, 'abort.log');
  const controller = new AbortController();
  const loadedScenario = scenario('aborted-operation', {
    cleanup: [helperHook(logPath, 'cleanup-after-abort')],
  });

  const lifecycle = runScenarioLifecycle(
    loadedScenario,
    (signal) =>
      new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    { cwd: project, signal: controller.signal },
  );
  controller.abort();

  const error = await expectLifecycleError(() => lifecycle);
  assert.equal(error.code, 'SCENARIO_OPERATION_ABORTED');
  assert.equal(await readFile(logPath, 'utf8'), 'cleanup-after-abort\n');
});

test('attempts every cleanup hook and reports cleanup failure', async (context) => {
  const project = await createProject(context);
  const logPath = join(project, 'cleanup.log');
  const loadedScenario = scenario('failed-cleanup', {
    cleanup: [helperHook(logPath, 'first', { exitCode: 2 }), helperHook(logPath, 'second')],
  });

  const error = await expectLifecycleError(() =>
    runScenarioLifecycle(loadedScenario, () => 'operation-complete', { cwd: project }),
  );

  assert.equal(error.code, 'SCENARIO_CLEANUP_FAILED');
  assert.equal(error.cleanupFailures.length, 1);
  assert.equal(error.cleanupFailures[0]?.code, 'SCENARIO_HOOK_FAILED');
  assert.equal(await readFile(logPath, 'utf8'), 'first\nsecond\n');
});
