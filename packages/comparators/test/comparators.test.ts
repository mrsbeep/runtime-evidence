import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareHttpObservations,
  ComparisonConfigurationError,
  MissingComparisonValue,
  type ComparisonDifference,
  type ComparisonPolicy,
} from '@runtime-evidence/comparators';
import type {
  HttpObservation,
  HttpResponseBody,
  HttpTargetName,
} from '@runtime-evidence/replay-http';

import { combineComparatorResults } from '../src/compare.ts';

interface ObservationOptions {
  readonly body?: HttpResponseBody;
  readonly headers?: Readonly<Record<string, readonly string[]>>;
  readonly latencyMs?: number;
  readonly statusCode?: number;
}

const defaultPolicy: ComparisonPolicy = {
  ignoredJsonPaths: [],
  maxLatencyRegressionPercent: 20,
  normalizedJsonPaths: [],
};

function textBody(content: string): HttpResponseBody {
  return { byteLength: Buffer.byteLength(content), content, encoding: 'utf8' };
}

function observation(name: HttpTargetName, options: ObservationOptions = {}): HttpObservation {
  return {
    latencyMs: options.latencyMs ?? 100,
    request: { method: 'GET', path: '/resource' },
    response: {
      body: options.body ?? textBody('{"ok":true}'),
      headers: options.headers ?? { 'content-type': ['application/json'] },
      statusCode: options.statusCode ?? 200,
    },
    target: { name, url: `http://127.0.0.1:${name === 'baseline' ? 4100 : 4200}` },
  };
}

function compare(
  baseline: ObservationOptions,
  candidate: ObservationOptions,
  policy: ComparisonPolicy = defaultPolicy,
) {
  return compareHttpObservations(
    {
      baseline: observation('baseline', baseline),
      candidate: observation('candidate', candidate),
    },
    policy,
  );
}

test('object key order does not create a structural JSON difference', () => {
  const result = compare(
    { body: textBody('{"alpha":1,"nested":{"left":true,"right":false}}') },
    { body: textBody('{"nested":{"right":false,"left":true},"alpha":1}') },
  );

  assert.equal(result.status, 'pass');
  assert.deepEqual(result.differences, []);
});

test('reports nested, missing, type, and array-order changes in stable path order', () => {
  const result = compare(
    {
      body: textBody(
        JSON.stringify({ list: [1, 2], removed: 'yes', user: { age: 7, meta: { ok: true } } }),
      ),
    },
    {
      body: textBody(JSON.stringify({ added: 'yes', list: [2, 1], user: { age: '7', meta: {} } })),
    },
  );

  assert.equal(result.status, 'fail');
  assert.deepEqual(
    result.differences.map(({ path }) => path),
    [
      '/response/body/added',
      '/response/body/list/0',
      '/response/body/list/1',
      '/response/body/removed',
      '/response/body/user/age',
      '/response/body/user/meta/ok',
    ],
  );
  assert.deepEqual(result.differences[0]?.baseline, MissingComparisonValue);
  assert.equal(result.differences[0]?.candidate, 'yes');
  assert.equal(result.differences[4]?.baseline, 7);
  assert.equal(result.differences[4]?.candidate, '7');
  assert.ok(result.differences.every(({ comparator }) => comparator === 'json.structure'));
});

test('ignore removes a subtree while normalization preserves presence checks', () => {
  const policy: ComparisonPolicy = {
    ignoredJsonPaths: ['$.metadata.requestId'],
    normalizedJsonPaths: ['$.metadata.generatedAt'],
    maxLatencyRegressionPercent: 20,
  };
  const ignoredAndNormalized = compare(
    {
      body: textBody(
        JSON.stringify({ metadata: { generatedAt: 'old', requestId: 'baseline-only' }, value: 1 }),
      ),
    },
    { body: textBody(JSON.stringify({ metadata: { generatedAt: 'new' }, value: 1 })) },
    policy,
  );
  const normalizedButMissing = compare(
    { body: textBody(JSON.stringify({ metadata: { generatedAt: 'present' } })) },
    { body: textBody(JSON.stringify({ metadata: {} })) },
    policy,
  );

  assert.equal(ignoredAndNormalized.status, 'pass');
  assert.deepEqual(ignoredAndNormalized.differences, []);
  assert.equal(normalizedButMissing.status, 'fail');
  assert.equal(normalizedButMissing.differences[0]?.path, '/response/body/metadata/generatedAt');
  assert.deepEqual(normalizedButMissing.differences[0]?.candidate, MissingComparisonValue);
});

