import { vi } from 'vitest';

export function createMockApprovalManager(autoApprove = true) {
  return {
    request: vi.fn().mockResolvedValue(autoApprove),
    setYolo: vi.fn(),
  };
}
