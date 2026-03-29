import { useState, useEffect } from "react";

// Keywords that suggest each standard field
const FIELD_HINTS = {
  item_id: ["id", "sku", "code", "product_id", "item_id", "itemid", "product_code",
            "part_no", "part_number", "barcode", "upc", "ref", "reference", "article"],
  item_name: ["name", "product_name", "item_name", "description", "title", "product",
              "desc", "label", "product_desc", "item_desc", "goods"],
  quantity: ["qty", "quantity", "stock", "count", "inventory", "amount", "stock_qty",
             "qty_available", "on_hand", "units", "available", "total"],
  location: ["location", "warehouse", "loc", "site", "store", "place", "region",
             "area", "bin", "shelf", "zone"],
};

const FIELDS = [
  {
    key: "item_id",
    label: "Item ID",
    description: "Unique identifier for each product (e.g. SKU, product code)",
    required: true,
  },
  {
    key: "item_name",
    label: "Item Name",
    description: "Human-readable product name or description",
    required: true,
  },
  {
    key: "quantity",
    label: "Quantity",
    description: "Stock count or available units (numeric)",
    required: true,
  },
  {
    key: "location",
    label: "Location",
    description: "Warehouse, store, or bin location",
    required: false,
  },
];

// Auto-suggest: find the best matching header for a given field
function autoSuggest(field, headers) {
  const hints = FIELD_HINTS[field] || [];
  for (const header of headers) {
    const lower = header.toLowerCase().replace(/[\s\-]/g, "_");
    if (hints.some((hint) => lower.includes(hint))) {
      return header;
    }
  }
  return "";
}

export default function ColumnMapper({ filename, headers, rowCount, preview, onAnalyze, onBack }) {
  const [mapping, setMapping] = useState({});
  const [showPreview, setShowPreview] = useState(false);

  // Run auto-suggest on mount
  useEffect(() => {
    const suggested = {};
    for (const field of FIELDS) {
      const match = autoSuggest(field.key, headers);
      if (match) suggested[field.key] = match;
    }
    setMapping(suggested);
  }, [headers]);

  const requiredFields = FIELDS.filter((f) => f.required);
  const allRequiredMapped = requiredFields.every((f) => mapping[f.key]);

  // Count how many were auto-suggested
  const autoCount = FIELDS.filter((f) => mapping[f.key]).length;

  const handleChange = (fieldKey, value) => {
    setMapping((prev) => ({ ...prev, [fieldKey]: value || undefined }));
  };

  const handleAnalyze = () => {
    const finalMapping = {};
    for (const f of FIELDS) {
      if (mapping[f.key]) finalMapping[f.key] = mapping[f.key];
    }
    onAnalyze(finalMapping);
  };

  // Columns already assigned to other fields (prevent double-mapping)
  const usedColumns = (fieldKey) =>
    Object.entries(mapping)
      .filter(([k, v]) => k !== fieldKey && v)
      .map(([, v]) => v);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">1</span>
              Upload
            </span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="flex items-center gap-1.5 text-indigo-600">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">2</span>
              Map Columns
            </span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="flex items-center gap-1.5 text-gray-300">
              <span className="w-5 h-5 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-xs font-bold">3</span>
              Results
            </span>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900">Map Your Columns</h2>
        <p className="text-gray-500 text-sm mt-1">
          We found <span className="font-medium text-gray-700">{headers.length} columns</span> and{" "}
          <span className="font-medium text-gray-700">{rowCount.toLocaleString()} rows</span> in{" "}
          <span className="font-medium text-gray-700">{filename}</span>.
          Match them to the required fields below.
        </p>
      </div>

      {/* Auto-suggest notice */}
      {autoCount > 0 && (
        <div className="mb-5 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 flex items-start gap-3">
          <svg className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-sm text-indigo-700">
            <span className="font-semibold">Auto-detected {autoCount} column{autoCount > 1 ? "s" : ""}.</span>{" "}
            Review the suggestions below and adjust if needed.
          </p>
        </div>
      )}

      {/* Mapping card */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Required Fields</span>
          <span className="text-xs text-gray-400">{headers.length} columns available</span>
        </div>

        <div className="divide-y divide-gray-100">
          {FIELDS.map((field) => {
            const value = mapping[field.key] || "";
            const isMissing = field.required && !value;
            const used = usedColumns(field.key);

            return (
              <div key={field.key} className={`px-6 py-5 flex items-center gap-4 ${isMissing ? "bg-red-50/40" : ""}`}>
                {/* Field info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-gray-800 text-sm">{field.label}</span>
                    {field.required ? (
                      <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">Required</span>
                    ) : (
                      <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">Optional</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{field.description}</p>
                </div>

                {/* Arrow */}
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>

                {/* Dropdown */}
                <div className="w-52 flex-shrink-0">
                  <div className="relative">
                    <select
                      value={value}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      className={`
                        w-full appearance-none text-sm px-3 py-2.5 pr-8 rounded-lg border bg-white
                        focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer
                        ${isMissing
                          ? "border-red-300 text-gray-400 ring-1 ring-red-200"
                          : value
                            ? "border-indigo-300 text-gray-800 font-medium"
                            : "border-gray-200 text-gray-400"
                        }
                      `}
                    >
                      <option value="">
                        {field.required ? "Select column…" : "Skip (optional)"}
                      </option>
                      {headers.map((h) => (
                        <option
                          key={h}
                          value={h}
                          disabled={used.includes(h)}
                        >
                          {h}{used.includes(h) ? " (used)" : ""}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                  {isMissing && (
                    <p className="text-xs text-red-500 mt-1">This field is required</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CSV Preview toggle */}
      <button
        onClick={() => setShowPreview((v) => !v)}
        className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1.5 mb-5 transition-colors"
      >
        <svg className={`w-4 h-4 transition-transform ${showPreview ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {showPreview ? "Hide" : "Show"} data preview (first 3 rows)
      </button>

      {showPreview && preview?.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {headers.map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  {headers.map((h) => (
                    <td key={h} className="px-4 py-2.5 text-gray-600 font-mono whitespace-nowrap">
                      {row[h] !== null && row[h] !== undefined ? String(row[h]) : <span className="text-gray-300 italic">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors px-4 py-2.5 rounded-lg hover:bg-gray-100"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </button>

        <button
          onClick={handleAnalyze}
          disabled={!allRequiredMapped}
          className={`
            flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200
            ${allRequiredMapped
              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 hover:shadow-lg active:scale-[0.99]"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }
          `}
        >
          Analyze Inventory
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>

      {!allRequiredMapped && (
        <p className="text-xs text-red-400 text-right mt-2">
          Map all required fields to continue
        </p>
      )}
    </div>
  );
}
