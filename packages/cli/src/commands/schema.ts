import {
  ConfigSchemaV1,
  EvidenceSchemaV1,
  ScenarioSchemaV1,
} from '@runtime-evidence/evidence-schema';

import { stringOption } from '../options.ts';
import type { CliCommandHandler } from '../types.ts';

const schemas = {
  config: ConfigSchemaV1,
  evidence: EvidenceSchemaV1,
  scenario: ScenarioSchemaV1,
} as const;

export const schemaCommand: CliCommandHandler = (context) => {
  const kind = stringOption(context.options, 'kind') as keyof typeof schemas;
  const schema = schemas[kind];
  return {
    code: 'CLI_SCHEMA_EMITTED',
    data: { kind, schema },
    humanOutput: `${JSON.stringify(schema, null, 2)}\n`,
    message: `Schema ${kind} version 1 emitted.`,
    status: 'success',
  };
};
