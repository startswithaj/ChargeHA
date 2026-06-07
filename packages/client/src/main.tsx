import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./styles/global.css";
import "./styles/animations.css";
import { App } from "./App.tsx";

const isDemoBuild = import.meta.env.VITE_DEMO_MODE === "1";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing root element");

const render = () =>
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

// Demo mode talks to no server: build in-browser state + start the realtime
// tick before first render. Dynamically imported so the demo engine (and the
// simulation) only ships/loads in the demo build.
const startDemo = async () => {
  const [{ initDemoState }, { startDemoTick }] = await Promise.all([
    import("./lib/demo/demoState.ts"),
    import("./lib/demo/demoTick.ts"),
  ]);
  await initDemoState();
  startDemoTick();
  render();
};

const startMain = () => render();

if (isDemoBuild) startDemo();
else startMain();
