import { Theme } from "@radix-ui/themes";
import { ToastProvider } from "./hooks/useToast.tsx";
function AppContent() {
  return (
    <Theme appearance={appearance}>
      <ToastProvider>
      </ToastProvider>
    </Theme>
  );
}
export function App() {
  return (
        <AppContent />
  );
}
