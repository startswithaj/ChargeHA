import "@testing-library/jest-dom/vitest";
import { assertExists } from "@std/assert";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithProviders } from "../../test-utils.tsx";
import { StaticMap } from "./StaticMap.tsx";

describe("StaticMap", () => {
  afterEach(cleanup);

  /** Find the StaticMap root div by navigating up from a tile image. */
  const findMapRoot = (container: HTMLElement): HTMLElement => {
    const img = container.querySelector("img");
    // Walk up from <img> → grid div → filter div → map root div
    assertExists(img);
    assertExists(img.parentElement);
    assertExists(img.parentElement.parentElement);
    assertExists(img.parentElement.parentElement.parentElement);
    return img.parentElement.parentElement.parentElement as HTMLElement;
  };

  const defaultProps = {
    latitude: -33.8688,
    longitude: 151.2093,
    size: 200,
  };

  // ---- rendering ----

  describe("rendering", () => {
    it("renders map container", () => {
      const { container } = renderWithProviders(
        <StaticMap {...defaultProps} />,
      );

      const wrapper = findMapRoot(container);
      expect(wrapper).toBeInTheDocument();
      expect(wrapper.tagName).toBe("DIV");
    });

    it("renders with given coordinates as tile URLs", () => {
      const { container } = renderWithProviders(
        <StaticMap latitude={-33.8688} longitude={151.2093} size={200} />,
      );

      const images = container.querySelectorAll("img");
      // 5 cols x 3 rows = 15 tile images
      expect(images.length).toBe(15);
      // Each tile points to openstreetmap.org
      const firstSrc = images[0].getAttribute("src") ?? "";
      expect(firstSrc).toContain("tile.openstreetmap.org");
    });

    it("renders pin element", () => {
      const { container } = renderWithProviders(
        <StaticMap {...defaultProps} />,
      );

      const allDivs = container.querySelectorAll("div");
      const pinDiv = Array.from(allDivs).find(
        (div) => div.style.borderRadius === "50%",
      );
      expect(pinDiv).toBeTruthy();
    });
  });

  // ---- sized variant ----

  describe("sized variant (size prop)", () => {
    it("applies fixed width and height from size prop", () => {
      const { container } = renderWithProviders(
        <StaticMap latitude={0} longitude={0} size={150} />,
      );

      const wrapper = findMapRoot(container);
      expect(wrapper.style.width).toBe("150px");
      expect(wrapper.style.height).toBe("150px");
      expect(wrapper.style.position).toBe("relative");
    });

    it("applies width and height from explicit width/height props", () => {
      const { container } = renderWithProviders(
        <StaticMap latitude={0} longitude={0} width={300} height={200} />,
      );

      const wrapper = findMapRoot(container);
      expect(wrapper.style.width).toBe("300px");
      expect(wrapper.style.height).toBe("200px");
    });

    it("renders small pin (8px) for sized variant", () => {
      const { container } = renderWithProviders(
        <StaticMap latitude={0} longitude={0} size={100} />,
      );

      const allDivs = container.querySelectorAll("div");
      const pinDiv = Array.from(allDivs).find(
        (div) => div.style.borderRadius === "50%",
      );
      assertExists(pinDiv);
      expect(pinDiv.style.width).toBe("8px");
      expect(pinDiv.style.height).toBe("8px");
    });
  });

  // ---- non-sized variant ----

  describe("non-sized variant (no size/width/height props)", () => {
    it("uses absolute positioning for the wrapper", () => {
      const { container } = renderWithProviders(
        <StaticMap latitude={0} longitude={0} />,
      );

      const wrapper = findMapRoot(container);
      expect(wrapper.style.position).toBe("absolute");
      expect(wrapper.style.inset).toBe("0");
      expect(wrapper.style.overflow).toBe("hidden");
      expect(wrapper.style.pointerEvents).toBe("none");
    });

    it("renders large pin (14px) for non-sized variant", () => {
      const { container } = renderWithProviders(
        <StaticMap latitude={0} longitude={0} />,
      );

      const allDivs = container.querySelectorAll("div");
      const pinDiv = Array.from(allDivs).find(
        (div) => div.style.borderRadius === "50%",
      );
      assertExists(pinDiv);
      expect(pinDiv.style.width).toBe("14px");
      expect(pinDiv.style.height).toBe("14px");
    });
  });
});
