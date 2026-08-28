import {
  type EvidenceV1,
  formatEvidenceValue,
  readEvidenceArtifact,
  validateEvidenceArtifact,
} from '@runtime-evidence/evidence-schema';

export const MARKDOWN_REPORT_FILE_NAME = 'evidence.md' as const;

type EvidenceDifference = EvidenceV1['results'][number]['differences'][number];
type EvidenceSeverity = EvidenceDifference['severity'];

interface LocatedDifference {
  readonly difference: EvidenceDifference;
  readonly scenarioId: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('|', '&#124;');
}

function normalizeText(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const disallowed =
        codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f;
      return disallowed ? '\uFFFD' : character;
    })
    .join('');
}

function code(value: string): string {
  return `<code>${escapeHtml(normalizeText(value))}</code>`;
}

function text(value: string): string {
  return escapeHtml(normalizeText(value)).replace(/\r?\n/g, '<br>');
}

function displayDifferenceValue(
  difference: EvidenceDifference,
  side: 'baseline' | 'candidate',
): string {
  return Object.hasOwn(difference, side)
    ? code(formatEvidenceValue(difference[side]))
    : '_Not recorded._';
}

function locateDifferences(
  evidence: EvidenceV1,
  severity: EvidenceSeverity,
): readonly LocatedDifference[] {
  return evidence.results.flatMap((result) =>
    result.differences
      .filter((difference) => difference.severity === severity)
      .map((difference) => ({ difference, scenarioId: result.scenarioId })),
  );
}

function renderDifference(entry: LocatedDifference): readonly string[] {
  const { difference, scenarioId } = entry;
  return [
    `- ${code(scenarioId)} — ${code(difference.comparator)} at ${code(difference.path)}: ${text(difference.message)}`,
    `  - Baseline: ${displayDifferenceValue(difference, 'baseline')}`,
    `  - Candidate: ${displayDifferenceValue(difference, 'candidate')}`,
  ];
}

function renderDifferenceSection(
  title: string,
  entries: readonly LocatedDifference[],
  unrepresentedScenarios: readonly string[],
): readonly string[] {
  const lines = [`## ${title}`, ''];
  for (const entry of entries) {
    lines.push(...renderDifference(entry));
  }
  for (const scenarioId of unrepresentedScenarios) {
    lines.push(`- ${code(scenarioId)} — no matching-severity difference was recorded.`);
  }
  if (entries.length === 0 && unrepresentedScenarios.length === 0) {
    lines.push('_None._');
  }
  return [...lines, ''];
}

function scenariosWithoutSeverity(
  evidence: EvidenceV1,
  state: EvidenceV1['state'],
  severity: EvidenceSeverity,
): readonly string[] {
  return evidence.results
    .filter(
      (result) =>
        result.state === state &&
        !result.differences.some((difference) => difference.severity === severity),
    )
    .map((result) => result.scenarioId);
}

function renderMissingEvidence(evidence: EvidenceV1): readonly string[] {
  const lines = ['## Missing evidence', ''];
  for (const result of evidence.results.filter((result) => result.state === 'incomplete')) {
    lines.push(`- Incomplete scenario: ${code(result.scenarioId)}`);
  }
  for (const skipped of evidence.skippedChecks) {
    lines.push(`- Skipped ${code(skipped.check)}: ${text(skipped.reason)}`);
  }
  for (const error of evidence.infrastructureErrors) {
    lines.push(`- Infrastructure error: ${text(error)}`);
  }
  if (
    evidence.results.every((result) => result.state !== 'incomplete') &&
    evidence.skippedChecks.length === 0 &&
    evidence.infrastructureErrors.length === 0
  ) {
    lines.push('_None._');
  }
  return [...lines, ''];
}

