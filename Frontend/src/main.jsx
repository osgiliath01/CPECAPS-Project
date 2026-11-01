// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { startTableLabels } from "./utils/tableLabels";

// Phones show tables as cards; this gives each cell its column name (see App.css, "Phones")
startTableLabels();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);