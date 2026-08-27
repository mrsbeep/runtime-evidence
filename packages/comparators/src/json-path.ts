import { ComparisonConfigurationError } from './diagnostics.ts';
import type { ComparisonPolicy } from './types.ts';

export type JsonPathSegment = number | string;

export interface NormalizedComparisonPolicy {
  readonly ignoredJsonPaths: ReadonlySet<string>;
  readonly maxLatencyRegressionMs: number | undefined;
  readonly maxLatencyRegressionPercent: number;
  readonly normalizedJsonPaths: ReadonlySet<string>;
}

const supportedJsonPath = /^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:0|[1-9]\d*)\])*$/;
const jsonPathSegment = /\.([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]/g;

function parseJsonPath(path: string, configPath: string): readonly JsonPathSegment[] {
  if (!supportedJsonPath.test(path)) {
    throw new ComparisonConfigurationError(
      'COMPARE_JSON_PATH_INVALID',
      'JSON path must use the supported $.property[index] syntax.',
      configPath,
    );
  }

  const segments: JsonPathSegment[] = [];
  for (const match of path.matchAll(jsonPathSegment)) {
    const property = match[1];
    segments.push(property ?? Number(match[2]));
  }
  return Object.freeze(segments);
}

export function jsonPathKey(segments: readonly JsonPathSegment[]): string {
  return JSON.stringify(segments);
}

function parsePaths(
  paths: readonly string[],
  configPath: string,
): readonly (readonly JsonPathSegment[])[] {
  return paths.map((path, index) => parseJsonPath(path, `${configPath}/${index}`));
}

function pathsOverlap(
  left: readonly JsonPathSegment[],
  right: readonly JsonPathSegment[],
): boolean {
  const sharedLength = Math.min(left.length, right.length);
  return left.slice(0, sharedLength).every((segment, index) => segment === right[index]);
}

function validateLimit(value: number | undefined, path: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ComparisonConfigurationError(
      'COMPARE_LATENCY_LIMIT_INVALID',
      'Latency limits must be finite non-negative numbers.',
      path,
    );
  }
}

export function normalizeComparisonPolicy(policy: ComparisonPolicy): NormalizedComparisonPolicy {
  validateLimit(policy.maxLatencyRegressionMs, '/maxLatencyRegressionMs');
  validateLimit(policy.maxLatencyRegressionPercent, '/maxLatencyRegressionPercent');
  const ignoredJsonPathSegments = parsePaths(policy.ignoredJsonPaths, '/ignoredJsonPaths');
  const normalizedJsonPathSegments = parsePaths(
    policy.normalizedJsonPaths ?? [],
    '/normalizedJsonPaths',
  );

  for (const [normalizedIndex, normalizedPath] of normalizedJsonPathSegments.entries()) {
    if (ignoredJsonPathSegments.some((ignoredPath) => pathsOverlap(ignoredPath, normalizedPath))) {
      throw new ComparisonConfigurationError(
        'COMPARE_JSON_PATH_CONFLICT',
        'Ignored and normalized JSON paths cannot overlap.',
        `/normalizedJsonPaths/${normalizedIndex}`,
      );
    }
  }

  const ignoredJsonPaths = new Set(ignoredJsonPathSegments.map(jsonPathKey));
  const normalizedJsonPaths = new Set(normalizedJsonPathSegments.map(jsonPathKey));

  return Object.freeze({
    ignoredJsonPaths,
    maxLatencyRegressionMs: policy.maxLatencyRegressionMs,
    maxLatencyRegressionPercent: policy.maxLatencyRegressionPercent,
    normalizedJsonPaths,
  });
}
