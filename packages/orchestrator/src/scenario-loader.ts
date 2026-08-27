import { glob, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import { ScenarioSchemaV1, type ScenarioV1 } from '@runtime-evidence/evidence-schema';
import type { TLocalizedValidationError } from 'typebox/error';
import Compile from 'typebox/compile';
import { parseDocument } from 'yaml';

import { type ScenarioDiagnostic, ScenarioLoadError, scenarioError } from './diagnostics.ts';

export interface LoadScenariosOptions {
  readonly exclude?: readonly string[];
  readonly include: readonly string[];
  readonly rootDirectory: string;
}

export interface DiscoveredScenarioFile {
  readonly filePath: string;
  /** Path relative to rootDirectory, always using forward slashes. */
  readonly relativePath: string;
}

export interface LoadedScenarioV1 extends DiscoveredScenarioFile {
  /** Validated scenario with secret references preserved and unresolved. */
  readonly scenario: ScenarioV1;
}

type JsonRecord = Record<string, unknown>;

const scenarioValidator = Compile(ScenarioSchemaV1);
const yamlExtensions = new Set(['.yaml', '.yml']);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const sensitiveHeaders = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
]);
const sensitiveEnvironmentName =
  /(?:^|_)(?:AUTH|COOKIE|CREDENTIAL|KEY|PASSWORD|PASSWD|SECRET|TOKEN)(?:_|$)/i;

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPortablePath(path: string): string {
  return path.split(sep).join('/');
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(path: string, segment: string): string {
  return `${path === '/' ? '' : path}/${escapePointerSegment(segment)}`;
}

function validatePattern(pattern: string, field: 'include' | 'exclude', index: number): void {
  const path = `/${field}/${index}`;
  const segments = pattern.split('/');
  const hasWindowsDrive = /^[A-Za-z]:/.test(pattern);

  if (
    pattern.trim().length === 0 ||
    pattern.includes('\0') ||
    pattern.includes('\\') ||
    pattern.startsWith('!') ||
    isAbsolute(pattern) ||
    hasWindowsDrive ||
    segments.includes('..')
  ) {
    throw scenarioError(
      'SCENARIO_PATTERN_INVALID',
      'Scenario patterns must be non-empty, relative, forward-slash paths without traversal or negation.',
      path,
    );
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

function assertSafeValue(
  value: unknown,
  filePath: string,
  path = '/',
  ancestors = new Set<object>(),
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== 'object') {
    throw scenarioError(
      'SCENARIO_UNSAFE_KEY',
      'Scenario values must be JSON-compatible.',
      path,
      filePath,
    );
  }

  if (ancestors.has(value)) {
    throw scenarioError(
      'SCENARIO_UNSAFE_KEY',
      'Scenario values must not contain cycles.',
      path,
      filePath,
    );
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertSafeValue(item, filePath, childPath(path, String(index)), ancestors);
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = childPath(path, key);
      if (unsafeKeys.has(key)) {
        throw scenarioError(
          'SCENARIO_UNSAFE_KEY',
          'Unsafe scenario key is not allowed.',
          itemPath,
          filePath,
        );
      }
      assertSafeValue(item, filePath, itemPath, ancestors);
    }
  } else {
    throw scenarioError(
      'SCENARIO_UNSAFE_KEY',
      'Scenario values must use plain objects.',
      path,
      filePath,
    );
  }

  ancestors.delete(value);
}

function parseYaml(source: string, filePath: string): unknown {
  try {
    const document = parseDocument(source, {
      customTags: [],
      logLevel: 'silent',
      merge: false,
      prettyErrors: false,
      resolveKnownTags: false,
      schema: 'json',
      strict: true,
      stringKeys: true,
      uniqueKeys: true,
      version: '1.2',
    });

    if (document.errors.length > 0 || document.warnings.length > 0) {
      throw scenarioError(
        'SCENARIO_PARSE_FAILED',
        'Scenario YAML could not be parsed safely.',
        '/',
        filePath,
      );
    }

    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ScenarioLoadError) {
      throw error;
    }
    throw scenarioError(
      'SCENARIO_PARSE_FAILED',
      'Scenario YAML could not be parsed safely.',
      '/',
      filePath,
    );
  }
}

function pathsForValidationError(error: TLocalizedValidationError): readonly string[] {
  const basePath = error.instancePath || '/';

  if (error.keyword === 'additionalProperties') {
    return error.params.additionalProperties.map((property) => childPath(basePath, property));
  }

  if (error.keyword === 'required') {
    return error.params.requiredProperties.map((property) => childPath(basePath, property));
  }

  return [basePath];
}

function validationDiagnostics(value: unknown, filePath: string): readonly ScenarioDiagnostic[] {
  return scenarioValidator.Errors(value).flatMap((error) => {
    const message =
      error.keyword === 'additionalProperties'
        ? 'Unknown scenario field is not allowed.'
        : error.keyword === 'required'
          ? 'Required scenario field is missing.'
          : `Scenario field failed ${error.keyword} validation.`;

    return pathsForValidationError(error).map((path) => ({
      code: 'SCENARIO_VALIDATION_FAILED' as const,
      filePath,
      message,
      path,
    }));
  });
}

