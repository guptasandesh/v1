import { useState, useRef } from "react";

export default function UploadBox({ onUpload }) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const inputRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      alert("Please upload a CSV file.");
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleChange = (e) => {
    handleFile(e.target.files[0]);
  };

  const handleSubmit = () => {
    if (selectedFile) onUpload(selectedFile);
  };

  const handleRemove = () => {
    setSelectedFile(null);
    inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !selectedFile && inputRef.current.click()}
        className={`
          relative border-2 border-dashed rounded-2xl px-8 py-12 text-center transition-all duration-200
          ${selectedFile
            ? "border-indigo-300 bg-indigo-50 cursor-default"
            : dragging
              ? "border-indigo-500 bg-indigo-50 scale-[1.01] cursor-pointer"
              : "border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40 cursor-pointer"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleChange}
        />

        {!selectedFile ? (
          <div className="flex flex-col items-center gap-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${dragging ? "bg-indigo-100" : "bg-gray-100"}`}>
              <svg className={`w-8 h-8 transition-colors ${dragging ? "text-indigo-600" : "text-gray-400"}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-gray-700 font-semibold text-base">
                {dragging ? "Drop your file here" : "Drag & drop your CSV file"}
              </p>
              <p className="text-gray-400 text-sm mt-1">or click to browse</p>
            </div>
            <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">.csv files only</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-gray-900 font-semibold">{selectedFile.name}</p>
              <p className="text-gray-400 text-sm">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemove(); }}
              className="text-xs text-red-500 hover:text-red-700 underline"
            >
              Remove file
            </button>
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!selectedFile}
        className={`
          w-full py-3.5 rounded-xl font-semibold text-base transition-all duration-200
          ${selectedFile
            ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 hover:shadow-lg hover:shadow-indigo-200 active:scale-[0.99]"
            : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }
        `}
      >
        Analyze Inventory
      </button>
    </div>
  );
}
