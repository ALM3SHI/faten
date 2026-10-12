"use client";

/**
 * Last-resort screen when the root layout itself fails. It replaces the
 * whole document, so it can't rely on the app's CSS or fonts.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0f", color: "#f5f5f7", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>صار خطأ غير متوقع</h1>
          <p style={{ opacity: 0.75, lineHeight: 1.8, margin: "0 0 20px" }}>حدّث الصفحة، وإذا تكرر الخطأ جرّب بعد قليل.</p>
          <button
            type="button"
            onClick={reset}
            style={{ background: "#5b4be6", color: "#fff", border: 0, borderRadius: 12, padding: "12px 22px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}
          >
            حاول مرة ثانية
          </button>
        </div>
      </body>
    </html>
  );
}
