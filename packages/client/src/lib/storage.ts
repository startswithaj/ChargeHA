import { useCallback, useState } from "react";

const PREFIX = "chargeha-";

export function getStored<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export function setStored<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export function removeStored(key: string): void {
  localStorage.removeItem(PREFIX + key);
}

/** useState backed by localStorage. Initializes from storage, persists on set.
 *  Returns [value, setValue, reset]. reset() removes from storage and
 *  reverts to the fallback. */
export function useStoredState<T>(
  key: string,
  fallback: T,
): [T, (value: T) => void, () => void] {
  const [value, setValue] = useState(() => getStored(key, fallback));

  const setAndPersist = useCallback(
    (v: T) => {
      setValue(v);
      setStored(key, v);
    },
    [key],
  );

  const reset = useCallback(() => {
    removeStored(key);
    setValue(fallback);
  }, [key, fallback]);

  return [value, setAndPersist, reset];
}
