import { spawn, type ChildProcess } from 'node:child_process';

import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';

import type { ScenarioDiagnosticCode } from './diagnostics.ts';

export type ScenarioHook = NonNullable<ScenarioV1['setup']>[number];
export type ScenarioHookPhase = 'setup' | 'cleanup';
export type ScenarioLifecyclePhase = ScenarioHookPhase | 'operation';

export interface ExecuteScenarioHookOptions {
  /** Non-secret environment values exposed to every hook. Defaults to a minimal OS allowlist. */
  readonly baseEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** Source used to resolve explicit environment references. Defaults to process.env. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly index: number;
  readonly phase: ScenarioHookPhase;
  readonly signal?: AbortSignal;
  readonly terminationGraceMs?: number;
}

export interface ScenarioHookResult {
  readonly exitCode: 0;
  readonly index: number;
  readonly phase: ScenarioHookPhase;
}

export interface ScenarioHookFailureSummary {
  readonly code: ScenarioDiagnosticCode;
  readonly exitCode: number | null;
  readonly index: number;
  readonly phase: ScenarioHookPhase;
  readonly signal: NodeJS.Signals | null;
}

export class ScenarioHookError extends Error {
  readonly code: ScenarioDiagnosticCode;
  readonly exitCode: number | null;
  readonly index: number;
  readonly path: string;
  readonly phase: ScenarioHookPhase;
  readonly signal: NodeJS.Signals | null;

  constructor(
    code: ScenarioDiagnosticCode,
    message: string,
    options: {
      readonly exitCode?: number | null;
      readonly index: number;
      readonly path?: string;
      readonly phase: ScenarioHookPhase;
      readonly signal?: NodeJS.Signals | null;
    },
  ) {
    super(message);
    this.name = 'ScenarioHookError';
    this.code = code;
    this.exitCode = options.exitCode ?? null;
    this.index = options.index;
    this.path = options.path ?? `/${options.phase}/${options.index}`;
    this.phase = options.phase;
    this.signal = options.signal ?? null;
  }

  summary(): ScenarioHookFailureSummary {
    return {
      code: this.code,
      exitCode: this.exitCode,
      index: this.index,
      phase: this.phase,
      signal: this.signal,
    };
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      message: this.message,
      path: this.path,
      ...this.summary(),
    };
  }
}

export class ScenarioLifecycleError extends Error {
  readonly cleanupFailures: readonly ScenarioHookFailureSummary[];
  readonly code: ScenarioDiagnosticCode;
  readonly phase: ScenarioLifecyclePhase;
  readonly primaryFailure: ScenarioHookFailureSummary | undefined;

  constructor(
    code: ScenarioDiagnosticCode,
    message: string,
    phase: ScenarioLifecyclePhase,
    cleanupFailures: readonly ScenarioHookFailureSummary[],
    primaryFailure: ScenarioHookFailureSummary | undefined,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ScenarioLifecycleError';
    this.cleanupFailures = cleanupFailures;
    this.code = code;
    this.phase = phase;
    this.primaryFailure = primaryFailure;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      phase: this.phase,
      cleanupFailures: this.cleanupFailures,
      ...(this.primaryFailure === undefined ? {} : { primaryFailure: this.primaryFailure }),
    };
  }
}

export interface RunScenarioLifecycleOptions {
  readonly baseEnvironment?: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
  readonly terminationGraceMs?: number;
}

