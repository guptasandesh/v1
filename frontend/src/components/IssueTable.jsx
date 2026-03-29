export default function IssueTable({ rows, highlightCol }) {
  if (!rows || rows.length === 0) return null;

  // Collect all columns from rows, excluding the "issue" field for the main display
  const allCols = [...new Set(rows.flatMap(Object.keys))].filter((c) => c !== "issue");

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {allCols.map((col) => (
              <th
                key={col}
                className={`px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider
                  ${highlightCol === col ? "text-red-600" : "text-gray-500"}`}
              >
                {col.replace(/_/g, " ")}
              </th>
            ))}
            <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider text-gray-500">
              Issue
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-gray-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
            >
              {allCols.map((col) => (
                <td
                  key={col}
                  className={`px-4 py-3 font-mono text-xs
                    ${highlightCol === col
                      ? "text-red-600 font-semibold"
                      : "text-gray-700"
                    }
                    ${row[col] === null || row[col] === "" || row[col] === undefined
                      ? "text-gray-300 italic"
                      : ""
                    }
                  `}
                >
                  {row[col] !== null && row[col] !== undefined && row[col] !== ""
                    ? String(row[col])
                    : "—"}
                </td>
              ))}
              <td className="px-4 py-3 text-xs text-amber-700 font-medium max-w-xs">
                {row.issue || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
