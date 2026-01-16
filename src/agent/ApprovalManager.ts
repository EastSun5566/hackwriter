import * as readline from 'readline';

export class ApprovalManager {
  private yolo: boolean;
  private autoApproveActions = new Set<string>();

  constructor(yolo = false) {
    this.yolo = yolo;
  }

  async request(
    toolName: string,
    action: string,
    description: string,
  ): Promise<boolean> {
    if (this.yolo) {
      return true;
    }

    if (this.autoApproveActions.has(action)) {
      return true;
    }

    console.log('\n⚠️  Approval Required');
    console.log(`Tool: ${toolName}`);
    console.log(`Action: ${description}`);
    console.log('\nOptions:');
    console.log('  1. Approve once');
    console.log('  2. Approve for this session');
    console.log('  3. Reject');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>(resolve => {
      rl.question('\nYour choice (1-3): ', resolve);
    });

    rl.close();

    switch (answer.trim()) {
      case '1':
        return true;
      case '2':
        this.autoApproveActions.add(action);
        return true;
      case '3':
      default:
        return false;
    }
  }

  setYolo(yolo: boolean): void {
    this.yolo = yolo;
  }
}
