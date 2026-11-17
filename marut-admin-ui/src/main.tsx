import React             from "react";
import ReactDOM          from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App }           from "./app/App";
import { AuthProvider }  from "./app/AuthContext";
import { ErrorBoundary } from "./components/feedback/ErrorBoundary";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);