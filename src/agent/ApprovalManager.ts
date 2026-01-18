import * as readline from "readline";
import type { ApprovalProvider, ApprovalResponse } from "./ApprovalProvider.js";

/**
 * CLI-based approval provider using readline
 * This is the implementation for interactive terminal use
 */
export class CLIApprovalProvider implements ApprovalProvider {
  async request(req: {
    toolName: string;
    action: string;
    description: string;
  }): Promise<ApprovalResponse> {
    console.log("\n⚠️  Approval Required");
    console.log(`Tool: ${req.toolName}`);
    console.log(`Action: ${req.description}`);
    console.log("\nOptions:");
    console.log("  1. Approve once");
    console.log("  2. Approve for this session");
    console.log("  3. Reject");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question("\nYour choice (1-3): ", resolve);
    });

    rl.close();

    switch (answer.trim()) {
      case "1":
        return "approve";
      case "2":
        return "approve_for_session";
      case "3":
      default:
        return "reject";
    }
  }
}

/**
 * Non-interactive approval provider (auto-approves everything)
 * Useful for -c flag / yolo mode
 */
export class YoloApprovalProvider implements ApprovalProvider {
  request(): Promise<ApprovalResponse> {
    return Promise.resolve("approve");
  }
}

/**
 * Approval manager that delegates to a provider
 * Handles session-based auto-approval logic
 */
export class ApprovalManager {
  private autoApproveActions = new Set<string>();
  private provider: ApprovalProvider;

  constructor(provider?: ApprovalProvider, yolo = false) {
    this.provider =
      provider ??
      (yolo ? new YoloApprovalProvider() : new CLIApprovalProvider());
  }

  async request(
    toolName: string,
    action: string,
    description: string,
  ): Promise<boolean> {
    // Check if already auto-approved for this session
    if (this.autoApproveActions.has(action)) {
      return true;
    }

    const response = await this.provider.request({
      toolName,
      action,
      description,
    });

    switch (response) {
      case "approve":
        return true;
      case "approve_for_session":
        this.autoApproveActions.add(action);
        return true;
      case "reject":
      default:
        return false;
    }
  }

  setProvider(provider: ApprovalProvider): void {
    this.provider = provider;
  }
}
