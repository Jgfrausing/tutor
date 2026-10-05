import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function start() {
  createRoot(document.getElementById("root")!).render(<App />);
}

if (document.readyState === "complete") start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
