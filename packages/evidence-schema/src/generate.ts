import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigSchemaV1 } from './config.ts';
import { EvidenceSchemaV1 } from './evidence.ts';
import { ScenarioSchemaV1 } from './scenario.ts';

const schemaDirectory = resolve(import.meta.dirname, '../../../schemas');
const schemas = [
  ['config-v1.json', ConfigSchemaV1],
  ['scenario-v1.json', ScenarioSchemaV1],
  ['evidence-v1.json', EvidenceSchemaV1],
] as const;

await mkdir(schemaDirectory, { recursive: true });

for (const [fileName, schema] of schemas) {
  const destination = resolve(schemaDirectory, fileName);
  await writeFile(destination, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`Generated ${destination}`);
}
