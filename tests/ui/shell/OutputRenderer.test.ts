import { beforeEach, describe, expect, it, vi } from 'vitest';

var spinner: {
  text: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  succeed: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
};

var oraFactory: ReturnType<typeof vi.fn>;

vi.mock('ora', () => {
  spinner = {
    text: '',
    start: vi.fn(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  };

  oraFactory = vi.fn(() => ({
    ...spinner,
    start: vi.fn(() => spinner),
  }));

  return { default: oraFactory };
});

import { OutputRenderer } from '../../../src/ui/shell/OutputRenderer.js';

describe('OutputRenderer', () => {
  let renderer: OutputRenderer;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderer = new OutputRenderer();
    spinner.text = '';
    spinner.start.mockClear();
    spinner.stop.mockClear();
    spinner.succeed.mockClear();
    spinner.fail.mockClear();
    oraFactory.mockClear();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('reuses one spinner for concurrent tool calls', () => {
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_started',
      stepNumber: 1,
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-1', name: 'list-notes' },
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-2', name: 'list-team-notes' },
    });

    expect(oraFactory).toHaveBeenCalledTimes(1);
    expect(spinner.text).toContain('list-notes');
    expect(spinner.text).toContain('list-team-notes');
  });

  it('stops the spinner before rendering text chunks', () => {
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_started',
      stepNumber: 1,
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-1', name: 'list-notes' },
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'text_chunk',
      text: 'Hello world',
    });

    expect(spinner.stop).toHaveBeenCalledTimes(1);
    expect(stdoutWriteSpy).toHaveBeenCalled();
  });

  it('does not restart the spinner after text has started in the same step', () => {
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_started',
      stepNumber: 1,
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-1', name: 'list-notes' },
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'text_chunk',
      text: 'Answer so far',
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-2', name: 'list-team-notes' },
    });

    expect(oraFactory).toHaveBeenCalledTimes(1);
  });

  it('clears state on step completion so the next step can start a fresh spinner', () => {
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_started',
      stepNumber: 1,
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-1', name: 'list-notes' },
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_completed',
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_started',
      stepNumber: 2,
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-2', name: 'list-team-notes' },
    });

    expect(oraFactory).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('uses clean success text without duplicating checkmarks', () => {
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'step_started',
      stepNumber: 1,
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_call_started',
      toolCall: { id: 'tool-1', name: 'list-notes' },
    });
    (renderer as unknown as { render(message: unknown): void }).render({
      type: 'tool_completed',
      toolCallId: 'tool-1',
      result: { ok: true, output: '', brief: 'Completed' },
    });

    expect(spinner.succeed).toHaveBeenCalledTimes(1);
    expect(spinner.succeed.mock.calls[0][0]).toContain('list-notes completed');
    expect(spinner.succeed.mock.calls[0][0]).not.toContain('✓ ');
  });
});
