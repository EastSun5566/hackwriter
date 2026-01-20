import * as readline from "readline";

/**
 * Response type for approval requests
 */
export type ApprovalResponse = "approve" | "approve_for_session" | "reject";

/**
 * Interface for approval providers
 * This allows different implementations (CLI, UI, non-interactive, etc.)
 */
export interface ApprovalProvider {
  /**
   * Request approval for a potentially dangerous operation
   * @param request The approval request details
   * @param mainRl Optional main readline interface to pause during approval
   * @returns Promise resolving to approval response
   */
  request(
    request: {
      toolName: string;
      action: string;
      description: string;
    },
    mainRl?: readline.Interface,
  ): Promise<ApprovalResponse>;
}
