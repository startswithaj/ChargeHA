import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import { Text } from "@radix-ui/themes";
import {
  type Toast as ToastData,
  type ToastType,
  useToast,
} from "../../hooks/useToast.tsx";
import styles from "./Toast.module.css";

const ICONS: Record<ToastType, typeof AlertCircle> = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  error: "var(--color-grid-import)",
  success: "var(--color-charging)",
  info: "var(--color-vehicle)",
};

function ToastItem(
  { toast, onDismiss }: { toast: ToastData; onDismiss: () => void },
) {
  const Icon = ICONS[toast.type];
  const color = COLORS[toast.type];

  return (
    <div className={styles.toast} data-type={toast.type}>
      <Icon size={18} style={{ color, flexShrink: 0 }} />
      <Text size="2" className={styles.message}>{toast.message}</Text>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => removeToast(t.id)}
        />
      ))}
    </div>
  );
}
