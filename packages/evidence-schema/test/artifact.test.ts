import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import Compile from 'typebox/compile';

import { mixedEvidencePayload } from '../../../tests/fixtures/evidence.ts';
import {
  createEvidenceArtifact,
  EVIDENCE_FILE_NAME,
  EvidenceArtifactError,
  EvidenceSchemaV1,
  formatEvidenceValue,
  readEvidenceArtifact,
  serializeEvidenceArtifact,
  writeEvidenceArtifact,
} from '../src/index.ts';

test('creates schema-valid evidence with reproducible integrity and serialization', () => {
  const first = createEvidenceArtifact(mixedEvidencePayload());
  const second = createEvidenceArtifact(
    JSON.parse(JSON.stringify(mixedEvidencePayload())) as ReturnType<typeof mixedEvidencePayload>,
  );
  const validator = Compile(EvidenceSchemaV1);

  assert.equal(validator.Check(first), true);
  assert.equal(first.integrity.algorithm, 'sha256');
  assert.match(first.integrity.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.integrity.digest, second.integrity.digest);
  assert.equal(serializeEvidenceArtifact(first), serializeEvidenceArtifact(second));
  assert.equal(Object.isFrozen(first), true);
});

test('the committed passing fixture has valid canonical integrity', async () => {
  const fixture = await readEvidenceArtifact(
    resolve(import.meta.dirname, '../../../schemas/fixtures/evidence/valid/passing-run.json'),
  );

  assert.equal(fixture.state, 'pass');
  assert.equal(
    fixture.integrity.digest,
    'b82b12fa04ab4bf3147803b423ba0f5489ef506c989059f1e39dd90bb66abd48',
  );
});

test('writes evidence.json atomically and preserves an existing artifact on validation failure', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-artifact-'));
  context.after(() =>
    import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true })),
  );
  const destination = join(directory, EVIDENCE_FILE_NAME);
  await writeFile(destination, 'existing artifact', 'utf8');

  const written = await writeEvidenceArtifact({
    outputDirectory: directory,
    payload: mixedEvidencePayload(),
  });
  assert.equal(written.path, destination);
  assert.deepEqual(await readEvidenceArtifact(destination), written.evidence);
  const committed = await readFile(destination, 'utf8');

  const invalidPayload = { ...mixedEvidencePayload(), state: 'unknown' } as unknown as ReturnType<
    typeof mixedEvidencePayload
  >;
  await assert.rejects(
    () => writeEvidenceArtifact({ outputDirectory: directory, payload: invalidPayload }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceArtifactError);
      assert.equal(error.code, 'EVIDENCE_SCHEMA_INVALID');
      return true;
    },
  );
  assert.equal(await readFile(destination, 'utf8'), committed);
  assert.deepEqual(await readdir(directory), [EVIDENCE_FILE_NAME]);
});

test('rejects tampering and leaky redaction markers without returning their values', () => {
  const artifact = createEvidenceArtifact(mixedEvidencePayload());
  const tampered = { ...artifact, project: 'tampered' };
  assert.throws(
    () => serializeEvidenceArtifact(tampered),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceArtifactError);
      assert.equal(error.code, 'EVIDENCE_INTEGRITY_MISMATCH');
      return true;
    },
  );

  const secret = 'must-not-appear';
  const payload = mixedEvidencePayload();
  const difference = payload.results[2]?.differences[0];
  assert.ok(difference);
  const unsafePayload = {
    ...payload,
    results: payload.results.map((result, index) =>
      index === 2
        ? {
            ...result,
            differences: [
              {
                ...difference,
                baseline: { state: 'redacted', original: secret },
              },
            ],
          }
        : result,
    ),
  };
  assert.throws(
    () => createEvidenceArtifact(unsafePayload),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceArtifactError);
      assert.equal(error.code, 'EVIDENCE_REDACTION_MARKER_INVALID');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(secret));
      return true;
    },
  );
});

test('presentation replaces redacted subtrees defensively', () => {
  const secret = 'must-not-appear';
  const formatted = formatEvidenceValue({
    public: true,
    token: { state: 'redacted', original: secret },
  });

  assert.equal(formatted, '{"public":true,"token":"[REDACTED]"}');
  assert.doesNotMatch(formatted, new RegExp(secret));
});

test('rejects runtime values that cannot have one canonical JSON representation', () => {
  const payload = mixedEvidencePayload();
  const result = payload.results[0];
  assert.ok(result);
  const difference = result.differences[0];
  assert.ok(difference);
  const sparse: unknown[] = [];
  sparse.length = 1;
  const invalidPayload = {
    ...payload,
    results: [
      {
        ...result,
        differences: [{ ...difference, baseline: sparse }],
      },
    ],
  };

  assert.throws(
    () => createEvidenceArtifact(invalidPayload),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceArtifactError);
      assert.equal(error.code, 'EVIDENCE_JSON_INCOMPATIBLE');
      return true;
    },
  );
});
