import * as readline from "readline";
import type { ApprovalProvider, ApprovalResponse } from "./ApprovalProvider.ts";
import { MessageBus } from "../messaging/MessageBus.ts";
import { Logger } from "../utils/Logger.ts";

/**
 * CLI-based approval provider using readline
 * This is the implementation for interactive terminal use
 */
export class CLIApprovalProvider implements ApprovalProvider {
  async request(
    req: {
      toolName: string;
      action: string;
      description: string;
      scope?: string;
      allowSession?: boolean;
    },
    mainRl?: readline.Interface,
  ): Promise<ApprovalResponse> {
    console.log("\n⚠️  Approval Required");
    console.log(`Tool: ${req.toolName}`);
    console.log(`Action: ${req.description}`);
    console.log("\nOptions:");
    console.log("  1. Approve once");
    console.log(
      req.allowSession === false
        ? "  2. Approve once (session approval unavailable)"
        : "  2. Approve for this resource this session",
    );
    console.log("  3. Reject");

    let answer: string;

    if (mainRl) {
      // Use the main readline interface - don't create a second one!
      Logger.debug("ApprovalProvider", "Using main readline for approval prompt");
      answer = await new Promise<string>((resolve) => {
        mainRl.question("\nYour choice (1-3): ", resolve);
      });
    } else {
      // Fallback: create temporary readline (for tests or non-interactive use)
      Logger.debug("ApprovalProvider", "Creating temporary readline for approval");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      answer = await new Promise<string>((resolve) => {
        rl.question("\nYour choice (1-3): ", resolve);
      });

      rl.close();
    }

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
  request(
    _req: {
      toolName: string;
      action: string;
      description: string;
      scope?: string;
      allowSession?: boolean;
    },
    _mainRl?: readline.Interface,
  ): Promise<ApprovalResponse> {
    return Promise.resolve("approve");
  }
}

/**
 * Approval manager that delegates to a provider
 * Handles session-based auto-approval logic
 */
export class ApprovalManager {
  private autoApproveScopes = new Set<string>();
  private provider: ApprovalProvider;
  private mainRl?: readline.Interface;

  constructor(provider?: ApprovalProvider, yolo = false, mainRl?: readline.Interface) {
    this.provider =
      provider ??
      (yolo ? new YoloApprovalProvider() : new CLIApprovalProvider());
    this.mainRl = mainRl;
  }

  setMainRl(rl: readline.Interface): void {
    this.mainRl = rl;
  }

  async request(
    toolName: string,
    action: string,
    description: string,
    options: { scope?: string; allowSession?: boolean } = {},
  ): Promise<boolean> {
    const cacheKey = `${action}\u0000${options.scope ?? "*"}`;
    // Check if already auto-approved for this session
    if (options.allowSession !== false && this.autoApproveScopes.has(cacheKey)) {
      return true;
    }

    // Notify UI that approval is being requested (stop spinner)
    MessageBus.getInstance().publish({
      type: 'approval_requested',
      toolName,
      action,
    });

    const response = await this.provider.request({
      toolName,
      action,
      description,
      scope: options.scope,
      allowSession: options.allowSession,
    }, this.mainRl);

    const approved = (() => {
      switch (response) {
        case "approve":
          return true;
        case "approve_for_session":
          if (options.allowSession !== false) {
            this.autoApproveScopes.add(cacheKey);
          }
          return true;
        case "reject":
        default:
          return false;
      }
    })();

    // Notify UI that approval is complete
    MessageBus.getInstance().publish({
      type: 'approval_completed',
      approved,
    });

    return approved;
  }

  setProvider(provider: ApprovalProvider): void {
    this.provider = provider;
  }
}
