import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preventFileNavigation } from "./hooks/useFileDrop";
import "./styles.css";

// A file dropped outside a drop zone must never replace the app with the file.
preventFileNavigation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
