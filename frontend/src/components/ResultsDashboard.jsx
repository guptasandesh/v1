import { useState } from "react";
import IssueTable from "./IssueTable";

// ── Section definitions ──────────────────────────────────────────────────────
const CRITICAL_SECTIONS = [
  {
    key: "duplicate_conflicts",
    label: "Duplicate ID Conflicts",
    icon: "❌",
    color: "red",
    highlightCol: "item_id",
    description: "Same item_id appearing multiple times, with or without conflicting names",
    impact: "Duplicate item IDs cause incorrect stock tracking, order fulfillment errors, and reporting inconsistencies.",
  },
  {
    key: "invalid_quantities",
    label: "Invalid Quantities",
    icon: "🚫",
    color: "orange",
    highlightCol: "quantity",
    description: "Quantity values that are negative or non-numeric",
    impact: "Negative quantities misrepresent actual stock levels and can trigger incorrect reorder alerts.",
  },
];

const WARNING_SECTIONS = [
  {
    key: "missing_values",
    label: "Missing Data",
    icon: "⚠️",
    color: "amber",
    highlightCol: null,
    description: "Rows with null or empty fields",
    impact: "Missing fields create gaps in inventory records and can break automated integrations.",
  },
  {
    key: "outliers",
    label: "Quantity Outliers",
    icon: "📊",
    color: "purple",
    highlightCol: "quantity",
    description: "Quantities more than 2 standard deviations above mean",
    impact: "Abnormally high quantities may indicate bulk entry errors or unit-of-measure mismatches.",
  },
];

const colorMap = {
  red:    { badge: "bg-red-100 text-red-700 border-red-200",       header: "text-red-700",    border: "border-red-200",    bg: "bg-red-50"    },
  amber:  { badge: "bg-amber-100 text-amber-700 border-amber-200", header: "text-amber-700",  border: "border-amber-200",  bg: "bg-amber-50"  },
  orange: { badge: "bg-orange-100 text-orange-700 border-orange-200", header: "text-orange-700", border: "border-orange-200", bg: "bg-orange-50" },
  purple: { badge: "bg-purple-100 text-purple-700 border-purple-200", header: "text-purple-700", border: "border-purple-200", bg: "bg-purple-50" },
};

const FIELD_LABELS = {
  item_id:   "Item ID",
  item_name: "Item Name",
  quantity:  "Quantity",
  location:  "Location",
};

// ── Computed content (mirrors backend logic) ─────────────────────────────────
function generateInsight(data) {
  const { total_rows, affected_rows, results, duplicate_groups = [] } = data;
  const dup     = results.duplicate_conflicts || [];
  const missing = results.missing_values      || [];
  const invalid = results.invalid_quantities  || [];
  const out     = results.outliers            || [];

  if (affected_rows === 0)
    return "All inventory records passed quality checks. The dataset is clean and reliable for operational and reporting use.";

  const pct = total_rows > 0 ? Math.round((affected_rows / total_rows) * 100) : 0;
  const counts = [
    ["duplicate_conflicts", dup.length],
    ["missing_values",      missing.length],
    ["invalid_quantities",  invalid.length],
    ["outliers",            out.length],
  ];
  const dominant = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  if (dominant === "duplicate_conflicts" && dup.length > 0) {
    const conflictCount = duplicate_groups.filter((g) => g.has_name_conflict).length;
    if (conflictCount > 0)
      return `The primary risk is ${conflictCount} item ID${conflictCount !== 1 ? "s" : ""} with conflicting product names across ${dup.length} rows, indicating inventory data merged from multiple sources without unique-ID enforcement. This is the critical issue affecting stock accuracy and must be resolved before relying on this data for operational decisions.`;
    return `${dup.length} rows share duplicated item IDs (exact duplicates), affecting ${pct}% of the dataset. Duplicate entries inflate apparent stock levels and cause incorrect reorder calculations. Deduplication should be the immediate priority.`;
  }
  if (dominant === "missing_values" && missing.length > 0)
    return `${missing.length} records (${pct}% of the dataset) contain missing fields, creating gaps that break automated reporting pipelines and audit trails. Mandatory field validation should be implemented at the point of data entry.`;
  if (dominant === "invalid_quantities" && invalid.length > 0)
    return `${invalid.length} records carry negative quantity values — physically impossible and likely caused by unprocessed returns or data entry errors. These must be corrected before inventory figures can be used for stock replenishment or financial reporting.`;
  return `${out.length} quantity outliers were detected, possibly indicating unit-of-measure discrepancies or bulk entry mistakes. Verify these values against physical stock counts before using them in demand forecasting or reorder calculations.`;
}