const safeBaseEnvironmentKeys = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'COMSPEC',
  'TMPDIR',
  'TMP',
  'TEMP',
  'HOME',
  'USERPROFILE',
] as const;

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function defaultBaseEnvironment(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    safeBaseEnvironmentKeys.flatMap((key) => {
      const value = Object.hasOwn(process.env, key) ? process.env[key] : undefined;
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function definedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
}

function resolveHookEnvironment(
  hook: ScenarioHook,
  options: ExecuteScenarioHookOptions,
): Record<string, string> {
  const referenceEnvironment = options.environment ?? process.env;
  const hookEnvironment: Record<string, string> = {};

  for (const [name, value] of Object.entries(hook.env ?? {})) {
    if (typeof value === 'string') {
      hookEnvironment[name] = value;
      continue;
    }

    const resolved = Object.hasOwn(referenceEnvironment, value.env)
      ? referenceEnvironment[value.env]
      : undefined;
    if (resolved === undefined) {
      throw new ScenarioHookError(
        'SCENARIO_HOOK_ENV_MISSING',
        'A required hook environment reference is not set.',
        {
          index: options.index,
          path: `/${options.phase}/${options.index}/env/${escapePointerSegment(name)}`,
          phase: options.phase,
        },
      );
    }
    hookEnvironment[name] = resolved;
  }

  return {
    ...definedEnvironment(options.baseEnvironment ?? defaultBaseEnvironment()),
    ...hookEnvironment,
  };
}

function terminateChild(child: ChildProcess, forceAfterMs: number): NodeJS.Timeout {
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => child.kill('SIGKILL'), forceAfterMs);
  forceTimer.unref();
  return forceTimer;
}

/** Executes one hook without a shell and without inheriting the complete parent environment. */
export async function executeScenarioHook(
  hook: ScenarioHook,
  options: ExecuteScenarioHookOptions,
): Promise<ScenarioHookResult> {
  const path = `/${options.phase}/${options.index}`;
  if (options.signal?.aborted) {
    throw new ScenarioHookError('SCENARIO_HOOK_ABORTED', 'Scenario hook was aborted.', {
      index: options.index,
      phase: options.phase,
    });
  }

  const environment = resolveHookEnvironment(hook, options);
  const terminationGraceMs = Math.max(0, Math.min(options.terminationGraceMs ?? 250, 10_000));

  return new Promise<ScenarioHookResult>((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawn(hook.command, [...hook.args], {
        cwd: options.cwd,
        env: environment,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      rejectPromise(
        new ScenarioHookError(
          'SCENARIO_HOOK_START_FAILED',
          'Scenario hook process could not be started.',
          { index: options.index, phase: options.phase },
        ),
      );
      return;
    }

    let forceTimer: NodeJS.Timeout | undefined;
    let terminationReason: 'abort' | 'timeout' | undefined;
    let settled = false;

    const timeout = setTimeout(
      () => {
        if (terminationReason === undefined) {
          terminationReason = 'timeout';
          forceTimer = terminateChild(child, terminationGraceMs);
        }
      },
      Math.min(hook.timeoutMs, 2_147_483_647),
    );
    timeout.unref();

    const abort = (): void => {
      if (terminationReason === undefined) {
        terminationReason = 'abort';
        forceTimer = terminateChild(child, terminationGraceMs);
      }
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceTimer !== undefined) {
        clearTimeout(forceTimer);
      }
      options.signal?.removeEventListener('abort', abort);
      action();
    };

    child.once('error', () => {
      finish(() =>
        rejectPromise(
          new ScenarioHookError(
            'SCENARIO_HOOK_START_FAILED',
            'Scenario hook process could not be started.',
            { index: options.index, phase: options.phase },
          ),
        ),
      );
    });

    child.once('close', (exitCode, signal) => {
      finish(() => {
        if (terminationReason === 'timeout') {
          rejectPromise(
            new ScenarioHookError('SCENARIO_HOOK_TIMEOUT', 'Scenario hook timed out.', {
              exitCode,
              index: options.index,
              phase: options.phase,
              signal,
            }),
          );
          return;
        }
        if (terminationReason === 'abort') {
          rejectPromise(
            new ScenarioHookError('SCENARIO_HOOK_ABORTED', 'Scenario hook was aborted.', {
              exitCode,
              index: options.index,
              phase: options.phase,
              signal,
            }),
          );
          return;
        }
        if (exitCode !== 0) {
          rejectPromise(
            new ScenarioHookError('SCENARIO_HOOK_FAILED', 'Scenario hook exited unsuccessfully.', {
              exitCode,
              index: options.index,
              phase: options.phase,
              signal,
            }),
          );
          return;
        }
        resolvePromise({ exitCode: 0, index: options.index, phase: options.phase });
      });
    });
  }).catch((error: unknown) => {
    if (error instanceof ScenarioHookError) {
      throw error;
    }
    throw new ScenarioHookError(
      'SCENARIO_HOOK_START_FAILED',
      'Scenario hook process could not be started.',
      { index: options.index, path, phase: options.phase },
    );
  });
}

async function runCleanupHooks(
  hooks: readonly ScenarioHook[],
  options: RunScenarioLifecycleOptions,
): Promise<readonly ScenarioHookError[]> {
  const failures: ScenarioHookError[] = [];
  for (const [index, hook] of hooks.entries()) {
    try {
      await executeScenarioHook(hook, {
        ...(options.baseEnvironment === undefined
          ? {}
          : { baseEnvironment: options.baseEnvironment }),
        cwd: options.cwd,
        ...(options.environment === undefined ? {} : { environment: options.environment }),
        index,
        phase: 'cleanup',
        ...(options.terminationGraceMs === undefined
          ? {}
          : { terminationGraceMs: options.terminationGraceMs }),
      });
    } catch (error) {
      failures.push(
        error instanceof ScenarioHookError
          ? error
          : new ScenarioHookError(
              'SCENARIO_HOOK_FAILED',
              'Scenario cleanup hook failed unexpectedly.',
              { index, phase: 'cleanup' },
            ),
      );
    }
  }
  return failures;
}

/**
 * Runs setup, an operation, and cleanup. Every cleanup hook is attempted once per invocation,
 * including after setup failure, timeout, operation failure, or caller abort.
 */
export async function runScenarioLifecycle<Result>(
  scenario: ScenarioV1,
  operation: (signal: AbortSignal | undefined) => Promise<Result> | Result,
  options: RunScenarioLifecycleOptions,
): Promise<Result> {
  let completed = false;
  let primaryCode: ScenarioDiagnosticCode | undefined;
  let primaryError: unknown;
  let primaryFailure: ScenarioHookFailureSummary | undefined;
  let primaryPhase: ScenarioLifecyclePhase = 'operation';
  let result: Result | undefined;

  try {
    for (const [index, hook] of (scenario.setup ?? []).entries()) {
      try {
        await executeScenarioHook(hook, {
          ...(options.baseEnvironment === undefined
            ? {}
            : { baseEnvironment: options.baseEnvironment }),
          cwd: options.cwd,
          ...(options.environment === undefined ? {} : { environment: options.environment }),
          index,
          phase: 'setup',
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.terminationGraceMs === undefined
            ? {}
            : { terminationGraceMs: options.terminationGraceMs }),
        });
      } catch (error) {
        primaryCode = error instanceof ScenarioHookError ? error.code : 'SCENARIO_HOOK_FAILED';
        primaryError = error;
        primaryFailure = error instanceof ScenarioHookError ? error.summary() : undefined;
        primaryPhase = 'setup';
        throw error;
      }
    }

    if (options.signal?.aborted) {
      primaryCode = 'SCENARIO_OPERATION_ABORTED';
      primaryError = new Error('Operation aborted');
      throw primaryError;
    }

    try {
      result = await operation(options.signal);
      completed = true;
    } catch (error) {
      primaryCode = options.signal?.aborted
        ? 'SCENARIO_OPERATION_ABORTED'
        : 'SCENARIO_OPERATION_FAILED';
      primaryError = error;
      primaryPhase = 'operation';
    }
  } catch (error) {
    primaryError ??= error;
    primaryCode ??= 'SCENARIO_OPERATION_FAILED';
  }

  const cleanupErrors = await runCleanupHooks(scenario.cleanup ?? [], options);
  const cleanupFailures = cleanupErrors.map((error) => error.summary());

  if (!completed) {
    throw new ScenarioLifecycleError(
      primaryCode ?? 'SCENARIO_OPERATION_FAILED',
      'Scenario lifecycle did not complete successfully.',
      primaryPhase,
      cleanupFailures,
      primaryFailure,
      primaryError,
    );
  }

  if (cleanupFailures.length > 0) {
    throw new ScenarioLifecycleError(
      'SCENARIO_CLEANUP_FAILED',
      'Scenario operation completed, but cleanup did not.',
      'cleanup',
      cleanupFailures,
      undefined,
      cleanupErrors[0],
    );
  }

  return result as Result;
}
