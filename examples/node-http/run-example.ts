import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCli } from '@runtime-evidence/cli';
import {
  EVIDENCE_FILE_NAME,
  type EvidenceV1,
  readEvidenceArtifact,
} from '@runtime-evidence/evidence-schema';

import { type ExampleService, startExampleService } from './service.ts';

type ExampleCase = 'fail' | 'pass';
type ExampleCommand = 'clean' | ExampleCase | 'smoke';

const EXAMPLE_ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXAMPLE_ROOT, 'runtime-evidence.yaml');
const OUTPUT_ROOT = join(EXAMPLE_ROOT, '.runtime-evidence');
const BASELINE_URL_ENV = 'RUNTIME_EVIDENCE_EXAMPLE_BASELINE_URL';
const CANDIDATE_URL_ENV = 'RUNTIME_EVIDENCE_EXAMPLE_CANDIDATE_URL';
const EXPECTED_DIFFERENCE_PATH = '/response/body/version';

async function closeServices(services: readonly ExampleService[]): Promise<void> {
  await Promise.all(services.map((service) => service.close()));
}

async function startServicePair(
  exampleCase: ExampleCase,
): Promise<readonly [ExampleService, ExampleService]> {
  const baseline = await startExampleService(1);
  try {
    const candidate = await startExampleService(exampleCase === 'pass' ? 1 : 2);
    return [baseline, candidate];
  } catch (error) {
    await baseline.close();
    throw error;
  }
}

async function withTargetEnvironment<T>(
  services: readonly [ExampleService, ExampleService],
  operation: () => Promise<T>,
): Promise<T> {
  const previousBaseline = process.env[BASELINE_URL_ENV];
  const previousCandidate = process.env[CANDIDATE_URL_ENV];
  process.env[BASELINE_URL_ENV] = services[0].url;
  process.env[CANDIDATE_URL_ENV] = services[1].url;

  try {
    return await operation();
  } finally {
    if (previousBaseline === undefined) {
      delete process.env[BASELINE_URL_ENV];
    } else {
      process.env[BASELINE_URL_ENV] = previousBaseline;
    }
    if (previousCandidate === undefined) {
      delete process.env[CANDIDATE_URL_ENV];
    } else {
      process.env[CANDIDATE_URL_ENV] = previousCandidate;
    }
  }
}

function assertExpectedEvidence(
  exampleCase: ExampleCase,
  state: string,
  differencePaths: readonly string[],
): void {
  const expectedState = exampleCase === 'pass' ? 'pass' : 'fail';
  if (state !== expectedState) {
    throw new Error(`Expected ${expectedState} evidence but received ${state}.`);
  }
  if (exampleCase === 'pass' && differencePaths.length > 0) {
    throw new Error('The passing example produced an unexpected difference.');
  }
  if (exampleCase === 'fail' && !differencePaths.includes(EXPECTED_DIFFERENCE_PATH)) {
    throw new Error(`The failing example did not report ${EXPECTED_DIFFERENCE_PATH}.`);
  }
}

function assertSafeLocalEvidence(evidence: EvidenceV1): void {
  if (
    evidence.targets.baseline.url !== '[environment reference]' ||
    evidence.targets.candidate.url !== '[environment reference]'
  ) {
    throw new Error('Runtime target URLs escaped the environment-reference boundary.');
  }
  const network = evidence.policy?.network;
  if (
    network === undefined ||
    network.default !== 'deny' ||
    network.applicationRequests !== 'enforced' ||
    network.allowHosts.length !== 1 ||
    network.allowHosts[0] !== '127.0.0.1'
  ) {
    throw new Error('The example did not preserve its loopback-only network policy.');
  }
  if (!evidence.redaction.applied) {
    throw new Error('The example evidence did not preserve its redaction boundary.');
  }
}

export async function runExample(exampleCase: ExampleCase): Promise<void> {
  const services = await startServicePair(exampleCase);
  const outputDirectory = join(OUTPUT_ROOT, exampleCase);

  try {
    await withTargetEnvironment(services, async () => {
      const result = await runCli(
        ['verify', '--config', CONFIG_PATH, '--output', outputDirectory, '--json'],
        {
          cwd: EXAMPLE_ROOT,
          io: { stderr: () => undefined, stdout: () => undefined },
        },
      );
      const expectedExitCode = exampleCase === 'pass' ? 0 : 1;
      if (result.exitCode !== expectedExitCode) {
        throw new Error(
          `Expected CLI exit code ${expectedExitCode} but received ${result.exitCode} (${result.envelope.code}).`,
        );
      }

      const evidencePath = join(outputDirectory, EVIDENCE_FILE_NAME);
      const evidence = await readEvidenceArtifact(evidencePath);
      const differencePaths = evidence.results.flatMap((scenario) =>
        scenario.differences.map((difference) => difference.path),
      );
      assertExpectedEvidence(exampleCase, evidence.state, differencePaths);
      assertSafeLocalEvidence(evidence);

      if (exampleCase === 'pass') {
        console.log(
          `PASS example: evidence state is pass (${evidence.coverage.scenariosCompleted}/${evidence.coverage.scenariosSelected} scenarios completed).`,
        );
      } else {
        console.log(`FAIL example: evidence state is fail at ${EXPECTED_DIFFERENCE_PATH}.`);
      }
      console.log(`Evidence: ${evidencePath}`);
    });
  } finally {
    await closeServices(services);
  }
}

export async function cleanExampleOutput(): Promise<void> {
  await rm(OUTPUT_ROOT, { force: true, recursive: true });
}

async function runCommand(command: ExampleCommand): Promise<void> {
  if (command === 'clean') {
    await cleanExampleOutput();
    console.log(`Removed example evidence from ${OUTPUT_ROOT}.`);
    return;
  }
  if (command === 'smoke') {
    try {
      await runExample('pass');
      await runExample('fail');
    } finally {
      await cleanExampleOutput();
    }
    return;
  }
  await runExample(command);
}

function isExampleCommand(value: string | undefined): value is ExampleCommand {
  return value === 'clean' || value === 'fail' || value === 'pass' || value === 'smoke';
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  return entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href;
}

if (isDirectExecution()) {
  const command = process.argv[2];
  if (!isExampleCommand(command)) {
    console.error('Usage: npm run example:node-http -- <pass|fail|smoke|clean>');
    process.exitCode = 2;
  } else {
    runCommand(command).catch(() => {
      console.error('The Node.js HTTP example could not complete.');
      process.exitCode = 1;
    });
  }
}
