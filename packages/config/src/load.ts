import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

import { ConfigSchemaV1, type ConfigV1 } from '@runtime-evidence/evidence-schema';
import type { TLocalizedValidationError } from 'typebox/error';
import Compile from 'typebox/compile';
import { parseDocument } from 'yaml';

import { hashConfig } from './canonical.ts';
import { type ConfigDiagnostic, ConfigLoadError, configError } from './diagnostics.ts';

export const CONFIG_FILE_NAME = 'runtime-evidence.yaml' as const;

export const CONFIG_DEFAULTS_V1 = Object.freeze({
  network: Object.freeze({
    default: 'deny',
    allowHosts: Object.freeze([]),
  }),
  redaction: Object.freeze({
    headers: Object.freeze([
      'authorization',
      'cookie',
      'proxy-authorization',
      'set-cookie',
      'x-api-key',
    ]),
    jsonPaths: Object.freeze([]),
  }),
  timeouts: Object.freeze({
    connectMs: 1_000,
    requestMs: 10_000,
  }),
  comparison: Object.freeze({
    ignoredJsonPaths: Object.freeze([]),
    normalizedJsonPaths: Object.freeze([]),
    maxLatencyRegressionPercent: 20,
  }),
});

type DeepPartial<Value> = Value extends readonly unknown[]
  ? Value
  : Value extends object
    ? { [Key in keyof Value]?: DeepPartial<Value[Key]> }
    : Value;

type ResolveSecretReferences<Value> = Value extends { env: string }
  ? string
  : Value extends readonly (infer Item)[]
    ? ResolveSecretReferences<Item>[]
    : Value extends object
      ? { [Key in keyof Value]: ResolveSecretReferences<Value[Key]> }
      : Value;

export type ConfigOverridesV1 = DeepPartial<ConfigV1>;
export type EffectiveConfigV1 = ResolveSecretReferences<ConfigV1>;

export interface LoadConfigOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly filePath?: string;
  readonly overrides?: ConfigOverridesV1;
  readonly startDirectory?: string;
}

export interface LoadedConfigV1 {
  /** Resolved configuration for runtime use. It may contain secrets and must not be persisted. */
  readonly config: EffectiveConfigV1;
  /** SHA-256 of the canonical effective config with environment references left unresolved. */
  readonly configHash: string;
  readonly path: string;
}

type JsonRecord = Record<string, unknown>;

const configValidator = Compile(ConfigSchemaV1);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const builtInSensitiveHeaders = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
]);

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(path: string, segment: string): string {
  return `${path === '/' ? '' : path}/${escapePointerSegment(segment)}`;
}

function assertSafeValue(
  value: unknown,
  code: 'CONFIG_UNSAFE_KEY' | 'CONFIG_OVERRIDE_INVALID',
  configPath: string,
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
    throw configError(code, 'Configuration values must be JSON-compatible.', path, configPath);
  }

  if (ancestors.has(value)) {
    throw configError(code, 'Configuration values must not contain cycles.', path, configPath);
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertSafeValue(item, code, configPath, childPath(path, String(index)), ancestors);
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = childPath(path, key);
      if (unsafeKeys.has(key)) {
        throw configError(
          'CONFIG_UNSAFE_KEY',
          'Unsafe configuration key is not allowed.',
          itemPath,
          configPath,
        );
      }
      assertSafeValue(item, code, configPath, itemPath, ancestors);
    }
  } else {
    throw configError(code, 'Configuration values must use plain objects.', path, configPath);
  }

  ancestors.delete(value);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }

  return value;
}

function mergeValues(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return cloneValue(override);
  }

  const result: JsonRecord = Object.fromEntries(
    Object.entries(base).map(([key, value]) => [key, cloneValue(value)]),
  );

  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? mergeValues(result[key], value) : cloneValue(value);
  }

  return result;
}

