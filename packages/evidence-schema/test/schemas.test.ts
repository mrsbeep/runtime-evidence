import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type { TSchema } from 'typebox';
import Compile from 'typebox/compile';

import { ConfigSchemaV1 } from '../src/config.ts';
import { EvidenceSchemaV1 } from '../src/evidence.ts';
import { ScenarioSchemaV1 } from '../src/scenario.ts';

type FixtureSet = {
  readonly name: string;
  readonly schema: object;
  readonly schemaFile: string;
  readonly validFixtures: readonly string[];
  readonly invalidFixtures: readonly string[];
};

const schemaDirectory = resolve(import.meta.dirname, '../../../schemas');
const fixtureSets: readonly FixtureSet[] = [
  {
    name: 'config-v1',
    schema: ConfigSchemaV1,
    schemaFile: 'config-v1.json',
    validFixtures: [
      'fixtures/config/valid/minimal.json',
      'fixtures/config/valid/pre-policy-v1.json',
    ],
    invalidFixtures: [
      'fixtures/config/invalid/unknown-network-field.json',
      'fixtures/config/invalid/wrong-version.json',
    ],
  },
  {
    name: 'scenario-v1',
    schema: ScenarioSchemaV1,
    schemaFile: 'scenario-v1.json',
    validFixtures: [
      'fixtures/scenario/valid/health-check.json',
      'fixtures/scenario/valid/sanitized-capture.json',
    ],
    invalidFixtures: ['fixtures/scenario/invalid/missing-safety.json'],
  },
  {
    name: 'evidence-v1',
    schema: EvidenceSchemaV1,
    schemaFile: 'evidence-v1.json',
    validFixtures: ['fixtures/evidence/valid/passing-run.json'],
    invalidFixtures: [
      'fixtures/evidence/invalid/missing-integrity.json',
      'fixtures/evidence/invalid/unsupported-state.json',
    ],
  },
];

async function readJson<T = unknown>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(resolve(schemaDirectory, relativePath), 'utf8')) as T;
}

for (const fixtureSet of fixtureSets) {
  test(`${fixtureSet.name} is committed without generated drift`, async () => {
    const committedSchema = await readJson(fixtureSet.schemaFile);
    assert.deepEqual(committedSchema, fixtureSet.schema);
    assert.equal(
      Reflect.get(committedSchema as object, '$schema'),
      'https://json-schema.org/draft/2020-12/schema',
    );
    assert.equal(typeof Reflect.get(committedSchema as object, '$id'), 'string');
  });

  test(`${fixtureSet.name} accepts its valid fixtures`, async () => {
    const validator = Compile(await readJson<TSchema>(fixtureSet.schemaFile));

    for (const fixture of fixtureSet.validFixtures) {
      assert.equal(validator.Check(await readJson(fixture)), true, `${fixture} should be valid`);
    }
  });

  test(`${fixtureSet.name} rejects its invalid fixtures`, async () => {
    const validator = Compile(await readJson<TSchema>(fixtureSet.schemaFile));

    for (const fixture of fixtureSet.invalidFixtures) {
      assert.equal(validator.Check(await readJson(fixture)), false, `${fixture} should be invalid`);
    }
  });
}