test('invalid declared JSON is explicit and never silently compared as structured data', () => {
  const result = compare({ body: textBody('{"valid":true}') }, { body: textBody('{invalid') });

  assert.equal(result.status, 'fail');
  assert.equal(result.differences[0]?.comparator, 'json.validity');
  assert.deepEqual(result.differences[0]?.baseline, { valid: true });
  assert.deepEqual(result.differences[0]?.candidate, { valid: false });
  assert.equal(result.differences[1]?.comparator, 'body.exact');
});

test('status, selected headers, and non-JSON bodies report both values', () => {
  const result = compare(
    {
      body: textBody('baseline'),
      headers: { 'content-type': ['text/plain'], 'x-mode': ['old'] },
      statusCode: 200,
    },
    {
      body: textBody('candidate'),
      headers: {
        'content-type': ['text/plain'],
        'x-added': ['yes'],
        'x-mode': ['new'],
      },
      statusCode: 503,
    },
  );

  assert.equal(result.status, 'fail');
  assert.deepEqual(
    result.differences.map(({ comparator, path }) => [comparator, path]),
    [
      ['status', '/response/statusCode'],
      ['header', '/response/headers/x-added'],
      ['header', '/response/headers/x-mode'],
      ['body.exact', '/response/body'],
    ],
  );
  assert.ok(
    result.differences.every(
      ({ baseline, candidate, severity }) =>
        baseline !== undefined && candidate !== undefined && severity === 'error',
    ),
  );
});

test('exact body comparison operates on bytes rather than storage encoding', () => {
  const result = compare(
    {
      body: textBody('same bytes'),
      headers: { 'content-type': ['application/octet-stream'] },
    },
    {
      body: {
        byteLength: 10,
        content: Buffer.from('same bytes').toString('base64'),
        encoding: 'base64',
      },
      headers: { 'content-type': ['application/octet-stream'] },
    },
  );

  assert.equal(result.status, 'pass');
});

test('relative and absolute latency boundaries are inclusive', () => {
  const policy: ComparisonPolicy = {
    ignoredJsonPaths: [],
    maxLatencyRegressionMs: 20,
    maxLatencyRegressionPercent: 20,
  };

  assert.equal(compare({ latencyMs: 100 }, { latencyMs: 120 }, policy).status, 'pass');
  const exceeded = compare({ latencyMs: 100 }, { latencyMs: 120.001 }, policy);
  assert.equal(exceeded.status, 'fail');
  assert.deepEqual(
    exceeded.differences.map(({ comparator }) => comparator),
    ['latency.relative', 'latency.absolute'],
  );
  assert.equal(compare({ latencyMs: 100 }, { latencyMs: 80 }, policy).status, 'pass');
});

test('invalid and conflicting JSON rules fail with stable configuration diagnostics', () => {
  assert.throws(
    () => compare({}, {}, { ...defaultPolicy, ignoredJsonPaths: ['$..unsupported'] }),
    (error: unknown) => {
      assert.ok(error instanceof ComparisonConfigurationError);
      assert.equal(error.code, 'COMPARE_JSON_PATH_INVALID');
      assert.equal(error.path, '/ignoredJsonPaths/0');
      return true;
    },
  );
  assert.throws(
    () =>
      compare(
        {},
        {},
        {
          ...defaultPolicy,
          ignoredJsonPaths: ['$.volatile'],
          normalizedJsonPaths: ['$.volatile.generatedAt'],
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ComparisonConfigurationError);
      assert.equal(error.code, 'COMPARE_JSON_PATH_CONFLICT');
      assert.equal(error.path, '/normalizedJsonPaths/0');
      return true;
    },
  );
});

test('identical inputs and policy produce byte-for-byte identical decisions', () => {
  const baseline = {
    body: textBody(JSON.stringify({ nested: { b: 2, a: 1 }, value: 'old' })),
    latencyMs: 10,
  };
  const candidate = {
    body: textBody(JSON.stringify({ value: 'new', nested: { a: 1, b: 3 } })),
    latencyMs: 15,
  };

  const first = compare(baseline, candidate);
  const second = compare(baseline, candidate);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('a lower-severity comparator cannot downgrade another comparator failure', () => {
  const error: ComparisonDifference = {
    baseline: 200,
    candidate: 500,
    comparator: 'status',
    message: 'Status failed.',
    path: '/response/statusCode',
    severity: 'error',
  };
  const info: ComparisonDifference = {
    baseline: 10,
    candidate: 9,
    comparator: 'latency.relative',
    message: 'Candidate was faster.',
    path: '/latencyMs',
    severity: 'info',
  };

  const result = combineComparatorResults([{ differences: [error] }, { differences: [info] }]);

  assert.equal(result.status, 'fail');
  assert.deepEqual(result.differences, [error, info]);
});
