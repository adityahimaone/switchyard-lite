import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./styles.css";

const stored = localStorage.getItem("switchyard.dark");
if (stored === "1" || (stored === null && matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
}
const savedPalette = localStorage.getItem("switchyard.palette");
if (savedPalette) {
  document.documentElement.setAttribute("data-theme-palette", savedPalette);
}
const savedDensity = localStorage.getItem("switchyard.density");
if (savedDensity === "compact") {
  document.documentElement.setAttribute("data-density", "compact");
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
