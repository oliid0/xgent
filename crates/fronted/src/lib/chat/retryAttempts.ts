export type RetryAttemptRecord = {
  attempt: number;
  maxAttempts: number;
  errorMessage: string;
  /** Backoff that will be applied before the next request starts. */
  plannedDelayMs?: number;
  /** Concrete provider/model candidate that produced this retry. */
  providerLabel?: string;
};
