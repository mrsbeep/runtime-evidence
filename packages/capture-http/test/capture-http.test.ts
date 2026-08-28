import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CaptureError,
  type CapturedHttpScenarioInput,
  persistSanitizedCapture,
  prepareSanitizedCapture,
  REDACTED_CAPTURE_VALUE,
  type SanitizedCaptureDraft,
} from '../src/index.ts';

const secrets = {
  aws: 'AKIAABCDEFGHIJKLMNOP',
  authorization: 'Bearer capture-authorization-value',
  basic: 'Basic QWxhZGRpbjpPcGVuU2VzYW1l',
  cookie: 'session=capture-cookie-value',
  github: 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
  jwt: 'eyJheader.eyJpayload.signature123',
  password: 'capture-password-value',
  privateKey: '-----BEGIN PRIVATE KEY-----\nexample-private-material\n-----END PRIVATE KEY-----',
  ssn: '000-11-2222',
  query: 'capture-query-value',
} as const;

const captureInput: CapturedHttpScenarioInput = {
  id: 'create-order',
  name: 'Create an order',
  description: `access_token=${secrets.password}`,
  tags: ['orders', 'local'],
  safety: {
    classification: 'mocked',
    rationale: 'Runs only against a disposable local target.',
  },
  request: {
    method: 'POST',
    path: '/orders',
    headers: {
      Authorization: secrets.authorization,
      Cookie: secrets.cookie,
      'Content-Type': 'application/json',
      'X-Basic': secrets.basic,
      'X-Trace': `Bearer ${secrets.github}`,
    },
    query: { api_token: secrets.query, locale: 'en-US' },
    body: {
      customer: { password: secrets.password, ssn: secrets.ssn },
      note: `temporary credential ${secrets.github}`,
      recognizedFormats: [secrets.aws, secrets.jwt, secrets.privateKey],
      sku: 'example-item',
    },
  },
};

const policy = {
  headers: ['authorization', 'cookie'],
  jsonPaths: ['$.customer.ssn'],
} as const;

async function temporaryDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-capture-'));
  context.after(async () => rm(directory, { force: true, recursive: true }));
  return directory;
}

function assertNoSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(secrets)) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}

function expectCaptureError(action: () => unknown, code: string): CaptureError {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof CaptureError);
    assert.equal(error.code, code);
    assertNoSecrets(error.toJSON());
    return error;
  }
  assert.fail('Expected capture operation to fail.');
}

test('sanitizes sensitive headers, query values, JSON paths, fields, and known formats', () => {
  const first = prepareSanitizedCapture(captureInput, policy);
  const second = prepareSanitizedCapture(captureInput, policy);
  const body = first.scenario.request.body as {
    customer: { password: string; ssn: string };
    note: string;
  };

  assert.equal(first.preview, second.preview);
  assert.equal(first.scenario.provenance.sha256, second.scenario.provenance.sha256);
  assert.equal(first.scenario.provenance.source, 'local-capture');
  assert.equal(typeof first.scenario.request.headers?.authorization, 'object');
  assert.equal(typeof first.scenario.request.headers?.cookie, 'object');
  assert.equal(typeof first.scenario.request.headers?.['x-trace'], 'object');
  assert.equal(first.scenario.request.query?.api_token, REDACTED_CAPTURE_VALUE);
  assert.equal(body.customer.password, REDACTED_CAPTURE_VALUE);
  assert.equal(body.customer.ssn, REDACTED_CAPTURE_VALUE);
  assert.match(body.note, /\[REDACTED\]/);
  assert.ok(first.redaction.rules.includes('header:authorization'));
  assert.ok(first.redaction.rules.includes('jsonpath:$.customer.ssn'));
  assert.ok(first.redaction.rules.includes('json-key:password'));
  assert.ok(first.redaction.valuesRemoved >= 6);
  assertNoSecrets(first);
});

