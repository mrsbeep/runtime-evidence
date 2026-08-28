import { incompleteResult, invalidInputResult } from '../diagnostics.ts';
import { stringOption } from '../options.ts';
import type { CliCommandHandler } from '../types.ts';

export const verifyCommand: CliCommandHandler = (context) => {
  const totalTimeout = stringOption(context.options, 'total-timeout-ms');
  if (
    totalTimeout !== undefined &&
    (!/^[1-9]\d*$/.test(totalTimeout) || !Number.isSafeInteger(Number(totalTimeout)))
  ) {
    return invalidInputResult(
      'CLI_OPTION_INVALID',
      'Total timeout must be a positive safe integer in milliseconds.',
      '/options/total-timeout-ms',
    );
  }
  return incompleteResult(
    'CLI_VERIFY_INCOMPLETE',
    'Verification is unavailable until required network policy enforcement is implemented.',
  );
};
