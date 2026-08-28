import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';

import { ConfigLoadError, loadConfig, normalizeNetworkHost } from '@runtime-evidence/config';

const minimalConfig = `
schemaVersion: 1
project:
  name: "checkout-api"
targets:
  baseline:
    url: "http://127.0.0.1:4100"
  candidate:
    url:
      env: "CANDIDATE_URL"
    headers:
      authorization:
        env: "CANDIDATE_TOKEN"
scenarios:
  include:
    - "scenarios/*.yaml"
`;

const reorderedMinimalConfig = `
scenarios:
  include:
    - "scenarios/*.yaml"
targets:
  candidate:
    headers:
      authorization:
        env: "CANDIDATE_TOKEN"
    url:
      env: "CANDIDATE_URL"
  baseline:
    url: "http://127.0.0.1:4100"
project:
  name: "checkout-api"
schemaVersion: 1
`;

const environment = {
  CANDIDATE_TOKEN: 'test-token-value',
  CANDIDATE_URL: 'http://127.0.0.1:4200',
} as const;

async function createProject(context: TestContext, source = minimalConfig): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-config-'));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  await writeFile(join(directory, 'runtime-evidence.yaml'), source, 'utf8');
  return directory;
}

async function expectConfigError(action: () => Promise<unknown>): Promise<ConfigLoadError> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof ConfigLoadError);
    return error;
  }
  assert.fail('Expected configuration loading to fail.');
}

test('discovers a parent config, applies safe defaults, and resolves references', async (context) => {
  const project = await createProject(context);
  const nestedDirectory = join(project, 'packages', 'service');
  await mkdir(nestedDirectory, { recursive: true });

  const loaded = await loadConfig({ environment, startDirectory: nestedDirectory });

  assert.equal(loaded.path, join(project, 'runtime-evidence.yaml'));
  assert.equal(loaded.config.targets.candidate.url, environment.CANDIDATE_URL);
  assert.equal(loaded.config.targets.candidate.headers?.authorization, environment.CANDIDATE_TOKEN);
  assert.deepEqual(loaded.evidenceTargets, {
    baseline: 'http://127.0.0.1:4100',
    candidate: '[environment reference]',
  });
  assert.doesNotMatch(JSON.stringify(loaded.evidenceTargets), /4200/);
  assert.deepEqual(loaded.config.network, {
    default: 'deny',
    allowHosts: [],
    allowDependencyHosts: [],
  });
  assert.deepEqual(loaded.config.sideEffects, { allowStateChanging: false });
  assert.deepEqual(loaded.config.timeouts, { connectMs: 1_000, requestMs: 10_000 });
  assert.deepEqual(loaded.config.comparison, {
    ignoredJsonPaths: [],
    normalizedJsonPaths: [],
    maxLatencyRegressionPercent: 20,
  });
  assert.match(loaded.configHash, /^[a-f0-9]{64}$/);
});

test('applies typed overrides after file values and before validation', async (context) => {
  const project = await createProject(context);

  const loaded = await loadConfig({
    environment,
    overrides: {
      network: { allowHosts: ['api.internal'] },
      timeouts: { requestMs: 2_500 },
    },
    startDirectory: project,
  });

  assert.deepEqual(loaded.config.network, {
    default: 'deny',
    allowHosts: ['api.internal'],
    allowDependencyHosts: [],
  });
  assert.deepEqual(loaded.config.timeouts, { connectMs: 1_000, requestMs: 2_500 });
});

test('preserves target and hook isolation declarations in effective configuration', async (context) => {
  const project = await createProject(
    context,
    `schemaVersion: 1
project:
  name: "isolation-test"
targets:
  baseline:
    url: "http://127.0.0.1:4100"
    isolation:
      kind: "container"
      reference: "baseline-container"
  candidate:
    url:
      env: "CANDIDATE_URL"
    headers:
      authorization:
        env: "CANDIDATE_TOKEN"
    isolation:
      kind: "virtual-machine"
      reference: "candidate-vm"
network:
  default: "deny"
  allowHosts: ["127.0.0.1"]
  hookIsolation:
    kind: "container"
    reference: "verification-sandbox"
scenarios:
  include:
    - "scenarios/*.yaml"
`,
  );

  const loaded = await loadConfig({ environment, startDirectory: project });

  assert.equal(loaded.config.targets.baseline.isolation?.reference, 'baseline-container');
  assert.equal(loaded.config.targets.candidate.isolation?.kind, 'virtual-machine');
  assert.equal(loaded.config.network.hookIsolation?.reference, 'verification-sandbox');
});

test('equivalent effective configurations have the same secret-safe hash', async (context) => {
  const firstProject = await createProject(context, minimalConfig);
  const secondProject = await createProject(context, reorderedMinimalConfig);

  const first = await loadConfig({ environment, startDirectory: firstProject });
  const reordered = await loadConfig({ environment, startDirectory: secondProject });
  const changedSecrets = await loadConfig({
    environment: {
      CANDIDATE_TOKEN: 'a-different-token',
      CANDIDATE_URL: 'http://127.0.0.1:9999',
    },
    startDirectory: firstProject,
  });

  assert.equal(first.configHash, reordered.configHash);
  assert.equal(first.configHash, changedSecrets.configHash);
  assert.doesNotMatch(first.configHash, /test-token-value/);
});

