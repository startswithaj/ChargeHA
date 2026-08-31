import { Callout } from "@radix-ui/themes";
import { AlertTriangle } from "lucide-react";

// Callout padding and text scale together, so the icon moves with them.
const ICON_SIZE: Record<"1" | "2", number> = { "1": 14, "2": 16 };

interface FormErrorProps {
  /** Null or empty renders nothing, so call sites drop their `{error && …}`. */
  message: string | null | undefined;
  /** "1" in settings panels and row editors, "2" on wizard steps and login. */
  size?: "1" | "2";
}

/** The one in-form error. Colour alone is not a state, hence the icon and
 *  role="alert". For a whole-panel failure use ErrorBanner above the Section. */
export function FormError({ message, size = "1" }: FormErrorProps) {
  if (!message) return null;
  return (
    <Callout.Root color="red" size={size} role="alert">
      <Callout.Icon>
        <AlertTriangle size={ICON_SIZE[size]} />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}
