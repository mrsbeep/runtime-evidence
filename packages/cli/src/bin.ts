#!/usr/bin/env node

import { runCli } from './run.ts';

const abortController = new AbortController();
const interrupt = (): void => abortController.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
  const result = await runCli(process.argv.slice(2), { signal: abortController.signal });
  process.exitCode = result.exitCode;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