function renderReplayPolicy(evidence: EvidenceV1): readonly string[] {
  const policy = evidence.policy;
  if (policy === undefined) {
    return [];
  }
  const targetHosts = policy.network.allowHosts.map(code).join(', ') || '_None._';
  const dependencyHosts = policy.network.allowDependencyHosts.map(code).join(', ') || '_None._';
  const isolatedTargets = policy.sideEffects.isolatedTargets.map(code).join(', ') || '_None._';
  return [
    '## Replay policy',
    '',
    `- Network default: ${code(policy.network.default)}`,
    `- Allowed target hosts: ${targetHosts}`,
    `- Allowed dependency hosts: ${dependencyHosts}`,
    `- Application requests: ${code(policy.network.applicationRequests)}`,
    `- Hook processes: ${code(policy.network.hookProcesses)}`,
    `- Platform: ${code(policy.network.platform)}`,
    `- State-changing scenarios allowed: ${policy.sideEffects.allowStateChanging ? 'yes' : 'no'}`,
    `- Isolated targets: ${isolatedTargets}`,
    '',
  ];
}

/** Renders a deterministic review summary after validating schema and integrity. */
export function renderMarkdownEvidence(value: unknown): string {
  const evidence = validateEvidenceArtifact(value);
  const failures = locateDifferences(evidence, 'error');
  const warnings = locateDifferences(evidence, 'warning');
  const expected = locateDifferences(evidence, 'info');
  const lines = [
    '# Runtime Evidence',
    '',
    `- Policy decision: **${evidence.state.toUpperCase()}**`,
    `- Project: ${code(evidence.project)}`,
    `- Run: ${code(evidence.runId)}`,
    `- Created: ${code(evidence.createdAt)}`,
    `- Tool version: ${code(evidence.toolVersion)}`,
    `- Baseline: ${code(evidence.targets.baseline.name)} at ${code(evidence.targets.baseline.url)}`,
    `- Candidate: ${code(evidence.targets.candidate.name)} at ${code(evidence.targets.candidate.url)}`,
    '',
    '## Scenario outcomes',
    '',
    '| Scenario | State | Duration (ms) |',
    '| --- | --- | ---: |',
    ...evidence.results.map(
      (result) =>
        `| ${code(result.scenarioId)} | ${result.state.toUpperCase()} | ${result.durationMs} |`,
    ),
    ...(evidence.results.length === 0 ? ['| _None selected_ | — | 0 |'] : []),
    '',
    ...renderDifferenceSection(
      'Failures',
      failures,
      scenariosWithoutSeverity(evidence, 'fail', 'error'),
    ),
    ...renderDifferenceSection(
      'Warnings',
      warnings,
      scenariosWithoutSeverity(evidence, 'advisory', 'warning'),
    ),
    ...renderDifferenceSection('Expected differences', expected, []),
    ...renderMissingEvidence(evidence),
    ...renderReplayPolicy(evidence),
    '## Coverage and limitations',
    '',
    `- Scenarios selected: ${evidence.coverage.scenariosSelected}`,
    `- Scenarios completed: ${evidence.coverage.scenariosCompleted}`,
    `- Assertions evaluated: ${evidence.coverage.assertionsEvaluated}`,
    ...evidence.limitations.map((limitation) => `- Limitation: ${text(limitation)}`),
    ...(evidence.limitations.length === 0 ? ['- Limitations: none recorded.'] : []),
    '',
    '## Redaction',
    '',
    `- Applied: ${evidence.redaction.applied ? 'yes' : 'no'}`,
    `- Values removed: ${evidence.redaction.valuesRemoved}`,
    ...evidence.redaction.rules.map((rule) => `- Rule: ${code(rule)}`),
    ...(evidence.redaction.rules.length === 0 ? ['- Rules: none recorded.'] : []),
    '',
    '## Integrity',
    '',
    `- Config SHA-256: ${code(evidence.config.sha256)}`,
    `- Evidence SHA-256: ${code(evidence.integrity.digest)}`,
    '',
  ];
  return lines.join('\n');
}

/** Reads an existing canonical artifact; this function has no verification dependency. */
export async function renderMarkdownEvidenceFile(filePath: string): Promise<string> {
  return renderMarkdownEvidence(await readEvidenceArtifact(filePath));
}