function generateObservations(data) {
  const { total_rows, affected_rows, severity_counts, results } = data;
  const dup     = results.duplicate_conflicts || [];
  const missing = results.missing_values      || [];
  const invalid = results.invalid_quantities  || [];
  const out     = results.outliers            || [];

  if (affected_rows === 0)
    return ["All records passed quality checks — inventory data is clean and ready for operational use."];

  const pct     = total_rows > 0 ? Math.round((affected_rows / total_rows) * 100) : 0;
  const bullets = [];

  bullets.push(`${pct}% of records (${affected_rows} rows) contain at least one data quality issue requiring attention.`);

  const issueCounts = [
    ["Duplicate ID conflicts", dup.length],
    ["Missing data",           missing.length],
    ["Invalid quantities",     invalid.length],
    ["Quantity outliers",      out.length],
  ];
  const [dominantLabel, dominantCount] = issueCounts.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (dominantCount > 0)
    bullets.push(`${dominantLabel} is the dominant issue (${dominantCount} records) and should be resolved first to restore data integrity.`);

  const cleanCats = [];
  if (!dup.length)     cleanCats.push("duplicate conflicts");
  if (!missing.length) cleanCats.push("missing data");
  if (!invalid.length) cleanCats.push("invalid quantities");
  if (!out.length)     cleanCats.push("outliers");

  if (cleanCats.length > 0)
    bullets.push(`No issues detected for: ${cleanCats.join(", ")}.`);
  else if ((severity_counts.critical || 0) > 0)
    bullets.push(`${severity_counts.critical} rows carry critical-severity issues and require immediate corrective action before this data is used operationally.`);

  return bullets;
}

function generateFixPriority(data) {
  const { results } = data;
  const dup     = results.duplicate_conflicts || [];
  const missing = results.missing_values      || [];
  const invalid = results.invalid_quantities  || [];
  const out     = results.outliers            || [];

  const items = [];
  let rank = 1;

  if (dup.length) {
    items.push({ rank: rank++, severity: "CRITICAL", color: "red",
      text: "Enforce unique item_id constraints in your database or ERP system to prevent duplicate entries from being created." });
    items.push({ rank: rank++, severity: "CRITICAL", color: "red",
      text: "Audit and merge conflicting records for each duplicated item_id — verify correct product names and reconcile quantities across all occurrences." });
  }
  if (invalid.length)
    items.push({ rank: rank++, severity: "CRITICAL", color: "red",
      text: "Correct all negative quantity values — audit return-processing workflows and apply input validation to block sub-zero entries at source." });
  if (missing.length)
    items.push({ rank: rank++, severity: "WARNING", color: "amber",
      text: "Complete missing field values — enforce mandatory fields at the point of data entry and backfill all historical gaps before the next reporting cycle." });
  if (out.length)
    items.push({ rank: rank++, severity: "WARNING", color: "amber",
      text: "Investigate outlier quantities — verify unit-of-measure consistency and confirm flagged values against physical stock counts." });

  items.push({ rank: rank++, severity: "PREVENTION", color: "green",
    text: "Add automated validation checks during data entry or import to block duplicates and invalid values before they enter the system." });
  items.push({ rank: rank++, severity: "PROCESS", color: "green",
    text: "Assign clear ownership for inventory data quality and establish a regular review and audit workflow to maintain long-term data integrity." });

  return items;
}

// ── Section card ─────────────────────────────────────────────────────────────
function SectionCard({ section, rows }) {
  const [open, setOpen] = useState(true);
  const count     = rows.length;
  const c         = colorMap[section.color];
  const hasIssues = count > 0;

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${hasIssues ? c.border : "border-gray-200"}`}>
      <div
        className={`flex items-center justify-between px-5 py-3.5 cursor-pointer select-none
          ${hasIssues ? c.bg : "bg-gray-50"} border-b ${hasIssues ? c.border : "border-gray-200"}`}
        onClick={() => hasIssues && setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl flex-shrink-0">{section.icon}</span>
          <div className="min-w-0">
            <h3 className={`font-semibold text-sm ${hasIssues ? c.header : "text-gray-500"}`}>{section.label}</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{section.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border
            ${hasIssues ? c.badge : "bg-gray-100 text-gray-400 border-gray-200"}`}>
            {count} {count === 1 ? "record" : "records"}
          </span>
          {hasIssues && (
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </div>

      {hasIssues && (
        <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 italic">
          <span className="font-semibold not-italic text-gray-600">Why this matters: </span>
          {section.impact}
        </div>
      )}

      {hasIssues && open && (
        <div className="p-5">
          <IssueTable rows={rows} highlightCol={section.highlightCol} />
        </div>
      )}

      {!hasIssues && (
        <div className="px-5 py-3 flex items-center gap-2 text-gray-400 text-sm">
          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          No issues found in this category
        </div>
      )}
    </div>
  );
}

