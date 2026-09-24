import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../../client/src/test-utils.tsx";
import { TeslaChargerFields } from "./TeslaChargerFields.tsx";

const mocks = vi.hoisted(() => ({
  getConfigUseQuery: vi.fn(),
  setConfigMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("./trpc.ts", () => ({
  trpc: {
    useUtils: () => ({
      plugin: {
        vehicle: {
          tesla: { charger: { getConfig: { invalidate: mocks.invalidate } } },
        },
      },
    }),
    plugin: {
      vehicle: {
        tesla: {
          charger: {
            getConfig: {
              useQuery: (...args: unknown[]) =>
                mocks.getConfigUseQuery(...args),
            },
            setConfig: {
              useMutation: () => ({
                mutate: mocks.setConfigMutate,
                isPending: false,
                error: null,
              }),
            },
          },
        },
      },
    },
  },
}));

describe("TeslaChargerFields", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders nothing until the config arrives", () => {
    mocks.getConfigUseQuery.mockReturnValue({ data: undefined });
    renderWithProviders(<TeslaChargerFields vin="VIN123" />);
    expect(screen.queryByText("Min amps")).not.toBeInTheDocument();
  });

  it("shows the stored minimum for this vehicle's charging point", () => {
    mocks.getConfigUseQuery.mockReturnValue({ data: { teslaMinAmps: "2" } });
    renderWithProviders(<TeslaChargerFields vin="VIN123" />);
    expect(screen.getByText("2A")).toBeInTheDocument();
    expect(mocks.getConfigUseQuery).toHaveBeenCalledWith({
      chargerRowId: "cp-VIN123",
    });
  });
});
