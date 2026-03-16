import "@testing-library/jest-dom/vitest";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { TimezoneStep } from "./TimezoneStep.tsx";
import type { StepProps } from "../WizardShell.tsx";

const { mockMutate } = vi.hoisted(() => ({ mockMutate: vi.fn() }));

vi.mock("../../../trpc.ts", () => ({
  widenTrpc: vi.fn(),
  trpc: {
    useUtils: vi.fn(() => ({
      config: {
        system: { get: { invalidate: vi.fn() } },
      },
    })),
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
    },
    config: {
      system: {
        get: {
          useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
        },
        set: {
          useMutation: vi.fn(
            (_opts?: { onSuccess?: (...args: unknown[]) => void }) => {
              return {
                mutate: mockMutate,
                mutateAsync: vi.fn(),
                isPending: false,
                isSuccess: false,
                isError: false,
                error: null,
                data: undefined,
                reset: vi.fn(),
              };
            },
          ),
        },
      },
    },
  },
}));

// Radix Select uses ScrollArea which requires ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Radix Select calls scrollIntoView on focused items
Element.prototype.scrollIntoView = vi.fn();

const { originalSupportedValuesOf, originalDateTimeFormat, FAKE_DETECTED_TZ } =
  vi.hoisted(() => ({
    originalSupportedValuesOf: Intl.supportedValuesOf,
    originalDateTimeFormat: Intl.DateTimeFormat,
    // Pin auto-detected timezone so assertions are deterministic.
    FAKE_DETECTED_TZ: "Australia/Sydney",
  }));

// Intl.supportedValuesOf("timeZone") returns ~400+ entries. Radix Select
// renders them all into the DOM on open, which dominates test time. Stub
// with a short representative list (keeping Africa/Abidjan first).
(() => {
  const stubTimeZones = [
    "Africa/Abidjan",
    "Africa/Accra",
    "Africa/Cairo",
    "America/New_York",
    "America/Los_Angeles",
    "America/Chicago",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Kolkata",
    "Australia/Sydney",
    "Australia/Melbourne",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Pacific/Auckland",
    "UTC",
  ];
  Intl.supportedValuesOf = ((key: string) => {
    if (key === "timeZone") return stubTimeZones;
    return originalSupportedValuesOf(
      key as Parameters<typeof originalSupportedValuesOf>[0],
    );
  }) as typeof Intl.supportedValuesOf;

  // Stub DateTimeFormat so resolvedOptions().timeZone is deterministic.
  const StubDateTimeFormat = function (
    this: unknown,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    const inst = new originalDateTimeFormat(locales, options);
    const origResolved = inst.resolvedOptions.bind(inst);
    inst.resolvedOptions = () => ({
      ...origResolved(),
      timeZone: FAKE_DETECTED_TZ,
    });
    return inst;
  } as unknown as typeof Intl.DateTimeFormat;
  Object.assign(StubDateTimeFormat, originalDateTimeFormat);
  Intl.DateTimeFormat = StubDateTimeFormat;
})();

// ---- Tests ----

describe("TimezoneStep", () => {
  const makeStepProps = (overrides: Partial<StepProps> = {}): StepProps => ({
    onNext: vi.fn(),
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onSkipTo: vi.fn(),
    onSkipToEnd: vi.fn(),
    ...overrides,
  });

  afterAll(() => {
    Intl.supportedValuesOf = originalSupportedValuesOf;
    Intl.DateTimeFormat = originalDateTimeFormat;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("renders timezone dropdown with auto-detected value", () => {
    renderWithProviders(<TimezoneStep {...makeStepProps()} />);

    expect(screen.getByText(/Select your timezone/)).toBeInTheDocument();
    // The trigger should show the auto-detected timezone
    const trigger = screen.getByRole("combobox", { name: "Timezone" });
    expect(trigger).toBeInTheDocument();
    // Should show auto-detected message
    expect(screen.getByText(/Auto-detected from your browser/))
      .toBeInTheDocument();
  });

  // ---- User interactions ----

  it("dropdown contains IANA timezone options", async () => {
    renderWithProviders(<TimezoneStep {...makeStepProps()} />);

    // Open the select dropdown
    const trigger = screen.getByRole("combobox", { name: "Timezone" });
    fireEvent.click(trigger);

    await waitFor(() => {
      // Check for IANA timezone options — Africa/Abidjan is first alphabetically
      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(10);
      expect(screen.getByText("Africa/Abidjan")).toBeInTheDocument();
    });
  });

  it("selecting a timezone updates the selected value", async () => {
    renderWithProviders(<TimezoneStep {...makeStepProps()} />);

    const trigger = screen.getByRole("combobox", { name: "Timezone" });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText("Africa/Abidjan")).toBeInTheDocument();
    });

    // Stubbed detected zone is Australia/Sydney, so picking Africa/Abidjan
    // is guaranteed to change selection and remove the auto-detected hint.
    fireEvent.click(screen.getByText("Africa/Abidjan"));

    await waitFor(() => {
      expect(screen.queryByText(/Auto-detected from your browser/)).not
        .toBeInTheDocument();
    });
  });

  // ---- API calls ----

  it("clicking Next saves timezone to API", async () => {
    const onNext = vi.fn();
    renderWithProviders(<TimezoneStep {...makeStepProps({ onNext })} />);

    fireEvent.click(screen.getByRole("button", { name: /Save & Continue/ }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        { timezone: FAKE_DETECTED_TZ },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
