import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";

vi.mock("../../hooks/useConnectionStatus.ts", () => ({
  useConnectionStatus: vi.fn(),
}));

import { ConnectionBadge } from "./ConnectionBadge.tsx";
import {
  type ConnectionStatus,
  useConnectionStatus,
} from "../../hooks/useConnectionStatus.ts";

describe("ConnectionBadge", () => {
  const mockUseConnectionStatus = vi.mocked(useConnectionStatus);

  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  it.each<[ConnectionStatus, string]>([
    ["connected", "LIVE"],
    ["connecting", "CONNECTING"],
    ["disconnected", "OFFLINE"],
  ])("renders %s as %s", (status, label) => {
    mockUseConnectionStatus.mockReturnValue(status);

    renderWithProviders(<ConnectionBadge />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
