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
import {
  renderMarkdownEvidence,
  renderMarkdownEvidenceFile,
} from '@runtime-evidence/reporter-markdown';

import { mixedEvidencePayload } from '../../../tests/fixtures/evidence.ts';

test('separates outcomes and renders every evidence category deterministically', () => {
  const artifact = createEvidenceArtifact(mixedEvidencePayload());
  const first = renderMarkdownEvidence(artifact);
  const second = renderMarkdownEvidence(artifact);

  assert.equal(first, second);
  assert.match(first, /Policy decision: \*\*INCOMPLETE\*\*/);
  assert.ok(first.indexOf('## Failures') < first.indexOf('## Warnings'));
  assert.ok(first.indexOf('## Warnings') < first.indexOf('## Expected differences'));
  assert.ok(first.indexOf('## Expected differences') < first.indexOf('## Missing evidence'));
  assert.match(first, /status-regression/);
  assert.match(first, /latency-warning/);
  assert.match(first, /candidate-unavailable/);
  assert.match(first, /Candidate connection was refused/);
  assert.match(first, /Database side effects were not evaluated/);
  assert.match(first, /Values removed: 2/);
  assert.match(first, /\[REDACTED\]/);
  assert.doesNotMatch(first, /"state":"redacted"/);
  assert.match(first, /checkout &amp; &lt;api&gt;/);
  assert.match(first, /Status &lt; changed &amp; requires review/);
});

test('renders an existing artifact without invoking verification', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-markdown-'));
  context.after(() =>
    import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true })),
  );
  const written = await writeEvidenceArtifact({
    outputDirectory: directory,
    payload: mixedEvidencePayload(),
  });

  assert.equal(
    await renderMarkdownEvidenceFile(written.path),
    renderMarkdownEvidence(written.evidence),
  );
});

test('refuses to render evidence after integrity-changing mutation', () => {
  const artifact = createEvidenceArtifact(mixedEvidencePayload());
  assert.throws(
    () => renderMarkdownEvidence({ ...artifact, project: 'changed' }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceArtifactError);
      assert.equal(error.code, 'EVIDENCE_INTEGRITY_MISMATCH');
      return true;
    },
  );
});

test('replaces control characters that could corrupt Markdown presentation', () => {
  const artifact = createEvidenceArtifact({
    ...mixedEvidencePayload(),
    project: 'checkout\u0000api',
  });
  const report = renderMarkdownEvidence(artifact);

  assert.equal(report.includes(String.fromCodePoint(0)), false);
  assert.equal(report.includes('checkout\uFFFDapi'), true);
});
