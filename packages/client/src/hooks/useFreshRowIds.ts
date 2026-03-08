import { useEffect, useRef, useState } from "react";

/** Returns IDs that appeared in `items` since the previous call, then clears
 *  each one after `flashMs`. Skips the initial mount so all rows aren't
 *  flagged on first render. */
export function useFreshRowIds<Id extends string | number>(
  items: { id: Id }[],
  flashMs: number = 1500,
): Set<Id> {
  const prevIdsRef = useRef<Set<Id> | null>(null);
  const [fresh, setFresh] = useState<Set<Id>>(new Set());

  useEffect(() => {
    const currentIds = new Set(items.map((i) => i.id));

    if (prevIdsRef.current === null) {
      prevIdsRef.current = currentIds;
      return;
    }

    const prevIds = prevIdsRef.current;
    const newIds = [...currentIds].filter((id) => !prevIds.has(id));
    prevIdsRef.current = currentIds;

    if (newIds.length === 0) return;

    setFresh((prev) => new Set([...prev, ...newIds]));

    const timer = setTimeout(() => {
      setFresh((prev) =>
        new Set([...prev].filter((id) => !newIds.includes(id)))
      );
    }, flashMs);
    return () => clearTimeout(timer);
  }, [items, flashMs]);

  return fresh;
}