function parseYaml(source: string, configPath: string): unknown {
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
      throw configError(
        'CONFIG_PARSE_FAILED',
        'Configuration YAML could not be parsed safely.',
        '/',
        configPath,
      );
    }

    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      throw error;
    }
    throw configError(
      'CONFIG_PARSE_FAILED',
      'Configuration YAML could not be parsed safely.',
      '/',
      configPath,
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

function validationDiagnostics(value: unknown): readonly ConfigDiagnostic[] {
  return configValidator.Errors(value).flatMap((error) => {
    const message =
      error.keyword === 'additionalProperties'
        ? 'Unknown configuration field is not allowed.'
        : error.keyword === 'required'
          ? 'Required configuration field is missing.'
          : `Configuration field failed ${error.keyword} validation.`;

    return pathsForValidationError(error).map((path) => ({
      code: 'CONFIG_VALIDATION_FAILED' as const,
      message,
      path,
    }));
  });
}

function assertNoInlineSecrets(config: ConfigV1, configPath: string): void {
  const sensitiveHeaders = new Set([
    ...builtInSensitiveHeaders,
    ...config.redaction.headers.map((header) => header.toLowerCase()),
  ]);
  const diagnostics: ConfigDiagnostic[] = [];

  for (const targetName of ['baseline', 'candidate'] as const) {
    const headers = config.targets[targetName].headers ?? {};
    for (const [header, value] of Object.entries(headers)) {
      if (sensitiveHeaders.has(header.toLowerCase()) && typeof value === 'string') {
        diagnostics.push({
          code: 'CONFIG_INLINE_SECRET',
          message: 'Sensitive header values must use an environment reference.',
          path: `/targets/${targetName}/headers/${escapePointerSegment(header)}`,
        });
      }
    }
  }

  if (diagnostics.length > 0) {
    throw new ConfigLoadError(
      'CONFIG_INLINE_SECRET',
      'Configuration contains an unsafe inline secret.',
      diagnostics,
      configPath,
    );
  }
}

function resolveReference(
  value: string | { env: string },
  environment: Readonly<Record<string, string | undefined>>,
  path: string,
  configPath: string,
): string {
  if (typeof value === 'string') {
    return value;
  }

  const resolvedValue = Object.hasOwn(environment, value.env) ? environment[value.env] : undefined;
  if (resolvedValue === undefined) {
    throw configError(
      'CONFIG_ENV_MISSING',
      'A required environment reference is not set.',
      path,
      configPath,
    );
  }
  return resolvedValue;
}

function resolveTarget(
  target: ConfigV1['targets']['baseline'],
  environment: Readonly<Record<string, string | undefined>>,
  path: string,
  configPath: string,
): EffectiveConfigV1['targets']['baseline'] {
  const headers = target.headers;
  return {
    url: resolveReference(target.url, environment, `${path}/url`, configPath),
    ...(headers === undefined
      ? {}
      : {
          headers: Object.fromEntries(
            Object.entries(headers).map(([header, value]) => [
              header,
              resolveReference(
                value,
                environment,
                `${path}/headers/${escapePointerSegment(header)}`,
                configPath,
              ),
            ]),
          ),
        }),
  };
}

function resolveEnvironment(
  config: ConfigV1,
  environment: Readonly<Record<string, string | undefined>>,
  configPath: string,
): EffectiveConfigV1 {
  return {
    ...config,
    targets: {
      baseline: resolveTarget(
        config.targets.baseline,
        environment,
        '/targets/baseline',
        configPath,
      ),
      candidate: resolveTarget(
        config.targets.candidate,
        environment,
        '/targets/candidate',
        configPath,
      ),
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/** Searches the start directory and each parent for runtime-evidence.yaml. */
export async function discoverConfig(startDirectory = process.cwd()): Promise<string | undefined> {
  let directory = resolve(startDirectory);
  const root = parse(directory).root;

  while (true) {
    const candidate = join(directory, CONFIG_FILE_NAME);
    try {
      if ((await stat(candidate)).isFile()) {
        return candidate;
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw configError(
          'CONFIG_READ_FAILED',
          'Could not inspect a configuration path.',
          '/',
          candidate,
        );
      }
    }

    if (directory === root) {
      return undefined;
    }
    directory = dirname(directory);
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfigV1> {
  const startDirectory = resolve(options.startDirectory ?? process.cwd());
  const configPath =
    options.filePath === undefined
      ? await discoverConfig(startDirectory)
      : isAbsolute(options.filePath)
        ? options.filePath
        : resolve(startDirectory, options.filePath);

  if (configPath === undefined) {
    throw configError(
      'CONFIG_NOT_FOUND',
      `${CONFIG_FILE_NAME} was not found.`,
      '/',
      startDirectory,
    );
  }

  let source: string;
  try {
    source = await readFile(configPath, 'utf8');
  } catch {
    throw configError(
      'CONFIG_READ_FAILED',
      'Could not read the configuration file.',
      '/',
      configPath,
    );
  }

  const parsed = parseYaml(source, configPath);
  if (!isRecord(parsed)) {
    throw configError(
      'CONFIG_ROOT_INVALID',
      'Configuration root must be a mapping.',
      '/',
      configPath,
    );
  }
  assertSafeValue(parsed, 'CONFIG_UNSAFE_KEY', configPath);

  const overrides = options.overrides ?? {};
  if (!isRecord(overrides)) {
    throw configError(
      'CONFIG_OVERRIDE_INVALID',
      'Configuration overrides must be a mapping.',
      '/',
      configPath,
    );
  }
  assertSafeValue(overrides, 'CONFIG_OVERRIDE_INVALID', configPath);

  const withDefaults = mergeValues(CONFIG_DEFAULTS_V1, parsed);
  const merged = mergeValues(withDefaults, overrides);

  if (!configValidator.Check(merged)) {
    throw new ConfigLoadError(
      'CONFIG_VALIDATION_FAILED',
      'Configuration did not match schema version 1.',
      validationDiagnostics(merged),
      configPath,
    );
  }

  assertNoInlineSecrets(merged, configPath);

  return {
    config: resolveEnvironment(merged, options.environment ?? process.env, configPath),
    configHash: hashConfig(merged),
    path: configPath,
  };
}
