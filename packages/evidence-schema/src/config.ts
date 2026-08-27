import Type, { type Static } from 'typebox';

import {
  Draft202012,
  NonEmptyString,
  SensitiveStringMap,
  StringOrSecretReference,
} from './common.ts';

const Target = Type.Object(
  {
    url: StringOrSecretReference,
    headers: Type.Optional(SensitiveStringMap),
  },
  { additionalProperties: false },
);

const ScenarioSelection = Type.Object(
  {
    include: Type.Array(NonEmptyString, { minItems: 1, uniqueItems: true }),
    exclude: Type.Optional(Type.Array(NonEmptyString, { uniqueItems: true })),
  },
  { additionalProperties: false },
);

const NetworkPolicy = Type.Object(
  {
    default: Type.Literal('deny'),
    allowHosts: Type.Array(NonEmptyString, { uniqueItems: true }),
  },
  {
    additionalProperties: false,
    description: 'Outbound network policy. Version 1 always fails closed by default.',
  },
);

const RedactionPolicy = Type.Object(
  {
    headers: Type.Array(NonEmptyString, { uniqueItems: true }),
    jsonPaths: Type.Array(NonEmptyString, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

const Timeouts = Type.Object(
  {
    connectMs: Type.Integer({ minimum: 1 }),
    requestMs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const ComparisonPolicy = Type.Object(
  {
    ignoredJsonPaths: Type.Array(NonEmptyString, { uniqueItems: true }),
    maxLatencyRegressionPercent: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ConfigSchemaV1 = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    project: Type.Object(
      {
        name: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    targets: Type.Object(
      {
        baseline: Target,
        candidate: Target,
      },
      { additionalProperties: false },
    ),
    scenarios: ScenarioSelection,
    network: NetworkPolicy,
    redaction: RedactionPolicy,
    timeouts: Timeouts,
    comparison: ComparisonPolicy,
  },
  {
    $schema: Draft202012,
    $id: 'urn:runtime-evidence:schema:config:v1',
    title: 'Runtime Evidence configuration, version 1',
    description: 'Configuration for one deterministic baseline-to-candidate verification run.',
    additionalProperties: false,
  },
);

export type ConfigV1 = Static<typeof ConfigSchemaV1>;
