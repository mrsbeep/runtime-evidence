import { resolve } from 'node:path';

import {
  EvidenceArtifactError,
  readEvidenceArtifact,
  serializeEvidenceArtifact,
} from '@runtime-evidence/evidence-schema';
import { renderJUnitEvidence } from '@runtime-evidence/reporter-junit';
import { renderMarkdownEvidence } from '@runtime-evidence/reporter-markdown';

import { infrastructureResult } from '../diagnostics.ts';
import { writeTextFile } from '../files.ts';
import { stringOption } from '../options.ts';
import type { CliCommandHandler, CliCommandResult } from '../types.ts';

type ReportFormat = 'json' | 'junit' | 'markdown';

function artifactFailure(error: EvidenceArtifactError): CliCommandResult {
  const result = {
    code: error.code,
    diagnostics: [{ code: error.code, message: error.message, path: error.path }],
    message: error.message,
  } as const;
  return error.code === 'EVIDENCE_READ_FAILED'
    ? { ...result, status: 'infrastructure-failure' }
    : { ...result, status: 'invalid-input' };
}

function render(format: ReportFormat, evidence: unknown): string {
  switch (format) {
    case 'json':
      return serializeEvidenceArtifact(evidence);
    case 'junit':
      return renderJUnitEvidence(evidence);
    case 'markdown':
      return renderMarkdownEvidence(evidence);
  }
}

export const reportCommand: CliCommandHandler = async (context) => {
  const input = resolve(context.cwd, stringOption(context.options, 'input') as string);
  const format = (stringOption(context.options, 'format') ?? 'markdown') as ReportFormat;
  const requestedOutput = stringOption(context.options, 'output');

  context.progress('Validating evidence integrity and rendering the report.');
  try {
    const evidence = await readEvidenceArtifact(input);
    const content = render(format, evidence);
    if (requestedOutput !== undefined) {
      const path = await writeTextFile(resolve(context.cwd, requestedOutput), content, {
        overwrite: true,
      });
      return {
        code: 'CLI_REPORT_WRITTEN',
        data: { format, path },
        humanOutput: `Wrote ${format} report to ${path}`,
        message: 'Evidence report written.',
        status: 'success',
      };
    }
    return {
      code: 'CLI_REPORT_RENDERED',
      data: { content, format },
      humanOutput: content,
      message: 'Evidence report rendered.',
      status: 'success',
    };
  } catch (error) {
    if (error instanceof EvidenceArtifactError) {
      return artifactFailure(error);
    }
    return requestedOutput === undefined
      ? infrastructureResult('CLI_REPORT_RENDER_FAILED', 'Evidence report could not be rendered.')
      : infrastructureResult('CLI_REPORT_WRITE_FAILED', 'Evidence report could not be written.');
  }
};
