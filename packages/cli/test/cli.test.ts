import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { loadConfig } from '@runtime-evidence/config';
import {
  createEvidenceArtifact,
  serializeEvidenceArtifact,
} from '@runtime-evidence/evidence-schema';

import { mixedEvidencePayload } from '../../../tests/fixtures/evidence.ts';
import {
  type CliCommandHandler,
  type CliIo,
  type CliOutputEnvelope,
  type CliRunOptions,
  type CliStatus,
  runCli,
} from '../src/index.ts';

interface Harness {
  readonly io: CliIo;
  readonly stderr: string[];
  readonly stdout: string[];
}

function createHarness(): Harness {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    io: {
      stderr: (text) => stderr.push(text),
      stdout: (text) => stdout.push(text),
    },
    stderr,
    stdout,
  };
}

async function temporaryDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-cli-'));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  return directory;
}

function parseOnlyEnvelope(harness: Harness): CliOutputEnvelope {
  assert.equal(harness.stdout.length, 1);
  return JSON.parse(harness.stdout[0] ?? '') as CliOutputEnvelope;
}

test('root and every v0.1 command expose help', async () => {
  for (const arguments_ of [
    ['--help'],
    ['init', '--help'],
    ['doctor', '--help'],
    ['capture', '--help'],
    ['verify', '--help'],
    ['report', '--help'],
    ['schema', '--help'],
  ]) {
    const harness = createHarness();
    const result = await runCli(arguments_, { io: harness.io });
    assert.equal(result.exitCode, 0, arguments_.join(' '));
    assert.match(harness.stdout.join(''), /Usage:/);
    assert.equal(harness.stderr.join(''), '');
  }
});

test('JSON help and version envelopes include their requested content', async () => {
  const helpHarness = createHarness();
  await runCli(['--help', '--json'], { io: helpHarness.io });
  assert.match((parseOnlyEnvelope(helpHarness).data as { text: string }).text, /Usage:/);

  const commandHelpHarness = createHarness();
  await runCli(['doctor', '--help', '--json'], { io: commandHelpHarness.io });
  assert.equal(
    (parseOnlyEnvelope(commandHelpHarness).data as { command: string }).command,
    'doctor',
  );

  const versionHarness = createHarness();
  await runCli(['--version', '--json'], { io: versionHarness.io });
  assert.equal((parseOnlyEnvelope(versionHarness).data as { version: string }).version, '0.0.0');
});

