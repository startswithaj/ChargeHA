import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { KeyGenerationStep } from "./KeyGenerationStep.tsx";
import { StepNextHarness } from "../../../../client/src/components/Wizard/steps/test-helpers/StepNextHarness.tsx";
import { trpc } from "./trpc.ts";
import { makeStepProps } from "./test-helpers/stepProps.ts";

const mocks = vi.hoisted(() => ({
  generateMutate: vi.fn(),
  importMutate: vi.fn(),
  generateReset: vi.fn(),
  importReset: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    tesla: {
      getConfig: {
        useQuery: vi.fn(() => ({ data: {}, isLoading: false, error: null })),
      },
      generateKeys: {
        useMutation: vi.fn(() => ({
          mutate: mocks.generateMutate,
          isSuccess: false,
          isPending: false,
          error: null,
          reset: mocks.generateReset,
        })),
      },
      importKeys: {
        useMutation: vi.fn(() => ({
          mutate: mocks.importMutate,
          isSuccess: false,
          isPending: false,
          error: null,
          reset: mocks.importReset,
        })),
      },
    },
    health: {
      encryption: {
        useQuery: vi.fn(() => ({
          data: { configured: true },
          isLoading: false,
        })),
      },
    },
  },
}));

vi.mock("../../../../client/src/hooks/useConfig.ts", () => ({
  useConfig: vi.fn(() => ({
    config: {},
    isLoading: false,
  })),
}));

// ---- Tests ----

describe("KeyGenerationStep", () => {
  const TEST_PUBLIC_PEM =
    "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----";
  const TEST_PRIVATE_PEM =
    "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----";

  type MutationResult = {
    mutate: ReturnType<typeof vi.fn>;
    isSuccess: boolean;
    isPending: boolean;
    error: { message: string } | null;
    reset: ReturnType<typeof vi.fn>;
  };

  const defaultGenerate: MutationResult = {
    mutate: mocks.generateMutate,
    isSuccess: false,
    isPending: false,
    error: null,
    reset: mocks.generateReset,
  };

  const defaultImport: MutationResult = {
    mutate: mocks.importMutate,
    isSuccess: false,
    isPending: false,
    error: null,
    reset: mocks.importReset,
  };

  function setGenerateState(overrides: Partial<MutationResult>): void {
    vi.mocked(trpc.tesla.generateKeys.useMutation).mockReturnValue({
      ...defaultGenerate,
      ...overrides,
    } as never);
  }

  function setImportState(overrides: Partial<MutationResult>): void {
    vi.mocked(trpc.tesla.importKeys.useMutation).mockReturnValue({
      ...defaultImport,
      ...overrides,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setGenerateState({});
    setImportState({});
    vi.mocked(trpc.health.encryption.useQuery).mockReturnValue({
      data: { configured: true },
      isLoading: false,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  // ---- Initial render ----

  it("shows two option cards on initial render", () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    expect(screen.getByText("Generate a key pair for me")).toBeInTheDocument();
    expect(screen.getByText("I have my own key pair")).toBeInTheDocument();
  });

  it("shows encryption warning when ENCRYPTION_KEY is not set", () => {
    vi.mocked(trpc.health.encryption.useQuery).mockReturnValue({
      data: { configured: false },
      isLoading: false,
    } as never);

    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    expect(screen.getByText(/stored in plain text/)).toBeInTheDocument();
  });

  it("hides encryption warning when ENCRYPTION_KEY is set", () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    expect(screen.queryByText(/stored in plain text/)).not.toBeInTheDocument();
  });

  // ---- Generate flow ----

  it("calls generateKeys mutation when Generate option is clicked", async () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("Generate a key pair for me"));

    await waitFor(() => {
      expect(mocks.generateMutate).toHaveBeenCalledTimes(1);
    });
  });

  it("shows spinner during generate API call", async () => {
    setGenerateState({ isPending: true });

    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("Generate a key pair for me"));

    await waitFor(() => {
      expect(screen.getByText("Generating EC key pair...")).toBeInTheDocument();
    });
  });

  // ---- Generate/import success ----
  // NOTE: success copy is mode-conditional ("generated" vs "imported"); the
  // generate path requires entering generate mode (via click) before the
  // SuccessView renders the right text.

  it("shows success message after generation", async () => {
    // Render with default state so ChooseModeCards is visible, then click
    // Generate to set mode="generate"; switching the mock to isSuccess
    // mid-flow drives the re-render into SuccessView with the right mode.
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    setGenerateState({ isSuccess: true });

    fireEvent.click(screen.getByText("Generate a key pair for me"));

    await waitFor(() => {
      expect(
        screen.getByText(/generated and stored successfully/),
      ).toBeInTheDocument();
    });
  });

  it("shows success after successful import", () => {
    setImportState({ isSuccess: true });

    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    expect(
      screen.getByText(/imported and stored successfully/),
    ).toBeInTheDocument();
  });

  it.each(
    [
      [
        "generate",
        setGenerateState,
        "Key generation failed",
        /Key generation failed/,
      ],
      [
        "import",
        setImportState,
        "Invalid public key: must be PEM-encoded (BEGIN PUBLIC KEY)",
        /Invalid public key/,
      ],
    ] as const,
  )(
    "shows error when %s fails",
    (_flow, setter, errorMsg, expected) => {
      setter({ error: { message: errorMsg } });

      renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

      expect(screen.getByText(expected)).toBeInTheDocument();
    },
  );

  it("Try Again button from error resets mutations", () => {
    setGenerateState({ error: { message: "Key generation failed" } });

    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    expect(screen.getByText("Key generation failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try Again/ }));

    expect(mocks.generateReset).toHaveBeenCalled();
  });

  it("enables Next after successful generation", () => {
    const onNext = vi.fn();
    setGenerateState({ isSuccess: true });

    renderWithProviders(
      <StepNextHarness onAdvance={onNext}>
        <KeyGenerationStep {...makeStepProps({ onNext })} />
      </StepNextHarness>,
    );

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  // ---- Import flow ----

  it("shows import form when 'I have my own key pair' is clicked", () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("I have my own key pair"));

    expect(screen.getByText("Public Key (PEM)")).toBeInTheDocument();
    expect(screen.getByText("Private Key (PEM)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Keys/ }))
      .toBeInTheDocument();
  });

  it("disables Save Keys button when textareas are empty", () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("I have my own key pair"));

    expect(screen.getByRole("button", { name: /Save Keys/ })).toBeDisabled();
  });

  it("calls importKeys mutation with PEM values", async () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("I have my own key pair"));

    const textareas = screen.getAllByRole("textbox");
    fireEvent.change(textareas[0], { target: { value: TEST_PUBLIC_PEM } });
    fireEvent.change(textareas[1], { target: { value: TEST_PRIVATE_PEM } });

    fireEvent.click(screen.getByRole("button", { name: /Save Keys/ }));

    await waitFor(() => {
      expect(mocks.importMutate).toHaveBeenCalledWith({
        publicKeyPem: TEST_PUBLIC_PEM,
        privateKeyPem: TEST_PRIVATE_PEM,
      });
    });
  });

  it("Back button from import returns to choose mode", () => {
    renderWithProviders(<KeyGenerationStep {...makeStepProps()} />);

    fireEvent.click(screen.getByText("I have my own key pair"));
    expect(screen.getByText("Public Key (PEM)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Generate a key pair for me")).toBeInTheDocument();
  });
});
