import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';
import {
  type ScenarioHook,
  type VerificationResult,
  type VerifyScenarioOptions,
  verifyScenario,
} from '@runtime-evidence/orchestrator';

const hookHelperPath = fileURLToPath(new URL('./fixtures/hook-helper.ts', import.meta.url));

interface ReceivedRequest {
  readonly body: string;
  readonly method: string | undefined;
  readonly scenarioHeader: string | undefined;
  readonly targetHeader: string | undefined;
  readonly url: string | undefined;
}

function scenario(
  options: Partial<Pick<ScenarioV1, 'cleanup' | 'request' | 'safety' | 'setup'>> = {},
): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: 'verify-http',
    name: 'Verify HTTP',
    provenance: { source: 'test-adapter' },
    safety: { classification: 'read-only', rationale: 'Uses disposable local HTTP targets.' },
    request: { method: 'GET', path: '/health' },
    ...options,
  };
}

function config(
  baselineUrl: string,
  candidateUrl: string,
  requestTimeoutMs = 500,
): VerifyScenarioOptions['config'] {
  return {
    targets: {
      baseline: { headers: { 'x-target': 'baseline' }, url: baselineUrl },
      candidate: { headers: { 'x-target': 'candidate' }, url: candidateUrl },
    },
    network: { default: 'deny', allowHosts: ['127.0.0.1'] },
    timeouts: { connectMs: 500, requestMs: requestTimeoutMs },
  };
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function startServer(context: TestContext, listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  context.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closedTargetUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}`;
}

function execute(
  configured: VerifyScenarioOptions['config'],
  testScenario: ScenarioV1,
  options: Partial<Omit<VerifyScenarioOptions, 'config' | 'cwd' | 'scenario'>> = {},
): Promise<VerificationResult> {
  return verifyScenario({
    config: configured,
    cwd: process.cwd(),
    scenario: testScenario,
    totalTimeoutMs: 2_000,
    ...options,
  });
}

function receivedRequest(request: IncomingMessage, body: string): ReceivedRequest {
  return {
    body,
    method: request.method,
    scenarioHeader: request.headers['x-scenario'] as string | undefined,
    targetHeader: request.headers['x-target'] as string | undefined,
    url: request.url,
  };
}

function hook(logPath: string, value: string, exitCode: number): ScenarioHook {
  return {
    command: process.execPath,
    args: [hookHelperPath, 'append', logPath, value, '0', String(exitCode)],
    timeoutMs: 2_000,
  };
}

test('executes an identical scenario against both targets and captures typed observations', async (context) => {
  const baselineRequests: ReceivedRequest[] = [];
  const candidateRequests: ReceivedRequest[] = [];
  const baselineUrl = await startServer(context, (request, response) => {
    void requestBody(request).then((body) => {
      baselineRequests.push(receivedRequest(request, body));
      response.writeHead(200, { 'content-type': 'application/json', 'x-version': 'baseline' });
      response.end('{"version":"baseline"}');
    });
  });
  const candidateUrl = await startServer(context, (request, response) => {
    void requestBody(request).then((body) => {
      candidateRequests.push(receivedRequest(request, body));
      response.writeHead(202, { 'content-type': 'application/json', 'x-version': 'candidate' });
      response.end('{"version":"candidate"}');
    });
  });
  const testScenario = scenario({
    request: {
      method: 'POST',
      path: '/orders',
      query: { page: '1' },
      headers: { 'x-scenario': 'same' },
      body: { sku: 'book' },
    },
  });

  const result = await execute(config(baselineUrl, candidateUrl), testScenario, {
    revisions: { baseline: 'base-sha', candidate: 'candidate-sha' },
    selectedResponseHeaders: ['content-type', 'x-version'],
  });

  assert.equal(result.status, 'complete');
  assert.notEqual(result.status, 'pass');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    baselineRequests.map(({ targetHeader: _targetHeader, ...request }) => request),
    candidateRequests.map(({ targetHeader: _targetHeader, ...request }) => request),
  );
  assert.deepEqual(baselineRequests, [
    {
      body: '{"sku":"book"}',
      method: 'POST',
      scenarioHeader: 'same',
      targetHeader: 'baseline',
      url: '/orders?page=1',
    },
  ]);
  assert.equal(result.observations.baseline?.response.statusCode, 200);
  assert.equal(result.observations.candidate?.response.statusCode, 202);
  assert.equal(result.observations.baseline?.target.revision, 'base-sha');
  assert.equal(result.observations.candidate?.target.revision, 'candidate-sha');
  assert.deepEqual(result.observations.candidate?.response.headers['x-version'], ['candidate']);
});

test('a candidate-only unavailable target produces an incomplete result', async (context) => {
  const baselineUrl = await startServer(context, (_request, response) => response.end('ready'));
  const candidateUrl = await closedTargetUrl();

  const result = await execute(config(baselineUrl, candidateUrl), scenario());

  assert.equal(result.status, 'incomplete');
  assert.ok(result.observations.baseline !== null);
  assert.equal(result.observations.candidate, null);
  assert.ok(
    result.failures.some(
      ({ code, kind, target }) =>
        code === 'HTTP_TARGET_UNAVAILABLE' && kind === 'target' && target === 'candidate',
    ),
  );
});

test('distinguishes a candidate request timeout', async (context) => {
  const baselineUrl = await startServer(context, (_request, response) => response.end('ready'));
  const candidateUrl = await startServer(context, (_request, response) => {
    setTimeout(() => response.end('late'), 150).unref();
  });

  const result = await execute(config(baselineUrl, candidateUrl, 25), scenario());

  assert.equal(result.status, 'incomplete');
  assert.ok(
    result.failures.some(
      ({ code, kind, target }) =>
        code === 'HTTP_REQUEST_TIMEOUT' && kind === 'timeout' && target === 'candidate',
    ),
  );
});

test('distinguishes a candidate transport failure', async (context) => {
  const baselineUrl = await startServer(context, (_request, response) => response.end('ready'));
  const candidateUrl = await startServer(context, (_request, response) => {
    response.writeHead(200, { 'content-length': '100' });
    response.write('partial');
    response.socket?.destroy();
  });

  const result = await execute(config(baselineUrl, candidateUrl), scenario());

  assert.equal(result.status, 'incomplete');
  assert.ok(
    result.failures.some(
      ({ code, kind, target }) =>
        code === 'HTTP_TRANSPORT_ERROR' && kind === 'transport' && target === 'candidate',
    ),
  );
});

test('setup failure is distinct and cleanup is still attempted', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-verify-'));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  const logPath = join(directory, 'hooks.log');
  const testScenario = scenario({
    setup: [hook(logPath, 'setup', 2)],
    cleanup: [hook(logPath, 'cleanup', 0)],
  });

  const result = await execute(config('http://127.0.0.1:1', 'http://127.0.0.1:1'), testScenario, {
    totalTimeoutMs: 3_000,
  });

  assert.equal(result.status, 'incomplete');
  assert.ok(
    result.failures.some(
      ({ code, kind, phase }) =>
        code === 'SCENARIO_HOOK_FAILED' && kind === 'setup' && phase === 'setup',
    ),
  );
  assert.equal(await readFile(logPath, 'utf8'), 'setup\ncleanup\n');
});

test('cleanup failure preserves observations but makes the result incomplete', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-cleanup-'));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  const logPath = join(directory, 'cleanup.log');
  const baselineUrl = await startServer(context, (_request, response) => response.end('ready'));
  const candidateUrl = await startServer(context, (_request, response) => response.end('ready'));
  const testScenario = scenario({ cleanup: [hook(logPath, 'cleanup', 2)] });

  const result = await execute(config(baselineUrl, candidateUrl), testScenario);

  assert.equal(result.status, 'incomplete');
  assert.ok(result.observations.baseline !== null);
  assert.ok(result.observations.candidate !== null);
  assert.ok(
    result.failures.some(
      ({ code, kind, phase }) =>
        code === 'SCENARIO_HOOK_FAILED' && kind === 'cleanup' && phase === 'cleanup',
    ),
  );
  assert.equal(await readFile(logPath, 'utf8'), 'cleanup\n');
});

test('total timeout interrupts requests and produces an incomplete result', async (context) => {
  const delayed: RequestListener = (_request, response) => {
    setTimeout(() => response.end('late'), 200).unref();
  };
  const baselineUrl = await startServer(context, delayed);
  const candidateUrl = await startServer(context, delayed);

  const result = await execute(config(baselineUrl, candidateUrl, 1_000), scenario(), {
    totalTimeoutMs: 25,
  });

  assert.equal(result.status, 'incomplete');
  assert.ok(
    result.failures.some(({ code, kind }) => code === 'VERIFY_TOTAL_TIMEOUT' && kind === 'timeout'),
  );
  assert.equal(result.observations.baseline, null);
  assert.equal(result.observations.candidate, null);
});

test('caller interruption produces an incomplete result', async (context) => {
  const delayed: RequestListener = (_request, response) => {
    setTimeout(() => response.end('late'), 200).unref();
  };
  const baselineUrl = await startServer(context, delayed);
  const candidateUrl = await startServer(context, delayed);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 25).unref();

  const result = await execute(config(baselineUrl, candidateUrl, 1_000), scenario(), {
    signal: controller.signal,
  });

  assert.equal(result.status, 'incomplete');
  assert.ok(
    result.failures.some(
      ({ code, kind }) => code === 'VERIFY_INTERRUPTED' && kind === 'interrupted',
    ),
  );
});

test('deny-by-default network policy prevents execution', async (context) => {
  let requestCount = 0;
  const targetUrl = await startServer(context, (_request, response) => {
    requestCount += 1;
    response.end('unexpected');
  });
  const configured = config(targetUrl, targetUrl);
  configured.network.allowHosts.splice(0);

  const result = await execute(configured, scenario());

  assert.equal(result.status, 'incomplete');
  assert.equal(requestCount, 0);
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.every(({ code }) => code === 'VERIFY_NETWORK_DENIED'));
});

test('state-changing scenarios fail closed before execution', async (context) => {
  let requestCount = 0;
  const targetUrl = await startServer(context, (_request, response) => {
    requestCount += 1;
    response.end('unexpected');
  });
  const testScenario = scenario({
    safety: {
      classification: 'state-changing',
      rationale: 'Mutates server state and therefore requires explicit permission.',
    },
  });

  const result = await execute(config(targetUrl, targetUrl), testScenario);

  assert.equal(result.status, 'incomplete');
  assert.equal(requestCount, 0);
  assert.deepEqual(
    result.failures.map(({ code }) => code),
    ['VERIFY_SIDE_EFFECT_DENIED'],
  );
});
