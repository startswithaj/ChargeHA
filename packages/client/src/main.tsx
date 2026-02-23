import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./styles/global.css";
import "./styles/animations.css";
import { App } from "./App.tsx";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing root element");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
