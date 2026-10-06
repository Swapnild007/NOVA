import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function Splash() {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLeaving(true), 1900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className={`splash ${leaving ? "splash--leave" : ""}`} aria-label="NOVA">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <section className="identity">
        <div className="core" aria-hidden="true">
          <div className="core__halo" />
          <div className="core__ring core__ring--outer" />
          <div className="core__ring core__ring--inner" />
          <div className="core__light" />
        </div>
        <div className="wordmark">NOVA</div>
        <div className="status"><span className="status__dot" />Ready when you are</div>
      </section>
      <div className="edge-glow" />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode><Splash /></StrictMode>
);