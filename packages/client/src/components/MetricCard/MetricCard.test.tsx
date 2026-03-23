import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { MetricCard } from "./MetricCard.tsx";

describe("MetricCard", () => {
  afterEach(cleanup);
  const defaultProps = {
    icon: <span data-testid="test-icon">icon</span>,
    label: "Solar Production",
    value: "5.2 kW",
    accentColor: "var(--color-solar)",
  };

  describe("rendering", () => {
    it.each<[string, () => HTMLElement]>([
      ["label", () => screen.getByText("Solar Production")],
      ["value", () => screen.getByText("5.2 kW")],
      ["icon", () => screen.getByTestId("test-icon")],
    ])("renders the %s", (_name, locate) => {
      renderWithProviders(<MetricCard {...defaultProps} />);

      expect(locate()).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("does not render the value when loading", () => {
      renderWithProviders(<MetricCard {...defaultProps} loading />);

      expect(screen.queryByText("5.2 kW")).not.toBeInTheDocument();
    });

    it("renders the label even when loading", () => {
      renderWithProviders(<MetricCard {...defaultProps} loading />);

      expect(screen.getByText("Solar Production")).toBeInTheDocument();
    });
  });

  describe("subtitle", () => {
    it("renders subtitle when provided", () => {
      renderWithProviders(
        <MetricCard {...defaultProps} subtitle="Updated 5s ago" />,
      );

      expect(screen.getByText("Updated 5s ago")).toBeInTheDocument();
    });

    it("does not render subtitle when omitted", () => {
      renderWithProviders(<MetricCard {...defaultProps} />);

      expect(screen.queryByText("Updated 5s ago")).not.toBeInTheDocument();
    });
  });
});
