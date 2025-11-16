import React from "react";
import ReactDOM from "react-dom/client";

const App: React.FC = () => {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#020617",
        color: "#e5e7eb",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "640px", width: "100%" }}>
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontSize: "28px", fontWeight: 700 }}>Verum Omnis</div>
        </div>

        <h1
          style={{
            fontSize: "24px",
            fontWeight: 700,
            marginBottom: "16px",
          }}
        >
          Ready for Analysis
        </h1>

        <p style={{ marginBottom: "24px", lineHeight: 1.5 }}>
          Please provide the document or evidence file you wish to analyze. Your
          data is processed securely in your browser and is never uploaded to a
          server.
        </p>

        <div
          style={{
            border: "1px dashed #4b5563",
            borderRadius: "12px",
            padding: "32px",
            textAlign: "center",
            marginBottom: "24px",
          }}
        >
          <button
            style={{
              padding: "12px 24px",
              borderRadius: "999px",
              fontWeight: 600,
              border: "none",
              background: "#2563eb",
              color: "#f9fafb",
              cursor: "pointer",
              marginBottom: "12px",
            }}
          >
            Click to upload evidence
          </button>

          <div style={{ fontSize: "12px", color: "#9ca3af" }}>
            or drag and drop
          </div>

          <div
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              marginTop: "8px",
            }}
          >
            Supports PDF, DOCX, TXT, PNG, JPG, and other common document
            formats.
          </div>

          <input
            type="file"
            multiple
            style={{ marginTop: "16px", fontSize: "12px" }}
          />
        </div>

        <p
          style={{
            fontSize: "12px",
            color: "#9ca3af",
            marginBottom: "6px",
          }}
        >
          <strong>100% Stateless &amp; On-Device:</strong> No server, no
          storage, no central authority. Your data is processed entirely in your
          browser.
        </p>

        <p style={{ fontSize: "12px", color: "#9ca3af" }}>
          <strong>A New Category of Legal Tech:</strong> Gain clarity,
          protection, and justice without needing an institution to interpret
          the facts.
        </p>
      </div>
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
