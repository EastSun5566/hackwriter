/**
 * Halt kinds represent different reasons why agent execution stops
 */
export type Halt =
  | { kind: 'done' }                       // Natural completion (no more tool calls)
  | { kind: 'max_steps' }                  // Reached maximum steps
  | { kind: 'error'; error: Error }        // Execution error
  | { kind: 'stuck' }                      // Agent stuck in loop
  | { kind: 'await_user' };                // Waiting for user input (future)

/**
 * Step outcome represents result of executing a single agent step
 */
export type StepOutcome =
  | { kind: 'continue' }                   // Continue to next step
  | { kind: 'halt'; halt: Halt };          // Stop execution with reason

/**
 * Creates a continue outcome
 */
export function stepContinue(): StepOutcome {
  return { kind: 'continue' };
}

/**
 * Creates a halt outcome
 */
export function stepHalt(halt: Halt): StepOutcome {
  return { kind: 'halt', halt };
}
