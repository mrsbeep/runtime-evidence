import Type, { type Static } from 'typebox';

import {
  Draft202012,
  NonEmptyString,
  SensitiveStringMap,
  Sha256Digest,
  StringMap,
} from './common.ts';

const Provenance = Type.Object(
  {
    source: Type.Enum(['hand-authored', 'har', 'openapi', 'local-capture', 'test-adapter']),
    reference: Type.Optional(NonEmptyString),
    sha256: Type.Optional(Sha256Digest),
    redaction: Type.Optional(
      Type.Object(
        {
          applied: Type.Literal(true),
          rules: Type.Array(NonEmptyString, { uniqueItems: true }),
          valuesRemoved: Type.Integer({ minimum: 0 }),
        },
        {
          additionalProperties: false,
          description: 'Sanitization applied before a captured scenario reached persistence.',
        },
      ),
    ),
  },
  { additionalProperties: false },
);

const Safety = Type.Object(
  {
    classification: Type.Enum(['safe', 'mocked', 'read-only', 'state-changing']),
    rationale: NonEmptyString,
  },
  { additionalProperties: false },
);

const Request = Type.Object(
  {
    method: Type.Enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: Type.String({ pattern: '^/' }),
    headers: Type.Optional(SensitiveStringMap),
    query: Type.Optional(StringMap),
    body: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

const Hook = Type.Object(
  {
    command: NonEmptyString,
    args: Type.Array(Type.String()),
    env: Type.Optional(SensitiveStringMap),
    timeoutMs: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const ScenarioSchemaV1 = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]*$' }),
    name: NonEmptyString,
    description: Type.Optional(NonEmptyString),
    tags: Type.Optional(Type.Array(NonEmptyString, { uniqueItems: true })),
    provenance: Provenance,
    safety: Safety,
    request: Request,
    setup: Type.Optional(Type.Array(Hook)),
    cleanup: Type.Optional(Type.Array(Hook)),
  },
  {
    $schema: Draft202012,
    $id: 'urn:runtime-evidence:schema:scenario:v1',
    title: 'Runtime Evidence scenario, version 1',
    description: 'A replayable request scenario with explicit origin and safety classification.',
    additionalProperties: false,
  },
);

export type ScenarioV1 = Static<typeof ScenarioSchemaV1>;
