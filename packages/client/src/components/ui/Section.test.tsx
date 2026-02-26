import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./Section.module.css", () => ({
  default: {
    savedCard: "savedCard",
    errorCard: "errorCard",
    wrapper: "wrapper",
    header: "header",
    icon: "icon",
    action: "action",
    savedBadge: "savedBadge",
    body: "body",
  },
}));

import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { Section } from "./Section.tsx";
import type { SectionProps } from "./Section.tsx";

describe("Section", () => {
  beforeEach(vi.clearAllMocks);
  afterEach(cleanup);

  const defaultProps: SectionProps = {
    icon: <span data-testid="icon">🔌</span>,
    title: "Test Section",
    description: "A description",
    children: <div data-testid="children">Content</div>,
  };

  const renderSection = (overrides?: Partial<SectionProps>) =>
    renderWithProviders(<Section {...defaultProps} {...overrides} />);

  it("renders title, description, icon, and children", () => {
    renderSection();
    expect(screen.getByText("Test Section")).toBeInTheDocument();
    expect(screen.getByText("A description")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByTestId("children")).toBeInTheDocument();
  });

  it("renders badge when provided", () => {
    renderSection({ badge: "Beta" });
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders action when provided", () => {
    renderSection({
      action: <button type="button" data-testid="action-btn">Do Thing</button>,
    });
    expect(screen.getByTestId("action-btn")).toBeInTheDocument();
  });

  it("shows Saved badge when saveStatus is saved", () => {
    renderSection({ saveStatus: { state: "saved", tick: 1 } });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows Saving... badge when saveStatus is saving", () => {
    renderSection({ saveStatus: { state: "saving", tick: 1 } });
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("shows error message when saveStatus is error", () => {
    renderSection({
      saveStatus: { state: "error", message: "Save failed", tick: 1 },
    });
    expect(screen.getByText("Save failed")).toBeInTheDocument();
  });

  it("does not show Saved badge when saveStatus is idle", () => {
    renderSection({ saveStatus: { state: "idle", tick: 0 } });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });

  it("does not show status badges when saveStatus is not provided", () => {
    renderSection();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });

  it("renders with both badge and saveStatus saved", () => {
    renderSection({
      badge: "Beta",
      saveStatus: { state: "saved", tick: 2 },
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
