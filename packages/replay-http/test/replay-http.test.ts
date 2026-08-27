import assert from 'node:assert/strict';
import { createServer as createHttpServer, type RequestListener } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';

import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';
import {
  executeHttpRequest,
  HttpRequestPreparationError,
  prepareScenarioRequest,
} from '@runtime-evidence/replay-http';

function scenario(request: ScenarioV1['request']): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: 'replay-test',
    name: 'Replay test',
    provenance: { source: 'test-adapter' },
    safety: { classification: 'read-only', rationale: 'Uses a disposable local server.' },
    request,
  };
}

async function startHttpServer(context: TestContext, listener: RequestListener): Promise<string> {
  const server = createHttpServer(listener);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  context.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

test('prepares one deterministic request and resolves explicit references', () => {
  const prepared = prepareScenarioRequest(
    scenario({
      method: 'POST',
      path: '/items?existing=yes',
      query: { z: 'last', a: 'first' },
      headers: { 'x-token': { env: 'SCENARIO_TOKEN' } },
      body: { item: 'book' },
    }),
    { SCENARIO_TOKEN: 'runtime-only-value' },
  );

  assert.equal(prepared.path, '/items?existing=yes&a=first&z=last');
  assert.equal(prepared.headers['x-token'], 'runtime-only-value');
  assert.equal(prepared.headers['content-type'], 'application/json');
  assert.equal(prepared.body, '{"item":"book"}');
});

test('missing request references fail without exposing another value', () => {
  const presentValue = 'must-not-appear';
  assert.throws(
    () =>
      prepareScenarioRequest(
        scenario({
          method: 'GET',
          path: '/',
          headers: { authorization: { env: 'MISSING_TOKEN' } },
        }),
        { ANOTHER_TOKEN: presentValue },
      ),
    (error: unknown) => {
      assert.ok(error instanceof HttpRequestPreparationError);
      assert.equal(error.code, 'HTTP_REQUEST_ENV_MISSING');
      assert.equal(error.path, '/request/headers/authorization');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(presentValue));
      return true;
    },
  );
});

test('captures a typed local observation and omits sensitive response headers', async (context) => {
  const targetUrl = await startHttpServer(context, (_request, response) => {
    response.writeHead(201, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'session=secret',
      'x-observed': 'yes',
    });
    response.end('{"ok":true}');
  });
  const prepared = prepareScenarioRequest(scenario({ method: 'GET', path: '/health' }));

  const outcome = await executeHttpRequest(
    { name: 'baseline', revision: 'baseline-sha', url: targetUrl },
    prepared,
    {
      connectTimeoutMs: 500,
      requestTimeoutMs: 500,
      selectedResponseHeaders: ['set-cookie', 'x-observed'],
    },
  );

  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail('Expected a successful HTTP observation.');
  }
  assert.equal(outcome.observation.target.revision, 'baseline-sha');
  assert.equal(outcome.observation.response.statusCode, 201);
  assert.deepEqual(outcome.observation.response.headers['content-type'], [
    'application/json; charset=utf-8',
  ]);
  assert.deepEqual(outcome.observation.response.headers['x-observed'], ['yes']);
  assert.equal(outcome.observation.response.headers['set-cookie'], undefined);
  assert.deepEqual(outcome.observation.response.body, {
    byteLength: 11,
    content: '{"ok":true}',
    encoding: 'utf8',
  });
  assert.ok(outcome.observation.latencyMs >= 0);
});

test('distinguishes connection startup timeout using a disposable local socket', async (context) => {
  const sockets = new Set<import('node:net').Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  context.after(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  );
  const address = server.address() as AddressInfo;
  const prepared = prepareScenarioRequest(scenario({ method: 'GET', path: '/' }));

  const outcome = await executeHttpRequest(
    { name: 'candidate', url: `https://127.0.0.1:${address.port}` },
    prepared,
    { connectTimeoutMs: 25, requestTimeoutMs: 500 },
  );

  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail('Expected connection startup to time out.');
  }
  assert.equal(outcome.failure.code, 'HTTP_CONNECT_TIMEOUT');
  assert.equal(outcome.failure.kind, 'timeout');
  assert.equal(outcome.failure.phase, 'startup');
});

test('distinguishes request timeout after connecting to a local server', async (context) => {
  const targetUrl = await startHttpServer(context, (_request, response) => {
    setTimeout(() => response.end('late'), 100).unref();
  });
  const prepared = prepareScenarioRequest(scenario({ method: 'GET', path: '/' }));

  const outcome = await executeHttpRequest({ name: 'candidate', url: targetUrl }, prepared, {
    connectTimeoutMs: 500,
    requestTimeoutMs: 25,
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail('Expected the request to time out.');
  }
  assert.equal(outcome.failure.code, 'HTTP_REQUEST_TIMEOUT');
  assert.equal(outcome.failure.phase, 'request');
});

test('distinguishes a mid-response transport failure', async (context) => {
  const targetUrl = await startHttpServer(context, (_request, response) => {
    response.writeHead(200, { 'content-length': '100', 'content-type': 'text/plain' });
    response.write('partial');
    response.socket?.destroy();
  });
  const prepared = prepareScenarioRequest(scenario({ method: 'GET', path: '/' }));

  const outcome = await executeHttpRequest({ name: 'candidate', url: targetUrl }, prepared, {
    connectTimeoutMs: 500,
    requestTimeoutMs: 500,
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail('Expected the response transport to fail.');
  }
  assert.equal(outcome.failure.code, 'HTTP_TRANSPORT_ERROR');
  assert.equal(outcome.failure.kind, 'transport');
});

test('fails closed when a response exceeds the configured body limit', async (context) => {
  const targetUrl = await startHttpServer(context, (_request, response) => {
    response.end('response-is-too-large');
  });
  const prepared = prepareScenarioRequest(scenario({ method: 'GET', path: '/' }));

  const outcome = await executeHttpRequest({ name: 'candidate', url: targetUrl }, prepared, {
    connectTimeoutMs: 500,
    maxResponseBodyBytes: 4,
    requestTimeoutMs: 500,
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail('Expected the response body limit to fail closed.');
  }
  assert.equal(outcome.failure.code, 'HTTP_RESPONSE_TOO_LARGE');
  assert.doesNotMatch(JSON.stringify(outcome.failure), /response-is-too-large/);
});
