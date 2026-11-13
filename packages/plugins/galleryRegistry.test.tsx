import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Theme } from "@radix-ui/themes";
import { pluginGalleries } from "./galleryRegistry.ts";

describe("plugin-owned static gallery", () => {
  it("mounts every registered specimen without network providers or fetch", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      render(
        <Theme>
          {pluginGalleries.flatMap((gallery) =>
            gallery.specimens.map(({ label, Component }) => (
              <section key={gallery.id + label}>
                <h2>{label}</h2>
                <Component />
              </section>
            ))
          )}
        </Theme>,
      );

      expect(screen.getByText(/Connected —/)).toBeInTheDocument();
      expect(screen.getByText(/telemetry is stale/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Testing…" })).toBeDisabled();
      expect(screen.getByText("Station selection")).toBeInTheDocument();
      expect(screen.getByText("Charger settings")).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
