import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils.tsx";
import { OptionCard } from "./OptionCard.tsx";

describe("OptionCard", () => {
  const renderCard = (
    { selected, onSelect }: { selected: boolean; onSelect: () => void },
  ) => {
    renderWithProviders(
      <OptionCard
        icon={null}
        title="No authentication"
        description="Anyone on the network can use ChargeHA"
        selected={selected}
        onSelect={onSelect}
      />,
    );
    return screen.getByRole("button", { name: /No authentication/ });
  };

  afterEach(() => {
    cleanup();
  });

  it("Enter selects an unselected card and claims the key", () => {
    const onSelect = vi.fn();
    const card = renderCard({ selected: false, onSelect });

    // fireEvent returns false when the handler called preventDefault — that is
    // how the wizard's Enter-advances listener knows to stay out of the way.
    const notPrevented = fireEvent.keyDown(card, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("Enter on the already-selected card is left for the wizard", () => {
    const onSelect = vi.fn();
    const card = renderCard({ selected: true, onSelect });

    const notPrevented = fireEvent.keyDown(card, { key: "Enter" });

    // Clicking a card leaves focus on it; re-selecting would do nothing, so
    // the key travels on to Next instead.
    expect(onSelect).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it("Space selects even when the card is already selected", () => {
    const onSelect = vi.fn();
    const card = renderCard({ selected: true, onSelect });

    const notPrevented = fireEvent.keyDown(card, { key: " " });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it("a disabled card selects on neither key", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <OptionCard
        icon={null}
        title="Tesla"
        description="Needs an account"
        disabled
        onSelect={onSelect}
      />,
    );

    const card = screen.getByRole("button", { name: /Tesla/ });
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });

    expect(onSelect).not.toHaveBeenCalled();
  });
});
