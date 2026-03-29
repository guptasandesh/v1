import { useState } from "react";
import UploadBox from "./components/UploadBox";
import ColumnMapper from "./components/ColumnMapper";
import ResultsDashboard from "./components/ResultsDashboard";

const API = process.env.REACT_APP_API_URL || "https://v1-sq2v.onrender.com";

// step: "upload" | "mapping" | "results"
export default function App() {
  const [step, setStep] = useState("upload");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [previewData, setPreviewData] = useState(null); // { filename, headers, row_count, preview }
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Upload → call /preview to get headers
  const handleUpload = async (file) => {
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/preview`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Something went wrong.");
        return;
      }
      setUploadedFile(file);
      setPreviewData(data);
      setStep("mapping");
    } catch {
      setError("Could not reach the server. Make sure the backend is running on port 8090.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Column mapping confirmed → call /analyze
  const handleAnalyze = async (mapping) => {
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("mapping", JSON.stringify(mapping));

    try {
      const res = await fetch(`${API}/analyze`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Analysis failed.");
        setStep("mapping");
        return;
      }
      setResults(data);
      setStep("results");
    } catch {
      setError("Could not reach the server.");
      setStep("mapping");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setUploadedFile(null);
    setPreviewData(null);
    setResults(null);
    setError(null);
  };

  const handleBackToMapping = () => {
    setStep("mapping");
    setResults(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <span className="font-bold text-gray-900 text-lg tracking-tight">InvCheck</span>
          </div>

          {step !== "upload" && (
            <button
              onClick={handleReset}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload new file
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* ── Step 1: Upload ── */}
        {step === "upload" && !loading && (
          <div className="flex flex-col items-center">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6 border border-indigo-100">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                Works with any CSV format
              </div>
              <h1 className="text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-4">
                Detect Inventory Errors<br />
                <span className="text-indigo-600">in Seconds</span>
              </h1>
              <p className="text-gray-500 text-xl max-w-xl mx-auto leading-relaxed">
                Upload any inventory CSV — we'll help you map your columns and
                instantly surface duplicates, bad data, and outliers.
              </p>
            </div>

            <div className="w-full max-w-2xl">
              <UploadBox onUpload={handleUpload} />
            </div>

            {error && (
              <div className="mt-6 w-full max-w-2xl bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 text-sm flex gap-3">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl">
              {[
                { icon: "❌", label: "Duplicate Detection" },
                { icon: "⚠️", label: "Missing Values" },
                { icon: "🚫", label: "Invalid Quantities" },
                { icon: "📊", label: "Outlier Flagging" },
              ].map((f) => (
                <div key={f.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center shadow-sm">
                  <div className="text-2xl mb-1">{f.icon}</div>
                  <div className="text-xs text-gray-600 font-medium">{f.label}</div>
                </div>
              ))}
            </div>

            <p className="mt-8 text-xs text-gray-400 text-center">
              Any column names work — you'll map them in the next step.
            </p>
          </div>
        )}

        {/* ── Loading spinner ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-6">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-100"></div>
              <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"></div>
            </div>
            <div className="text-center">
              <p className="text-gray-900 font-semibold text-lg">
                {step === "upload" ? "Reading your file…" : "Analyzing inventory…"}
              </p>
              <p className="text-gray-400 text-sm mt-1">
                {step === "upload" ? "Extracting columns" : "Running all error checks"}
              </p>
            </div>
          </div>
        )}

        {/* ── Step 2: Column Mapping ── */}
        {step === "mapping" && !loading && previewData && (
          <>
            {error && (
              <div className="max-w-2xl mx-auto mb-6 bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 text-sm flex gap-3">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}
            <ColumnMapper
              filename={previewData.filename}
              headers={previewData.headers}
              rowCount={previewData.row_count}
              preview={previewData.preview}
              onAnalyze={handleAnalyze}
              onBack={handleReset}
            />
          </>
        )}

        {/* ── Step 3: Results ── */}
        {step === "results" && results && !loading && (
          <ResultsDashboard data={results} onBack={handleBackToMapping} />
        )}
      </main>

      <footer className="text-center py-8 text-xs text-gray-400 mt-4">
        InvCheck — Inventory Error Detection Engine
      </footer>
    </div>
  );
}
