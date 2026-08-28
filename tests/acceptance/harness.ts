import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';

import { runCli, type CliRunResult } from '@runtime-evidence/cli';
import {
  type ConfigV1,
  EVIDENCE_FILE_NAME,
  type EvidenceV1,
  readEvidenceArtifact,
  type ScenarioV1,
} from '@runtime-evidence/evidence-schema';

export interface TargetResponse {
  readonly body?: unknown;
  readonly delayMs?: number;
  readonly statusCode?: number;
}

export type TargetResponder = (request: IncomingMessage) => TargetResponse;

export interface CapturedCliRun {
  readonly result: CliRunResult;
  readonly stderr: string;
  readonly stdout: string;
}

export interface AcceptanceProject {
  readonly configPath: string;
  readonly directory: string;
  readonly scenarioPath: string;
}

export interface VerificationRun extends CapturedCliRun {
  readonly evidence: EvidenceV1 | undefined;
  readonly evidencePath: string;
  readonly project: AcceptanceProject;
}

interface AcceptanceConfigOptions {
  readonly baselineHeaders?: ConfigV1['targets']['baseline']['headers'];
  readonly baselineUrl: string;
  readonly candidateHeaders?: ConfigV1['targets']['candidate']['headers'];
  readonly candidateUrl: string;
  readonly comparison?: Partial<ConfigV1['comparison']>;
  readonly timeouts?: Partial<ConfigV1['timeouts']>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
      } else {
        rejectPromise(error);
      }
    });
    server.closeAllConnections();
  });
}

function responseBody(value: unknown): { readonly content: string; readonly isJson: boolean } {
  if (typeof value === 'string') {
    return { content: value, isJson: false };
  }
  return { content: JSON.stringify(value ?? {}), isJson: true };
}

async function serveResponse(
  request: IncomingMessage,
  response: ServerResponse,
  responder: TargetResponder,
): Promise<void> {
  const fixture = responder(request);
  if (fixture.delayMs !== undefined) {
    await delay(fixture.delayMs);
  }
  if (response.destroyed) {
    return;
  }

  const body = responseBody(fixture.body);
  response.writeHead(fixture.statusCode ?? 200, {
    'content-length': Buffer.byteLength(body.content),
    'content-type': body.isJson ? 'application/json' : 'text/plain',
  });
  response.end(body.content);
}

async function listen(server: Server): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const fail = (error: Error): void => rejectPromise(error);
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', fail);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        const addressError = new Error('Acceptance target did not receive a TCP address.');
        void closeServer(server).then(
          () => rejectPromise(addressError),
          (closeError: unknown) => rejectPromise(closeError),
        );
        return;
      }
      resolvePromise(`http://127.0.0.1:${address.port}`);
    });
  });
}

export async function startTarget(
  context: TestContext,
  responder: TargetResponder,
): Promise<string> {
  const server = createServer((request, response) => {
    void serveResponse(request, response, responder).catch(() => response.destroy());
  });
  const url = await listen(server);
  context.after(() => closeServer(server));
  return url;
}

export async function unavailableTargetUrl(): Promise<string> {
  const server = createServer();
  const url = await listen(server);
  await closeServer(server);
  return url;
}

export function createAcceptanceConfig(options: AcceptanceConfigOptions): ConfigV1 {
  return {
    schemaVersion: 1,
    project: { name: 'v0.1-acceptance' },
    targets: {
      baseline: {
        url: options.baselineUrl,
        ...(options.baselineHeaders === undefined ? {} : { headers: options.baselineHeaders }),
      },
      candidate: {
        url: options.candidateUrl,
        ...(options.candidateHeaders === undefined ? {} : { headers: options.candidateHeaders }),
      },
    },
    scenarios: { include: ['scenarios/acceptance.yaml'] },
    network: { default: 'deny', allowHosts: ['127.0.0.1'], allowDependencyHosts: [] },
    sideEffects: { allowStateChanging: false },
    redaction: { headers: ['authorization'], jsonPaths: [] },
    timeouts: { connectMs: 500, requestMs: 1_000, ...options.timeouts },
    comparison: {
      ignoredJsonPaths: [],
      normalizedJsonPaths: [],
      maxLatencyRegressionPercent: 1_000_000_000,
      ...options.comparison,
    },
  };
}

export function createAcceptanceScenario(overrides: Partial<ScenarioV1> = {}): ScenarioV1 {
  return {
    schemaVersion: 1,
    id: 'v0.1-acceptance',
    name: 'v0.1 acceptance scenario',
    provenance: { source: 'test-adapter' },
    safety: { classification: 'read-only', rationale: 'Disposable loopback targets only.' },
    request: { method: 'GET', path: '/acceptance' },
    ...overrides,
  };
}

export async function createAcceptanceProject(
  context: TestContext,
  config: ConfigV1,
  scenario: ScenarioV1,
): Promise<AcceptanceProject> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-acceptance-'));
  const scenarioDirectory = join(directory, 'scenarios');
  const configPath = join(directory, 'runtime-evidence.yaml');
  const scenarioPath = join(scenarioDirectory, 'acceptance.yaml');
  context.after(() => rm(directory, { force: true, recursive: true }));

  await mkdir(scenarioDirectory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  return { configPath, directory, scenarioPath };
}

export async function createMalformedProject(context: TestContext): Promise<AcceptanceProject> {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-evidence-acceptance-'));
  const configPath = join(directory, 'runtime-evidence.yaml');
  const scenarioPath = join(directory, 'scenarios', 'acceptance.yaml');
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(configPath, 'schemaVersion: [\n', 'utf8');
  return { configPath, directory, scenarioPath };
}

export async function runCapturedCli(
  arguments_: readonly string[],
  options: { readonly cwd: string; readonly signal?: AbortSignal },
): Promise<CapturedCliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await runCli(arguments_, {
    cwd: options.cwd,
    io: {
      stderr: (text) => stderr.push(text),
      stdout: (text) => stdout.push(text),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { result, stderr: stderr.join(''), stdout: stdout.join('') };
}

export async function runVerification(
  project: AcceptanceProject,
  signal?: AbortSignal,
): Promise<VerificationRun> {
  const outputDirectory = join(project.directory, 'evidence');
  const evidencePath = join(outputDirectory, EVIDENCE_FILE_NAME);
  const run = await runCapturedCli(
    ['verify', '--config', project.configPath, '--output', outputDirectory, '--json'],
    { cwd: project.directory, ...(signal === undefined ? {} : { signal }) },
  );
  const evidenceExists = await access(evidencePath).then(
    () => true,
    () => false,
  );
  const evidence = evidenceExists ? await readEvidenceArtifact(evidencePath) : undefined;
  return { ...run, evidence, evidencePath, project };
}

export async function renderEvidenceReports(run: VerificationRun): Promise<string> {
  const rendered: string[] = [];
  for (const format of ['markdown', 'junit'] as const) {
    const report = await runCapturedCli(
      ['report', '--input', run.evidencePath, '--format', format],
      { cwd: dirname(run.evidencePath) },
    );
    if (report.result.exitCode !== 0) {
      throw new Error(`The ${format} acceptance report could not be rendered.`);
    }
    rendered.push(report.stdout, report.stderr);
  }
  return rendered.join('');
}

export async function readProjectSources(project: AcceptanceProject): Promise<string> {
  const sources = [await readFile(project.configPath, 'utf8')];
  if (
    await access(project.scenarioPath).then(
      () => true,
      () => false,
    )
  ) {
    sources.push(await readFile(project.scenarioPath, 'utf8'));
  }
  return sources.join('\n');
}
