import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { ConfigLoadError, loadConfig } from '@runtime-evidence/config';
import { EvidenceArtifactError, writeEvidenceArtifact } from '@runtime-evidence/evidence-schema';
import {
  ComparisonConfigurationError,
  createVerificationEvidencePayload,
  type LoadedScenarioV1,
  loadScenarios,
  ScenarioLoadError,
  verifyScenario,
} from '@runtime-evidence/orchestrator';

import { invalidInputResult, infrastructureResult } from '../diagnostics.ts';
import { stringArrayOption, stringOption } from '../options.ts';
import type { CliCommandHandler, CliCommandResult } from '../types.ts';
import { CLI_VERSION } from '../version.ts';
import { configFailureResult } from './config-failure.ts';

const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;

function totalTimeout(options: Parameters<CliCommandHandler>[0]['options']): number | undefined {
  const value = stringOption(options, 'total-timeout-ms');
  if (value === undefined) {
    return DEFAULT_TOTAL_TIMEOUT_MS;
  }
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;
}

function scenarioFailureResult(error: ScenarioLoadError): CliCommandResult {
  const diagnostics = error.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path,
  }));
  const infrastructureCodes = new Set(['SCENARIO_DISCOVERY_FAILED', 'SCENARIO_READ_FAILED']);
  return infrastructureCodes.has(error.code)
    ? { ...infrastructureResult(error.code, error.message), diagnostics }
    : { code: error.code, diagnostics, message: error.message, status: 'invalid-input' };
}

function selectedScenarios(
  scenarios: readonly LoadedScenarioV1[],
  selectors: readonly string[],
): readonly LoadedScenarioV1[] | undefined {
  if (selectors.length === 0) {
    return scenarios;
  }
  const selected = new Set(selectors);
  if (selected.size !== selectors.length) {
    return undefined;
  }
  const matched = scenarios.filter(({ scenario }) => selected.has(scenario.id));
  return matched.length === selected.size ? matched : undefined;
}

function runIdentifier(
  configHash: string,
  createdAt: string,
  scenarioIds: readonly string[],
): string {
  const digest = createHash('sha256')
    .update([configHash, createdAt, ...scenarioIds].join('\n'), 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `run-${digest}`;
}

export const verifyCommand: CliCommandHandler = async (context) => {
  const timeoutMs = totalTimeout(context.options);
  if (timeoutMs === undefined) {
    return invalidInputResult(
      'CLI_OPTION_INVALID',
      'Total timeout must be a positive safe integer in milliseconds.',
      '/options/total-timeout-ms',
    );
  }

  try {
    const configPath = stringOption(context.options, 'config');
    const loaded = await loadConfig({
      ...(configPath === undefined ? {} : { filePath: configPath }),
      startDirectory: context.cwd,
    });
    const scenarios = await loadScenarios({
      rootDirectory: dirname(loaded.path),
      include: loaded.config.scenarios.include,
      ...(loaded.config.scenarios.exclude === undefined
        ? {}
        : { exclude: loaded.config.scenarios.exclude }),
    });
    const selected = selectedScenarios(scenarios, stringArrayOption(context.options, 'scenario'));
    if (selected === undefined) {
      return invalidInputResult(
        'CLI_SCENARIO_SELECTOR_INVALID',
        'Scenario selectors must be unique and match discovered scenario identifiers.',
        '/options/scenario',
      );
    }

    context.progress(`Verifying ${selected.length} scenario(s) under deny-by-default policy.`);
    const results = [];
    for (const { scenario } of selected) {
      results.push(
        await verifyScenario({
          config: loaded.config,
          cwd: dirname(loaded.path),
          scenario,
          signal: context.signal,
          totalTimeoutMs: timeoutMs,
        }),
      );
    }

    const createdAt = new Date().toISOString();
    const payload = createVerificationEvidencePayload({
      config: loaded.config,
      configHash: loaded.configHash,
      createdAt,
      evidenceTargets: loaded.evidenceTargets,
      results,
      runId: runIdentifier(
        loaded.configHash,
        createdAt,
        selected.map(({ scenario }) => scenario.id),
      ),
      scenarios: selected.map(({ scenario }) => scenario),
      toolVersion: CLI_VERSION,
    });
    const written = await writeEvidenceArtifact({
      outputDirectory: resolve(
        context.cwd,
        stringOption(context.options, 'output') ?? '.runtime-evidence',
      ),
      payload,
    });
    const data = {
      path: written.path,
      scenariosCompleted: written.evidence.coverage.scenariosCompleted,
      scenariosSelected: written.evidence.coverage.scenariosSelected,
      state: written.evidence.state,
    };
    const message = `Verification ${written.evidence.state}; canonical evidence written to ${written.path}.`;
    if (written.evidence.state === 'incomplete') {
      return { code: 'CLI_VERIFY_INCOMPLETE', data, message, status: 'incomplete' };
    }
    if (written.evidence.state === 'fail') {
      return { code: 'CLI_VERIFY_FAILED', data, message, status: 'behavioral-failure' };
    }
    return {
      code: 'CLI_VERIFY_COMPLETE',
      data,
      humanOutput: message,
      message,
      status: 'success',
    };
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      return configFailureResult(error);
    }
    if (error instanceof ScenarioLoadError) {
      return scenarioFailureResult(error);
    }
    if (error instanceof ComparisonConfigurationError) {
      return invalidInputResult(error.code, error.message, error.path);
    }
    if (error instanceof EvidenceArtifactError) {
      return infrastructureResult(error.code, error.message);
    }
    return infrastructureResult(
      'CLI_VERIFY_FAILED_UNEXPECTEDLY',
      'Verification could not complete.',
    );
  }
};
