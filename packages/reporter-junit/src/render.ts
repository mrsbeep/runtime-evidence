import {
  type EvidenceV1,
  formatEvidenceValue,
  readEvidenceArtifact,
  validateEvidenceArtifact,
} from '@runtime-evidence/evidence-schema';

export const JUNIT_REPORT_FILE_NAME = 'evidence.junit.xml' as const;

type EvidenceDifference = EvidenceV1['results'][number]['differences'][number];
type ScenarioResult = EvidenceV1['results'][number];

interface RenderedTestCase {
  readonly error: boolean;
  readonly failure: boolean;
  readonly lines: readonly string[];
}

function normalizeXmlText(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const allowed =
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x1_0000 && codePoint <= 0x10_ffff);
      return allowed ? character : '\uFFFD';
    })
    .join('');
}

function escapeXml(value: string): string {
  return normalizeXmlText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function seconds(milliseconds: number): string {
  return String(milliseconds / 1_000);
}

function displayDifferenceValue(
  difference: EvidenceDifference,
  side: 'baseline' | 'candidate',
): string {
  return Object.hasOwn(difference, side) ? formatEvidenceValue(difference[side]) : '(not recorded)';
}

function describeDifference(difference: EvidenceDifference): string {
  return [
    `${difference.comparator} at ${difference.path}: ${difference.message}`,
    `Baseline: ${displayDifferenceValue(difference, 'baseline')}`,
    `Candidate: ${displayDifferenceValue(difference, 'candidate')}`,
  ].join('\n');
}

function describeDifferences(title: string, differences: readonly EvidenceDifference[]): string {
  return [title, ...differences.map(describeDifference)].join('\n');
}

function renderScenarioTestCase(project: string, result: ScenarioResult): RenderedTestCase {
  const errors = result.differences.filter((difference) => difference.severity === 'error');
  const warnings = result.differences.filter((difference) => difference.severity === 'warning');
  const expected = result.differences.filter((difference) => difference.severity === 'info');
  const failure = result.state === 'fail' || errors.length > 0;
  const incomplete = result.state === 'incomplete';
  const lines = [
    `    <testcase classname="${escapeXml(project)}" name="${escapeXml(result.scenarioId)}" time="${seconds(result.durationMs)}">`,
  ];

  if (incomplete) {
    lines.push(
      '      <error type="runtime-evidence.incomplete" message="Scenario evidence is incomplete.">No complete comparison result was available.</error>',
    );
  } else if (failure) {
    const details =
      errors.length > 0
        ? describeDifferences('Behavioral failures:', errors)
        : 'Scenario reported failure without an error-severity difference.';
    lines.push(
      `      <failure type="runtime-evidence.behavioral-difference" message="Behavioral verification failed.">${escapeXml(details)}</failure>`,
    );
  }

  const notices = [
    ...(warnings.length > 0 ? [describeDifferences('Warnings:', warnings)] : []),
    ...(expected.length > 0 ? [describeDifferences('Expected differences:', expected)] : []),
  ];
  if (notices.length > 0) {
    lines.push(`      <system-out>${escapeXml(notices.join('\n'))}</system-out>`);
  }
  lines.push('    </testcase>');
  return { error: incomplete, failure: !incomplete && failure, lines };
}

function renderRunTestCase(evidence: EvidenceV1): RenderedTestCase | undefined {
  const hasScenarioError = evidence.results.some((result) => result.state === 'incomplete');
  const hasScenarioFailure = evidence.results.some(
    (result) =>
      result.state === 'fail' ||
      result.differences.some((difference) => difference.severity === 'error'),
  );
  const missingEvidence =
    evidence.state === 'incomplete' ||
    evidence.infrastructureErrors.length > 0 ||
    evidence.skippedChecks.length > 0 ||
    evidence.coverage.scenariosCompleted < evidence.coverage.scenariosSelected;
  const unrepresentedError = missingEvidence && !hasScenarioError;
  const unrepresentedFailure = evidence.state === 'fail' && !hasScenarioFailure;
  if (!unrepresentedError && !unrepresentedFailure) {
    return undefined;
  }

  const details = [
    `Policy decision: ${evidence.state}`,
    ...evidence.infrastructureErrors.map((error) => `Infrastructure error: ${error}`),
    ...evidence.skippedChecks.map((skipped) => `Skipped ${skipped.check}: ${skipped.reason}`),
  ].join('\n');
  const element = unrepresentedError ? 'error' : 'failure';
  const type = unrepresentedError
    ? 'runtime-evidence.incomplete'
    : 'runtime-evidence.behavioral-difference';
  const message = unrepresentedError
    ? 'Run evidence is incomplete.'
    : 'Run policy decision is failure.';
  return {
    error: unrepresentedError,
    failure: !unrepresentedError,
    lines: [
      `    <testcase classname="${escapeXml(evidence.project)}" name="[run policy]" time="0">`,
      `      <${element} type="${type}" message="${message}">${escapeXml(details)}</${element}>`,
      '    </testcase>',
    ],
  };
}

function suiteOutput(evidence: EvidenceV1): string {
  return [
    `Policy decision: ${evidence.state}`,
    ...(evidence.policy === undefined
      ? []
      : [
          `Network policy: default=${evidence.policy.network.default}; applicationRequests=${evidence.policy.network.applicationRequests}; hookProcesses=${evidence.policy.network.hookProcesses}; platform=${evidence.policy.network.platform}.`,
          `State-changing scenarios allowed: ${evidence.policy.sideEffects.allowStateChanging ? 'yes' : 'no'}.`,
        ]),
    `Coverage: ${evidence.coverage.scenariosCompleted}/${evidence.coverage.scenariosSelected} scenarios completed; ${evidence.coverage.assertionsEvaluated} assertions evaluated.`,
    ...evidence.limitations.map((limitation) => `Limitation: ${limitation}`),
    ...evidence.skippedChecks.map((skipped) => `Skipped ${skipped.check}: ${skipped.reason}`),
    `Redaction: ${evidence.redaction.applied ? 'applied' : 'not applied'}; ${evidence.redaction.valuesRemoved} values removed.`,
    ...evidence.redaction.rules.map((rule) => `Redaction rule: ${rule}`),
  ].join('\n');
}

/** Renders JUnit XML after validating schema and integrity. Incomplete evidence is always an error. */
export function renderJUnitEvidence(value: unknown): string {
  const evidence = validateEvidenceArtifact(value);
  const cases = evidence.results.map((result) => renderScenarioTestCase(evidence.project, result));
  const runCase = renderRunTestCase(evidence);
  if (runCase !== undefined) {
    cases.push(runCase);
  }
  const failures = cases.filter((testCase) => testCase.failure).length;
  const errors = cases.filter((testCase) => testCase.error).length;
  const durationMs = evidence.results.reduce((total, result) => total + result.durationMs, 0);
  const tests = cases.length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${tests}" failures="${failures}" errors="${errors}" time="${seconds(durationMs)}">`,
    `  <testsuite name="runtime-evidence" tests="${tests}" failures="${failures}" errors="${errors}" skipped="0" time="${seconds(durationMs)}" timestamp="${escapeXml(evidence.createdAt)}">`,
    '    <properties>',
    `      <property name="schemaVersion" value="${evidence.schemaVersion}"/>`,
    `      <property name="runId" value="${escapeXml(evidence.runId)}"/>`,
    `      <property name="policyDecision" value="${evidence.state}"/>`,
    `      <property name="configSha256" value="${evidence.config.sha256}"/>`,
    `      <property name="evidenceSha256" value="${evidence.integrity.digest}"/>`,
    `      <property name="baseline" value="${escapeXml(evidence.targets.baseline.url)}"/>`,
    `      <property name="candidate" value="${escapeXml(evidence.targets.candidate.url)}"/>`,
    ...(evidence.policy === undefined
      ? []
      : [
          `      <property name="networkDefault" value="${evidence.policy.network.default}"/>`,
          `      <property name="applicationRequestEnforcement" value="${evidence.policy.network.applicationRequests}"/>`,
          `      <property name="hookProcessEnforcement" value="${evidence.policy.network.hookProcesses}"/>`,
        ]),
    '    </properties>',
    ...cases.flatMap((testCase) => testCase.lines),
    `    <system-out>${escapeXml(suiteOutput(evidence))}</system-out>`,
    ...(evidence.infrastructureErrors.length > 0
      ? [`    <system-err>${escapeXml(evidence.infrastructureErrors.join('\n'))}</system-err>`]
      : []),
    '  </testsuite>',
    '</testsuites>',
    '',
  ];
  return lines.join('\n');
}

/** Reads an existing canonical artifact; this function has no verification dependency. */
export async function renderJUnitEvidenceFile(filePath: string): Promise<string> {
  return renderJUnitEvidence(await readEvidenceArtifact(filePath));
}
