import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("Error de interfaz:", error); }
  render() {
    if (this.state.failed) return <div className="startup"><h1>No se pudo mostrar la interfaz.</h1><p>Tu tracking confirmado sigue guardado localmente.</p><button onClick={() => location.reload()}>Volver a cargar</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);