function assertNoInlineSecrets(scenario: ScenarioV1, filePath: string): void {
  const diagnostics: ScenarioDiagnostic[] = [];
  for (const [header, value] of Object.entries(scenario.request.headers ?? {})) {
    if (sensitiveHeaders.has(header.toLowerCase()) && typeof value === 'string') {
      diagnostics.push({
        code: 'SCENARIO_INLINE_SECRET',
        filePath,
        message: 'Sensitive request headers must use an environment reference.',
        path: `/request/headers/${escapePointerSegment(header)}`,
      });
    }
  }

  for (const phase of ['setup', 'cleanup'] as const) {
    for (const [index, hook] of (scenario[phase] ?? []).entries()) {
      for (const [name, value] of Object.entries(hook.env ?? {})) {
        if (sensitiveEnvironmentName.test(name) && typeof value === 'string') {
          diagnostics.push({
            code: 'SCENARIO_INLINE_SECRET',
            filePath,
            message: 'Sensitive hook environment values must use an environment reference.',
            path: `/${phase}/${index}/env/${escapePointerSegment(name)}`,
          });
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    throw new ScenarioLoadError(
      'SCENARIO_INLINE_SECRET',
      'Scenario contains an unsafe inline secret.',
      diagnostics,
    );
  }
}

function freezeValue<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      freezeValue(item);
    }
    Object.freeze(value);
  }
  return value;
}

async function loadScenarioFile(file: DiscoveredScenarioFile): Promise<LoadedScenarioV1> {
  let source: string;
  try {
    source = await readFile(file.filePath, 'utf8');
  } catch {
    throw scenarioError(
      'SCENARIO_READ_FAILED',
      'Could not read the scenario file.',
      '/',
      file.filePath,
    );
  }

  const parsed = parseYaml(source, file.filePath);
  if (!isRecord(parsed)) {
    throw scenarioError(
      'SCENARIO_ROOT_INVALID',
      'Scenario root must be a mapping.',
      '/',
      file.filePath,
    );
  }
  assertSafeValue(parsed, file.filePath);

  if (!scenarioValidator.Check(parsed)) {
    throw new ScenarioLoadError(
      'SCENARIO_VALIDATION_FAILED',
      'Scenario did not match schema version 1.',
      validationDiagnostics(parsed, file.filePath),
    );
  }

  assertNoInlineSecrets(parsed, file.filePath);

  return Object.freeze({
    ...file,
    scenario: freezeValue(parsed),
  });
}

export async function discoverScenarioFiles(
  options: LoadScenariosOptions,
): Promise<readonly DiscoveredScenarioFile[]> {
  if (options.include.length === 0) {
    throw scenarioError(
      'SCENARIO_PATTERN_INVALID',
      'At least one scenario include pattern is required.',
      '/include',
    );
  }

  options.include.forEach((pattern, index) => {
    validatePattern(pattern, 'include', index);
  });
  const exclude = options.exclude ?? [];
  exclude.forEach((pattern, index) => {
    validatePattern(pattern, 'exclude', index);
  });

  let rootDirectory: string;
  try {
    rootDirectory = await realpath(resolve(options.rootDirectory));
    if (!(await stat(rootDirectory)).isDirectory()) {
      throw new Error('Not a directory');
    }
  } catch {
    throw scenarioError(
      'SCENARIO_DISCOVERY_FAILED',
      'Could not access the scenario root directory.',
      '/rootDirectory',
    );
  }

  const filesByRealPath = new Map<string, DiscoveredScenarioFile>();

  try {
    for await (const match of glob(options.include, { cwd: rootDirectory, exclude })) {
      if (!yamlExtensions.has(extname(match).toLowerCase())) {
        continue;
      }

      const matchedPath = resolve(rootDirectory, match);
      const filePath = await realpath(matchedPath);
      if (!isWithinRoot(rootDirectory, filePath)) {
        throw scenarioError(
          'SCENARIO_PATH_OUTSIDE_ROOT',
          'Scenario path resolves outside the configured root directory.',
          '/include',
          matchedPath,
        );
      }
      if (!(await stat(filePath)).isFile()) {
        continue;
      }

      filesByRealPath.set(filePath, {
        filePath,
        relativePath: toPortablePath(relative(rootDirectory, filePath)),
      });
    }
  } catch (error) {
    if (error instanceof ScenarioLoadError) {
      throw error;
    }
    throw scenarioError('SCENARIO_DISCOVERY_FAILED', 'Scenario file discovery failed.', '/include');
  }

  const files = [...filesByRealPath.values()].sort((left, right) =>
    compareCodeUnits(left.relativePath, right.relativePath),
  );
  if (files.length === 0) {
    throw scenarioError(
      'SCENARIO_NOT_FOUND',
      'No YAML scenario files matched the configured patterns.',
      '/include',
    );
  }
  return Object.freeze(files);
}

export async function loadScenarios(
  options: LoadScenariosOptions,
): Promise<readonly LoadedScenarioV1[]> {
  const files = await discoverScenarioFiles(options);
  const scenarios: LoadedScenarioV1[] = [];
  const filesByIdentifier = new Map<string, string>();

  for (const file of files) {
    const loaded = await loadScenarioFile(file);
    const existingFile = filesByIdentifier.get(loaded.scenario.id);
    if (existingFile !== undefined) {
      throw new ScenarioLoadError('SCENARIO_DUPLICATE_ID', 'Scenario identifiers must be unique.', [
        {
          code: 'SCENARIO_DUPLICATE_ID',
          filePath: existingFile,
          message: 'Duplicate scenario identifier is declared here.',
          path: '/id',
        },
        {
          code: 'SCENARIO_DUPLICATE_ID',
          filePath: loaded.filePath,
          message: 'Duplicate scenario identifier is declared here.',
          path: '/id',
        },
      ]);
    }

    filesByIdentifier.set(loaded.scenario.id, loaded.filePath);
    scenarios.push(loaded);
  }

  return Object.freeze(scenarios);
}
