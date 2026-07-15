import { vi } from "vitest";
import type { StepProps } from "../../../../hostUi.ts";

export function makeStepProps(
  overrides: Partial<StepProps> = {},
): StepProps {
  return {
    onNext: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  };
}