// ── Severity group wrapper ────────────────────────────────────────────────────
function SeverityGroup({ label, badgeClass, headerClass, borderClass, bgClass, sections, results }) {
  const total = sections.reduce((sum, s) => sum + (results[s.key]?.length || 0), 0);
  return (
    <div className={`rounded-2xl border ${borderClass} overflow-hidden`}>
      <div className={`px-6 py-3 ${bgClass} border-b ${borderClass} flex items-center justify-between`}>
        <h3 className={`font-bold text-sm uppercase tracking-wider ${headerClass}`}>{label}</h3>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badgeClass}`}>
          {total} {total === 1 ? "record" : "records"} affected
        </span>
      </div>
      <div className="p-4 space-y-3 bg-white">
        {sections.map((section) => (
          <SectionCard key={section.key} section={section} rows={results[section.key] || []} />
        ))}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function ResultsDashboard({ data, onBack }) {
  const { filename, total_rows, affected_rows = 0, severity_counts = {}, mapping, results, duplicate_groups = [] } = data;
  const [downloading, setDownloading] = useState(false);

  const hasAnyIssue  = affected_rows > 0;
  const affectedPct  = total_rows > 0 ? Math.round((affected_rows / total_rows) * 100) : 0;
  const cleanCount   = total_rows - affected_rows;
  const cleanPct     = 100 - affectedPct;
  const critical     = severity_counts.critical || 0;
  const warnings     = severity_counts.warning  || 0;
  const hasCritical  = critical > 0;

  const insight      = generateInsight(data);
  const observations = generateObservations(data);
  const fixPriority  = generateFixPriority(data);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const API = process.env.REACT_APP_API_URL || "https://v1-sq2v.onrender.com";
      const res = await fetch(`${API}/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      const ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, (c) => (c === "T" ? "_" : "-"));
      a.download = `inventory_report_${ts}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not generate report. Make sure the backend is running.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
        {["Upload", "Map Columns", "Results"].map((label, i) => (
          <span key={label} className="flex items-center gap-1.5">
            {i > 0 && (
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            <span className={`flex items-center gap-1.5 ${i === 2 ? "text-indigo-600" : "text-gray-300"}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                ${i === 2 ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-400"}`}>
                {i + 1}
              </span>
              {label}
            </span>
          </span>
        ))}
      </div>

      {/* ── Executive Summary ── */}
      <div className={`rounded-2xl px-8 py-6 border
        ${hasAnyIssue ? "bg-gradient-to-r from-red-50 to-orange-50 border-red-200" : "bg-gradient-to-r from-green-50 to-emerald-50 border-green-200"}`}>

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          {/* Left */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{hasAnyIssue ? "⚠️" : "✅"}</span>
              <h2 className={`text-xl font-bold ${hasAnyIssue ? "text-red-800" : "text-green-800"}`}>
                {hasAnyIssue ? `${affected_rows} of ${total_rows} records have issues` : "No issues found — clean data!"}
              </h2>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              File: <span className="font-medium text-gray-700">{filename}</span>
            </p>

            {/* Severity pills */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                Critical: {critical} rows
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                Warning: {warnings} rows
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Clean: {cleanCount} rows
              </span>
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                transition-all duration-200 shadow-sm
                ${downloading ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 hover:shadow-md active:scale-[0.98]"}`}
            >
              {downloading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Generating PDF…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />
                  </svg>
                  Download PDF Report
                </>
              )}
            </button>
          </div>

          {/* Right: 3-stat cards */}
          <div className="flex gap-0 flex-shrink-0 rounded-xl overflow-hidden border border-gray-200 divide-x divide-gray-200">
            {[
              { value: total_rows.toLocaleString(), label: "Total Records", color: "text-gray-900", bg: "bg-white" },
              { value: affected_rows, label: `Affected Records (${affectedPct}%)`, color: hasAnyIssue ? "text-red-600" : "text-green-600", bg: hasAnyIssue ? "bg-red-50" : "bg-green-50" },
              { value: cleanCount, label: `Clean Records (${cleanPct}%)`, color: "text-indigo-600", bg: "bg-indigo-50" },
            ].map((s) => (
              <div key={s.label} className={`px-6 py-4 text-center ${s.bg}`}>
                <div className={`text-3xl font-extrabold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-400 font-medium mt-1 whitespace-nowrap">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Urgency Banner (critical issues only) ── */}
      {hasCritical && (
        <div className="flex items-stretch rounded-xl overflow-hidden border-2 border-red-500">
          <div className="bg-red-600 text-white text-xs font-bold px-4 flex items-center justify-center text-center leading-tight min-w-[90px]">
            ACTION<br/>REQUIRED
          </div>
          <div className="bg-red-50 px-5 py-4 flex items-center">
            <p className="text-sm font-semibold text-red-800">
              This dataset is not reliable for operational decision-making until critical data integrity issues (duplicate item ID conflicts) are resolved.
            </p>
          </div>
        </div>
      )}

      {/* ── Primary Insight ── */}
      <div className="flex rounded-xl overflow-hidden border border-indigo-200 shadow-sm">
        <div className="bg-indigo-600 text-white px-4 flex items-center justify-center min-w-[110px]">
          <span className="text-xs font-bold text-center leading-tight">PRIMARY<br/>INSIGHT</span>
        </div>
        <div className="bg-indigo-50 px-5 py-4 flex items-center">
          <p className="text-sm text-gray-800 leading-relaxed">{insight}</p>
        </div>
      </div>

      {/* ── Column Mapping ── */}
      {mapping && Object.keys(mapping).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span className="text-sm font-semibold text-gray-700">Column Mapping Used</span>
          </div>
          <div className="px-6 py-4 flex flex-wrap gap-3">
            {Object.entries(mapping).map(([field, csvCol]) => (
              <div key={field} className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                <span className="text-xs font-semibold text-indigo-700">{FIELD_LABELS[field] || field}</span>
                <svg className="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <span className="text-xs font-mono text-gray-600 bg-white border border-indigo-100 px-2 py-0.5 rounded">
                  {csvCol}
                </span>
              </div>
            ))}
          </div>
          <div className="px-6 pb-4">
            <button onClick={onBack} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors">
              ← Adjust column mapping
            </button>
          </div>
        </div>
      )}

      {/* ── Detailed Findings ── */}
      <div>
        <h2 className="text-base font-bold text-gray-800 mb-4">Detailed Findings</h2>
        <div className="space-y-4">
          <SeverityGroup
            label="Critical Issues"
            badgeClass="bg-red-100 text-red-700 border-red-200"
            headerClass="text-red-700"
            borderClass="border-red-200"
            bgClass="bg-red-50"
            sections={CRITICAL_SECTIONS}
            results={results}
          />
          <SeverityGroup
            label="Warnings"
            badgeClass="bg-amber-100 text-amber-700 border-amber-200"
            headerClass="text-amber-700"
            borderClass="border-amber-200"
            bgClass="bg-amber-50"
            sections={WARNING_SECTIONS}
            results={results}
          />
        </div>
      </div>

      {/* ── Observations ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-sm font-bold text-gray-700">Observations</span>
        </div>
        <ul className="px-6 py-5 space-y-3">
          {observations.map((obs, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 flex-shrink-0"></span>
              <span className="text-sm text-gray-700 leading-relaxed">{obs}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Recommended Fix Priority ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          <span className="text-sm font-bold text-gray-700">Recommended Fix Priority</span>
        </div>
        <div className="px-6 py-5 space-y-3">
          {fixPriority.map((item) => {
            const styles = {
              red:   { badge: "bg-red-600",   text: "text-red-700",   bg: "bg-red-50",   border: "border-red-200"   },
              amber: { badge: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
              green: { badge: "bg-green-600", text: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
            }[item.color];
            return (
              <div key={item.rank} className={`flex items-stretch rounded-lg overflow-hidden border ${styles.border}`}>
                <div className={`${styles.badge} text-white text-sm font-bold w-9 flex items-center justify-center flex-shrink-0`}>
                  {item.rank}
                </div>
                <div className={`${styles.bg} px-4 py-3 flex items-center gap-3 flex-1`}>
                  <span className={`text-xs font-bold uppercase tracking-wide ${styles.text} min-w-[76px] flex-shrink-0`}>
                    {item.severity}
                  </span>
                  <span className="text-sm text-gray-700 leading-relaxed">{item.text}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