test('persists only prepared sanitized drafts and never replaces an existing scenario', async (context) => {
  const outputDirectory = await temporaryDirectory(context);
  const draft = prepareSanitizedCapture(captureInput, policy);
  const written = await persistSanitizedCapture(draft, { outputDirectory });

  assert.equal(await readFile(written.path, 'utf8'), draft.preview);
  assertNoSecrets(await readFile(written.path, 'utf8'));
  await assert.rejects(
    persistSanitizedCapture(draft, { outputDirectory }),
    (error: unknown) =>
      error instanceof CaptureError && error.code === 'CAPTURE_DESTINATION_EXISTS',
  );
  assert.equal(await readFile(written.path, 'utf8'), draft.preview);

  const forged = {
    preview: JSON.stringify(captureInput),
    redaction: { applied: true, rules: [], valuesRemoved: 0 },
    scenario: captureInput,
  } as unknown as SanitizedCaptureDraft;
  await assert.rejects(
    persistSanitizedCapture(forged, { outputDirectory: join(outputDirectory, 'forged') }),
    (error: unknown) => error instanceof CaptureError && error.code === 'CAPTURE_DRAFT_INVALID',
  );
});

test('supports deterministic quoted properties and array indexes', () => {
  const draft = prepareSanitizedCapture(
    {
      ...captureInput,
      request: {
        ...captureInput.request,
        body: { 'account.id': 'example-account', items: [{ value: 'example-value' }] },
      },
    },
    { headers: [], jsonPaths: ['$["account.id"]', '$.items[0].value'] },
  );
  const body = draft.scenario.request.body as {
    'account.id': string;
    items: readonly [{ value: string }];
  };
  assert.equal(body['account.id'], REDACTED_CAPTURE_VALUE);
  assert.equal(body.items[0].value, REDACTED_CAPTURE_VALUE);
});

test('invalid or unsupported redaction paths fail before a draft can be persisted', () => {
  const error = expectCaptureError(
    () =>
      prepareSanitizedCapture(captureInput, {
        headers: [],
        jsonPaths: ['$.customer.ssn', '$..password'],
      }),
    'CAPTURE_JSON_PATH_INVALID',
  );
  assert.equal(error.path, '/redaction/jsonPaths/1');
});

test('unsafe runtime input fails with stable diagnostics that never read or echo values', () => {
  let getterRead = false;
  const unsafe = {
    ...captureInput,
    request: {
      ...captureInput.request,
      get body(): unknown {
        getterRead = true;
        return secrets.password;
      },
    },
  };
  expectCaptureError(
    () => prepareSanitizedCapture(unsafe, { headers: [], jsonPaths: [] }),
    'CAPTURE_INPUT_INVALID',
  );
  assert.equal(getterRead, false);

  const secretKeyError = expectCaptureError(
    () =>
      prepareSanitizedCapture(
        { ...captureInput, [secrets.github]: 'unexpected field' },
        { headers: [], jsonPaths: [] },
      ),
    'CAPTURE_INPUT_INVALID',
  );
  assert.equal(secretKeyError.path, '/');

  expectCaptureError(
    () =>
      prepareSanitizedCapture(
        { ...captureInput, request: { ...captureInput.request, path: '/orders?token=value' } },
        policy,
      ),
    'CAPTURE_INPUT_INVALID',
  );
});

test('fails closed when header names or request paths contain known secret formats', () => {
  const headerError = expectCaptureError(
    () =>
      prepareSanitizedCapture(
        {
          ...captureInput,
          request: {
            ...captureInput.request,
            headers: { [secrets.aws]: 'example-value' },
          },
        },
        policy,
      ),
    'CAPTURE_REDACTION_FAILED',
  );
  assert.equal(headerError.path, '/request/headers');

  const pathError = expectCaptureError(
    () =>
      prepareSanitizedCapture(
        {
          ...captureInput,
          request: { ...captureInput.request, path: `/orders/${secrets.github}` },
        },
        policy,
      ),
    'CAPTURE_REDACTION_FAILED',
  );
  assert.equal(pathError.path, '/request/path');
});

test('interruption prevents a sanitized scenario from reaching persistence', async (context) => {
  const outputDirectory = await temporaryDirectory(context);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    persistSanitizedCapture(prepareSanitizedCapture(captureInput, policy), {
      outputDirectory,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof CaptureError && error.code === 'CAPTURE_ABORTED',
  );
});
