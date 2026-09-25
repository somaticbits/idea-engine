import { ProviderError, ResultError } from './provider.js';

export const MAX_ASSOCIATION_ATTEMPTS = 3;

/** Retry only known-invalid model results. Provider failures can be ambiguous or billable. */
export async function retryForUsableAssociations<T>(
  generate: () => Promise<T>,
  isUsable: (result: T) => boolean,
  onAttempt: (attempt: number) => void = () => {},
) {
  let lastFailure = 'The model returned no usable branches.';

  for (let attempt = 1; attempt <= MAX_ASSOCIATION_ATTEMPTS; attempt++) {
    onAttempt(attempt);
    try {
      const result = await generate();
      if (isUsable(result)) return result;
      lastFailure = 'No new branches or connections passed the coherence and duplicate checks.';
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (!(error instanceof ResultError)) throw error;
      lastFailure = error.message;
    }
  }

  throw new ResultError(`Could not find usable associations after ${MAX_ASSOCIATION_ATTEMPTS} attempts. ${lastFailure}`);
}
