import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createEvidenceArtifact,
  EvidenceArtifactError,
  writeEvidenceArtifact,
} from '@runtime-evidence/evidence-schema';
import { renderJUnitEvidence, renderJUnitEvidenceFile } from '@runtime-evidence/reporter-junit';

import { mixedEvidencePayload } from '../../../tests/fixtures/evidence.ts';

test('maps behavioral failure and incomplete evidence to non-passing JUnit cases', () => {
  const artifact = createEvidenceArtifact(mixedEvidencePayload());
  const first = renderJUnitEvidence(artifact);
  const second = renderJUnitEvidence(artifact);

  assert.equal(first, second);
  assert.match(first, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(first, /<testsuites tests="4" failures="1" errors="1" time="0\.02">/);
  assert.match(first, /<failure type="runtime-evidence\.behavioral-difference"/);
  assert.match(first, /<error type="runtime-evidence\.incomplete"/);
  assert.match(first, /skipped="0"/);
  assert.match(first, /Warnings:/);
  assert.match(first, /Expected differences:/);
  assert.match(first, /\[REDACTED\]/);
  assert.doesNotMatch(first, /&quot;state&quot;:&quot;redacted&quot;/);
  assert.match(first, /checkout &amp; &lt;api&gt;/);
  assert.match(first, /Status &lt; changed &amp; requires review/);
  assert.match(first, /Candidate connection was refused/);
  assert.match(first, /Redaction: applied; 2 values removed/);
  assert.match(first, /name="networkDefault" value="deny"/);
  assert.match(first, /hookProcesses=not-used/);
});

test('adds a failing run-policy case when no scenario can represent incomplete evidence', () => {
  const payload = mixedEvidencePayload();
  const artifact = createEvidenceArtifact({
    ...payload,
    results: [],
    coverage: { scenariosSelected: 1, scenariosCompleted: 0, assertionsEvaluated: 0 },
  });
  const report = renderJUnitEvidence(artifact);

  assert.match(report, /<testsuites tests="1" failures="0" errors="1" time="0">/);
  assert.match(report, /name="\[run policy\]"/);
  assert.match(report, /Run evidence is incomplete/);
});

test('renders an existing artifact without invoking verification', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-junit-'));
  context.after(() =>
    import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true })),
  );
  const written = await writeEvidenceArtifact({
    outputDirectory: directory,
    payload: mixedEvidencePayload(),
  });

  assert.equal(await renderJUnitEvidenceFile(written.path), renderJUnitEvidence(written.evidence));
});

test('refuses to render evidence after integrity-changing mutation', () => {
  const artifact = createEvidenceArtifact(mixedEvidencePayload());
  assert.throws(
    () => renderJUnitEvidence({ ...artifact, project: 'changed' }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceArtifactError);
      assert.equal(error.code, 'EVIDENCE_INTEGRITY_MISMATCH');
      return true;
    },
  );
});

test('replaces characters forbidden by XML 1.0', () => {
  const artifact = createEvidenceArtifact({
    ...mixedEvidencePayload(),
    project: 'checkout\u0000api',
  });
  const report = renderJUnitEvidence(artifact);

  assert.equal(report.includes(String.fromCodePoint(0)), false);
  assert.equal(report.includes('checkout\uFFFDapi'), true);
});
