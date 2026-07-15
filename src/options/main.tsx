import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "../components/theme-provider";
import App from "./App";
import "../styles/globals.css";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
