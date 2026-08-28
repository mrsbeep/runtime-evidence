import Type, { type Static } from 'typebox';

import { Draft202012, NonEmptyString, Sha256Digest } from './common.ts';

const EvidenceState = Type.Enum(['pass', 'fail', 'incomplete', 'advisory']);

const TargetIdentity = Type.Object(
  {
    name: NonEmptyString,
    url: NonEmptyString,
  },
  { additionalProperties: false },
);

const Difference = Type.Object(
  {
    comparator: NonEmptyString,
    path: NonEmptyString,
    severity: Type.Enum(['info', 'warning', 'error']),
    message: NonEmptyString,
    baseline: Type.Optional(Type.Unknown()),
    candidate: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

const ScenarioResult = Type.Object(
  {
    scenarioId: NonEmptyString,
    state: EvidenceState,
    durationMs: Type.Number({ minimum: 0 }),
    differences: Type.Array(Difference),
  },
  { additionalProperties: false },
);

const SkippedCheck = Type.Object(
  {
    check: NonEmptyString,
    reason: NonEmptyString,
  },
  { additionalProperties: false },
);

const RedactionMetadata = Type.Object(
  {
    applied: Type.Boolean(),
    rules: Type.Array(NonEmptyString, { uniqueItems: true }),
    valuesRemoved: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const Coverage = Type.Object(
  {
    scenariosSelected: Type.Integer({ minimum: 0 }),
    scenariosCompleted: Type.Integer({ minimum: 0 }),
    assertionsEvaluated: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const ReplayPolicy = Type.Object(
  {
    network: Type.Object(
      {
        default: Type.Literal('deny'),
        allowHosts: Type.Array(NonEmptyString, { uniqueItems: true }),
        allowDependencyHosts: Type.Array(NonEmptyString, { uniqueItems: true }),
        applicationRequests: Type.Literal('enforced'),
        hookProcesses: Type.Enum(['not-used', 'externally-isolated', 'unsupported']),
        platform: Type.Enum(['darwin', 'linux', 'win32', 'other']),
      },
      { additionalProperties: false },
    ),
    sideEffects: Type.Object(
      {
        allowStateChanging: Type.Boolean(),
        isolatedTargets: Type.Array(Type.Enum(['baseline', 'candidate']), {
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    description: 'Effective deny-by-default replay policy and enforcement capability.',
  },
);

const Integrity = Type.Object(
  {
    algorithm: Type.Literal('sha256'),
    digest: Sha256Digest,
  },
  {
    additionalProperties: false,
    description: 'Digest of the canonical evidence payload as defined by the evidence writer.',
  },
);

export const EvidenceSchemaV1 = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    toolVersion: NonEmptyString,
    runId: NonEmptyString,
    createdAt: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$',
    }),
    project: NonEmptyString,
    state: EvidenceState,
    config: Type.Object(
      {
        schemaVersion: Type.Literal(1),
        sha256: Sha256Digest,
      },
      { additionalProperties: false },
    ),
    targets: Type.Object(
      {
        baseline: TargetIdentity,
        candidate: TargetIdentity,
      },
      { additionalProperties: false },
    ),
    results: Type.Array(ScenarioResult),
    coverage: Coverage,
    policy: Type.Optional(ReplayPolicy),
    limitations: Type.Array(NonEmptyString),
    skippedChecks: Type.Array(SkippedCheck),
    infrastructureErrors: Type.Array(NonEmptyString),
    redaction: RedactionMetadata,
    integrity: Integrity,
  },
  {
    $schema: Draft202012,
    $id: 'urn:runtime-evidence:schema:evidence:v1',
    title: 'Runtime Evidence artifact, version 1',
    description: 'A reviewable record of a baseline-to-candidate runtime verification run.',
    additionalProperties: false,
  },
);

export type EvidenceV1 = Static<typeof EvidenceSchemaV1>;