test('JSON mode keeps its single envelope separate from progress', async () => {
  const harness = createHarness();
  const result = await runCli(['doctor', '--json'], {
    handlers: {
      doctor: (context) => {
        context.progress('Checking local state.');
        return {
          code: 'TEST_OK',
          data: { ready: true },
          message: 'Ready.',
          status: 'success',
        };
      },
    },
    io: harness.io,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(harness.stderr.join(''), 'Checking local state.\n');
  assert.deepEqual(parseOnlyEnvelope(harness), {
    code: 'TEST_OK',
    command: 'doctor',
    data: { ready: true },
    diagnostics: [],
    exitCode: 0,
    message: 'Ready.',
    schemaVersion: 1,
    status: 'success',
  });
});

test('statuses map to stable, distinct process exit codes', async (context) => {
  const cases: readonly [CliStatus, number][] = [
    ['success', 0],
    ['behavioral-failure', 1],
    ['invalid-input', 2],
    ['incomplete', 3],
    ['infrastructure-failure', 4],
  ];
  for (const [status, exitCode] of cases) {
    await context.test(status, async () => {
      const harness = createHarness();
      const handler: CliCommandHandler = () => ({ code: 'TEST_STATUS', message: status, status });
      const result = await runCli(['doctor', '--json'], {
        handlers: { doctor: handler },
        io: harness.io,
      });
      assert.equal(result.exitCode, exitCode);
      assert.equal(parseOnlyEnvelope(harness).exitCode, exitCode);
    });
  }
});

test('argument errors are deterministic and machine-readable', async () => {
  const cases: readonly [readonly string[], string][] = [
    [['--json'], 'CLI_COMMAND_REQUIRED'],
    [['unknown', '--json'], 'CLI_COMMAND_UNKNOWN'],
    [['doctor', '--unknown', '--json'], 'CLI_OPTION_UNKNOWN'],
    [['capture', '--json'], 'CLI_OPTION_REQUIRED'],
    [['report', '--json'], 'CLI_OPTION_REQUIRED'],
    [['schema', '--kind', 'nope', '--json'], 'CLI_OPTION_INVALID'],
    [['verify', '--total-timeout-ms', '0', '--json'], 'CLI_OPTION_INVALID'],
    [['doctor', '--config', 'a', '--config', 'b', '--json'], 'CLI_OPTION_DUPLICATE'],
  ];
  for (const [arguments_, code] of cases) {
    const harness = createHarness();
    const result = await runCli(arguments_, { io: harness.io });
    assert.equal(result.exitCode, 2, arguments_.join(' '));
    assert.equal(parseOnlyEnvelope(harness).code, code);
  }
});

test('an interrupted command can never report success', async () => {
  const harness = createHarness();
  const abortController = new AbortController();
  const result = await runCli(['doctor', '--json'], {
    handlers: {
      doctor: () => {
        abortController.abort();
        return { code: 'UNSAFE_PASS', message: 'Passed.', status: 'success' };
      },
    },
    io: harness.io,
    signal: abortController.signal,
  });

  assert.equal(result.exitCode, 3);
  assert.equal(parseOnlyEnvelope(harness).code, 'CLI_INTERRUPTED');
});

test('an invalid runtime handler override fails closed', async () => {
  const harness = createHarness();
  const handlers = { doctor: undefined } as unknown as NonNullable<CliRunOptions['handlers']>;
  const result = await runCli(['doctor', '--json'], { handlers, io: harness.io });

  assert.equal(result.exitCode, 4);
  assert.equal(parseOnlyEnvelope(harness).code, 'CLI_HANDLER_UNAVAILABLE');
});

test('verify fails closed until its enforcement dependencies land', async () => {
  const harness = createHarness();
  const result = await runCli(['verify', '--json'], { io: harness.io });
  const envelope = parseOnlyEnvelope(harness);
  assert.equal(result.exitCode, 3);
  assert.equal(envelope.status, 'incomplete');
});

test('init creates a valid fail-closed config and refuses accidental replacement', async (context) => {
  const directory = await temporaryDirectory(context);
  const harness = createHarness();
  const initialized = await runCli(
    ['init', '--yes', '--project', 'checkout-api', '--directory', directory, '--json'],
    { cwd: directory, io: harness.io },
  );

  assert.equal(initialized.exitCode, 0);
  const loaded = await loadConfig({ startDirectory: directory });
  assert.equal(loaded.config.project.name, 'checkout-api');
  assert.deepEqual(loaded.config.network, { default: 'deny', allowHosts: ['127.0.0.1'] });
  assert.ok(loaded.config.redaction.headers.includes('authorization'));

  const secondHarness = createHarness();
  const repeated = await runCli(['init', '--yes', '--directory', directory, '--json'], {
    cwd: directory,
    io: secondHarness.io,
  });
  assert.equal(repeated.exitCode, 2);
  assert.equal(parseOnlyEnvelope(secondHarness).code, 'CLI_CONFIG_EXISTS');

  const forceHarness = createHarness();
  const replaced = await runCli(
    ['init', '--yes', '--force', '--project', 'replacement', '--directory', directory, '--json'],
    { cwd: directory, io: forceHarness.io },
  );
  assert.equal(replaced.exitCode, 0);
  assert.equal(
    (await loadConfig({ startDirectory: directory })).config.project.name,
    'replacement',
  );
});

test('doctor returns safe config metadata without resolved target values', async (context) => {
  const directory = await temporaryDirectory(context);
  await runCli(['init', '--yes', '--project', 'doctor-test', '--directory', directory], {
    cwd: directory,
    io: createHarness().io,
  });
  const harness = createHarness();
  const result = await runCli(['doctor', '--json'], { cwd: directory, io: harness.io });
  const envelope = parseOnlyEnvelope(harness);

  assert.equal(result.exitCode, 0);
  assert.equal((envelope.data as { project: string }).project, 'doctor-test');
  assert.doesNotMatch(harness.stdout.join(''), /127\.0\.0\.1:4[12]00/);
});

test('capture previews before saving and never emits or persists raw secrets', async (context) => {
  const directory = await temporaryDirectory(context);
  const inputPath = join(directory, 'capture.json');
  const outputDirectory = join(directory, 'captured-scenarios');
  const scenarioPath = join(outputDirectory, 'create-order.yaml');
  const representativeSecret = 'not-a-real-capture-secret-value';
  await runCli(['init', '--yes', '--directory', directory], {
    cwd: directory,
    io: createHarness().io,
  });
  await writeFile(inputPath, Buffer.from([0xff]));
  const invalidEncodingHarness = createHarness();
  const invalidEncoding = await runCli(['capture', '--input', inputPath, '--json'], {
    cwd: directory,
    io: invalidEncodingHarness.io,
  });
  assert.equal(invalidEncoding.exitCode, 2);
  assert.equal(parseOnlyEnvelope(invalidEncodingHarness).code, 'CLI_CAPTURE_INPUT_INVALID');

  await writeFile(
    inputPath,
    JSON.stringify({
      id: 'create-order',
      name: 'Create an order',
      safety: { classification: 'mocked', rationale: 'Disposable local target.' },
      request: {
        method: 'POST',
        path: '/orders',
        headers: { authorization: `Bearer ${representativeSecret}` },
        body: { password: representativeSecret, sku: 'example-item' },
      },
    }),
    'utf8',
  );

  const previewHarness = createHarness();
  const preview = await runCli(
    ['capture', '--input', inputPath, '--output', outputDirectory, '--json'],
    { cwd: directory, io: previewHarness.io },
  );
  assert.equal(preview.exitCode, 3);
  assert.equal(parseOnlyEnvelope(previewHarness).code, 'CLI_CAPTURE_CONFIRMATION_REQUIRED');
  assert.doesNotMatch(
    `${previewHarness.stdout.join('')} ${previewHarness.stderr.join('')}`,
    new RegExp(representativeSecret),
  );
  await assert.rejects(readFile(scenarioPath, 'utf8'));

  const saveHarness = createHarness();
  const saved = await runCli(
    ['capture', '--input', inputPath, '--output', outputDirectory, '--yes', '--json'],
    { cwd: directory, io: saveHarness.io },
  );
  const savedContent = await readFile(scenarioPath, 'utf8');
  assert.equal(saved.exitCode, 0);
  assert.equal(parseOnlyEnvelope(saveHarness).code, 'CLI_CAPTURE_SAVED');
  assert.doesNotMatch(
    `${saveHarness.stdout.join('')} ${saveHarness.stderr.join('')} ${savedContent}`,
    new RegExp(representativeSecret),
  );
  assert.equal(JSON.parse(savedContent).provenance.redaction.applied, true);
});

test('schema emits the requested versioned schema', async () => {
  const harness = createHarness();
  const result = await runCli(['schema', '--kind', 'evidence', '--json'], { io: harness.io });
  const envelope = parseOnlyEnvelope(harness);
  const data = envelope.data as { kind: string; schema: { $id: string } };

  assert.equal(result.exitCode, 0);
  assert.equal(data.kind, 'evidence');
  assert.equal(data.schema.$id, 'urn:runtime-evidence:schema:evidence:v1');
});

test('report validates canonical evidence and renders CI output', async (context) => {
  const directory = await temporaryDirectory(context);
  const evidencePath = join(directory, 'evidence.json');
  const reportPath = join(directory, 'evidence.junit.xml');
  const evidence = createEvidenceArtifact(mixedEvidencePayload());
  await writeFile(evidencePath, serializeEvidenceArtifact(evidence), 'utf8');
  await writeFile(reportPath, 'stale report', 'utf8');

  const harness = createHarness();
  const result = await runCli(
    ['report', '--input', evidencePath, '--format', 'junit', '--output', reportPath, '--json'],
    { cwd: directory, io: harness.io },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(parseOnlyEnvelope(harness).code, 'CLI_REPORT_WRITTEN');
  assert.match(await readFile(reportPath, 'utf8'), /<testsuites .*failures="1" errors="1"/);
});