test('rejects unknown security-sensitive fields after defaults are applied', async (context) => {
  const project = await createProject(
    context,
    `${minimalConfig}
network:
  default: "deny"
  allowHosts: []
  allowEverything: true
`,
  );

  const error = await expectConfigError(() => loadConfig({ environment, startDirectory: project }));

  assert.equal(error.code, 'CONFIG_VALIDATION_FAILED');
  assert.ok(error.diagnostics.some(({ path }) => path === '/network/allowEverything'));
});

test('rejects invalid and normalized-duplicate network allowlist entries', async (context) => {
  const invalidProject = await createProject(
    context,
    `${minimalConfig}
network:
  default: "deny"
  allowHosts: ["https://api.internal"]
`,
  );
  const invalid = await expectConfigError(() =>
    loadConfig({ environment, startDirectory: invalidProject }),
  );
  assert.equal(invalid.code, 'CONFIG_VALIDATION_FAILED');
  assert.equal(invalid.diagnostics[0]?.path, '/network/allowHosts/0');

  const duplicateProject = await createProject(
    context,
    `${minimalConfig}
network:
  default: "deny"
  allowHosts: ["API.internal", "api.internal."]
`,
  );
  const duplicate = await expectConfigError(() =>
    loadConfig({ environment, startDirectory: duplicateProject }),
  );
  assert.equal(duplicate.code, 'CONFIG_VALIDATION_FAILED');
  assert.equal(duplicate.diagnostics[0]?.path, '/network/allowHosts/1');
});

test('normalizes DNS and IP allowlist entries without accepting authority syntax', () => {
  assert.equal(normalizeNetworkHost('API.Internal.'), 'api.internal');
  assert.equal(normalizeNetworkHost('[::1]'), '::1');
  assert.equal(normalizeNetworkHost('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeNetworkHost('api.internal:443'), undefined);
  assert.equal(normalizeNetworkHost('*.internal'), undefined);
  assert.equal(normalizeNetworkHost('https://api.internal'), undefined);
});

test('reports a missing environment reference by field path without a value', async (context) => {
  const project = await createProject(context);

  const error = await expectConfigError(() =>
    loadConfig({ environment: { CANDIDATE_TOKEN: 'present' }, startDirectory: project }),
  );

  assert.equal(error.code, 'CONFIG_ENV_MISSING');
  assert.equal(error.diagnostics[0]?.path, '/targets/candidate/url');
  assert.doesNotMatch(JSON.stringify(error), /present/);
});

test('rejects inline sensitive headers without echoing the value', async (context) => {
  const inlineSecret = 'do-not-print-this-token';
  const project = await createProject(
    context,
    `
schemaVersion: 1
project:
  name: "checkout-api"
targets:
  baseline:
    url: "http://127.0.0.1:4100"
  candidate:
    url: "http://127.0.0.1:4200"
    headers:
      authorization: "${inlineSecret}"
scenarios:
  include:
    - "scenarios/*.yaml"
`,
  );

  const error = await expectConfigError(() => loadConfig({ startDirectory: project }));

  assert.equal(error.code, 'CONFIG_INLINE_SECRET');
  assert.equal(error.diagnostics[0]?.path, '/targets/candidate/headers/authorization');
  assert.doesNotMatch(JSON.stringify(error), new RegExp(inlineSecret));
});

test('uses a stable parse diagnostic without returning source content', async (context) => {
  const sourceSecret = 'source-secret-must-not-leak';
  const project = await createProject(
    context,
    `project: ["unterminated\nsecret: "${sourceSecret}"`,
  );

  const error = await expectConfigError(() => loadConfig({ startDirectory: project }));

  assert.equal(error.code, 'CONFIG_PARSE_FAILED');
  assert.doesNotMatch(JSON.stringify(error), new RegExp(sourceSecret));
});

test('rejects unsafe override keys before merging', async (context) => {
  const project = await createProject(context);
  const overrides = JSON.parse('{"network":{"__proto__":{"allowEverything":true}}}') as never;

  const error = await expectConfigError(() =>
    loadConfig({ environment, overrides, startDirectory: project }),
  );

  assert.equal(error.code, 'CONFIG_UNSAFE_KEY');
  assert.equal(error.diagnostics[0]?.path, '/network/__proto__');
});

test('reports a stable error when no configuration can be discovered', async (context) => {
  const emptyDirectory = await mkdtemp(join(tmpdir(), 'runtime-evidence-empty-'));
  context.after(async () => rm(emptyDirectory, { force: true, recursive: true }));

  const error = await expectConfigError(() => loadConfig({ startDirectory: emptyDirectory }));

  assert.equal(error.code, 'CONFIG_NOT_FOUND');
  assert.equal(error.diagnostics[0]?.path, '/');
});
