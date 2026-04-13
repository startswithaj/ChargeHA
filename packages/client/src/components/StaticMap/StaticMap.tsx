// ── Tile math for OpenStreetMap ──

function latLngToTileFloat(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

interface StaticMapProps {
  latitude: number;
  longitude: number;
  /** Diameter in pixels (used for square variant). When set, renders as width=height=size. */
  size?: number;
  /** Explicit width (overrides size). */
  width?: number;
  /** Explicit height (overrides size). */
  height?: number;
}

export function StaticMap(
  { latitude, longitude, size, width, height }: StaticMapProps,
) {
  const zoom = 14;
  const { x, y } = latLngToTileFloat(latitude, longitude, zoom);
  // Pixel offset within the center tile so the pin lands at center
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const fracX = x - tileX;
  const fracY = y - tileY;
  const cols = 5;
  const rows = 3;
  const startX = tileX - 2;
  const startY = tileY - 1;
  // Shift so the exact lat/lng point lands at the container center
  const offsetX = (0.5 - fracX) * 256;
  const offsetY = (0.5 - fracY) * 256;

  const isSized = size !== undefined || width !== undefined;
  const w = width ?? size;
  const h = height ?? size;

  const wrapperStyle: React.CSSProperties = (() => {
    if (isSized) {
      return {
        width: w,
        height: h,
        borderRadius: "inherit",
        overflow: "hidden",
        position: "relative",
      };
    }
    return {
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      borderRadius: "inherit",
      pointerEvents: "none",
    };
  })();

  return (
    <div style={wrapperStyle}>
      {/* Tile layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: "grayscale(1) opacity(0.4)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 256px)`,
            gridTemplateRows: `repeat(${rows}, 256px)`,
            position: "absolute",
            top: "50%",
            left: "50%",
            transform:
              `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`,
          }}
        >
          {Array.from({ length: rows }, (_, row) =>
            Array.from({ length: cols }, (_, col) => (
              <img
                key={`${row}-${col}`}
                src={`https://tile.openstreetmap.org/${zoom}/${startX + col}/${
                  startY + row
                }.png`}
                alt=""
                width={256}
                height={256}
                style={{ display: "block" }}
              />
            )))}
        </div>
      </div>
      {/* Location dot — always centered since the tiles are shifted to place the pin at center */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: isSized ? 8 : 14,
          height: isSized ? 8 : 14,
          borderRadius: "50%",
          background: "var(--accent-9)",
          border: isSized ? "1.5px solid white" : "2.5px solid white",
          boxShadow: isSized
            ? "0 0 0 1px var(--accent-9)"
            : "0 0 0 1px var(--accent-9), 0 2px 8px rgba(0,0,0,0.3)",
          zIndex: 1,
        }}
      />
    </div>
  );
}
