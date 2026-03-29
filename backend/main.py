from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import pandas as pd
import numpy as np
import io
import json
from datetime import datetime

# PDF
from reportlab.lib.pagesizes import A4
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

# ── Colour palette ───────────────────────────────────────────────────────────
C_INDIGO       = HexColor("#4F46E5")
C_INDIGO_LIGHT = HexColor("#EEF2FF")
C_INDIGO_DARK  = HexColor("#3730A3")
C_RED          = HexColor("#DC2626")
C_RED_LIGHT    = HexColor("#FEF2F2")
C_RED_DARK     = HexColor("#991B1B")
C_AMBER        = HexColor("#D97706")
C_AMBER_LIGHT  = HexColor("#FFFBEB")
C_AMBER_DARK   = HexColor("#92400E")
C_ORANGE       = HexColor("#EA580C")
C_ORANGE_LIGHT = HexColor("#FFF7ED")
C_PURPLE       = HexColor("#7C3AED")
C_PURPLE_LIGHT = HexColor("#F5F3FF")
C_GREEN        = HexColor("#16A34A")
C_GREEN_LIGHT  = HexColor("#F0FDF4")
C_GREEN_DARK   = HexColor("#14532D")
C_GRAY_50      = HexColor("#F9FAFB")
C_GRAY_100     = HexColor("#F3F4F6")
C_GRAY_200     = HexColor("#E5E7EB")
C_GRAY_500     = HexColor("#6B7280")
C_GRAY_700     = HexColor("#374151")
C_GRAY_900     = HexColor("#111827")

PAGE_W, PAGE_H = A4
MARGIN   = 45
USABLE_W = PAGE_W - 2 * MARGIN

# ── Business impact copy ─────────────────────────────────────────────────────
BUSINESS_IMPACT = {
    "duplicate_conflicts": (
        "Duplicate item IDs cause incorrect stock tracking, order fulfillment "
        "errors, and reporting inconsistencies. Systems that rely on unique "
        "identifiers will produce unreliable results when duplicates exist."
    ),
    "missing_values": (
        "Missing fields create gaps in inventory records, leading to inaccurate "
        "reporting, failed system integrations, and incomplete audit trails."
    ),
    "invalid_quantities": (
        "Negative quantity values indicate data entry errors, unprocessed returns, "
        "or system synchronisation failures that misrepresent actual stock levels "
        "and can trigger incorrect reorder alerts."
    ),
    "outliers": (
        "Unusually high quantity values may indicate bulk data entry errors or "
        "unit-of-measure mismatches that inflate perceived inventory levels and "
        "distort demand forecasting."
    ),
}

app = FastAPI(title="Inventory Error Detection Engine")

import os
_ALLOWED = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED,
    allow_methods=["*"],
    allow_headers=["*"],
)

REQUIRED_FIELDS = {"item_id", "item_name", "quantity"}


@app.on_event("startup")
async def log_routes():
    import logging
    logger = logging.getLogger("uvicorn.error")
    for r in app.routes:
        logger.info(f"ROUTE: {getattr(r, 'path', '?')}")


# ── Detection helpers ────────────────────────────────────────────────────────

def detect_duplicate_conflicts(df: pd.DataFrame):
    """
    Groups by item_id. Returns:
      - flat issues list  (for frontend table)
      - affected index set (for unique-row counting)
      - grouped list       (for PDF grouped display)
    """
    issues:   list[dict] = []
    affected: set        = set()
    groups:   list[dict] = []

    for item_id, group in df.groupby("item_id"):
        if len(group) < 2:
            continue

        has_conflict = "item_name" in group.columns and group["item_name"].nunique() > 1
        names = [str(n) for n in group["item_name"].dropna().unique()] \
                if "item_name" in group.columns else []

        issue_text = (
            f"ID '{item_id}' appears {len(group)}x with conflicting names: {', '.join(names)}"
            if has_conflict
            else f"ID '{item_id}' is an exact duplicate (appears {len(group)} times)"
        )

        group_rows = []
        for idx, row in group.iterrows():
            r = row.to_dict()
            r["issue"] = issue_text
            issues.append(r)
            affected.add(idx)
            group_rows.append(row.to_dict())

        groups.append({
            "item_id":          str(item_id),
            "count":            len(group),
            "has_name_conflict": has_conflict,
            "names":            names,
            "rows":             group_rows,
        })

    return issues, affected, groups


def detect_missing_values(df: pd.DataFrame):
    issues:   list[dict] = []
    affected: set        = set()

    for idx, row in df.iterrows():
        missing_cols = [
            col for col in df.columns
            if pd.isnull(row[col]) or str(row[col]).strip() == ""
        ]
        if missing_cols:
            r = row.to_dict()
            r["issue"] = f"Missing: {', '.join(missing_cols)}"
            issues.append(r)
            affected.add(idx)

    return issues, affected


def detect_invalid_quantities(df: pd.DataFrame):
    issues:   list[dict] = []
    affected: set        = set()

    work = df.copy()
    work["quantity"] = pd.to_numeric(work["quantity"], errors="coerce")

    for idx, row in work.iterrows():
        qty = row["quantity"]
        if pd.isnull(qty):
            continue
        if qty < 0:
            r = row.to_dict()
            r["issue"] = f"Negative quantity: {qty:.0f}"
            issues.append(r)
            affected.add(idx)

    return issues, affected


def detect_outliers(df: pd.DataFrame):
    issues:   list[dict] = []
    affected: set        = set()

    work = df.copy()
    work["quantity"] = pd.to_numeric(work["quantity"], errors="coerce")
    valid = work["quantity"].dropna()

    if len(valid) < 3:
        return [], set()

    mean = valid.mean()
    std  = valid.std()
    if std == 0:
        return [], set()

    threshold = mean + 2 * std

    for idx, row in work.iterrows():
        qty = row["quantity"]
        if not pd.isnull(qty) and qty > threshold:
            r = row.to_dict()
            r["issue"] = f"Outlier: {qty:.0f} (mean={mean:.1f}, threshold={threshold:.1f})"
            issues.append(r)
            affected.add(idx)

    return issues, affected


def run_all_checks(df: pd.DataFrame) -> dict:
    dup_issues, dup_idx, dup_groups = detect_duplicate_conflicts(df)
    missing_issues, missing_idx     = detect_missing_values(df)
    invalid_issues, invalid_idx     = detect_invalid_quantities(df)
    outlier_issues, outlier_idx     = detect_outliers(df)

    all_affected  = dup_idx | missing_idx | invalid_idx | outlier_idx
    critical_idx  = dup_idx | invalid_idx
    warning_idx   = missing_idx | outlier_idx

    return {
        "affected_rows":   len(all_affected),
        "severity_counts": {
            "critical": len(critical_idx),
            "warning":  len(warning_idx),
        },
        "duplicate_groups": dup_groups,
        "results": {
            "duplicate_conflicts": dup_issues,
            "missing_values":      missing_issues,
            "invalid_quantities":  invalid_issues,
            "outliers":            outlier_issues,
        },
    }


# ── CSV parsing ──────────────────────────────────────────────────────────────

def parse_csv(contents: bytes) -> pd.DataFrame:
    try:
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    except UnicodeDecodeError:
        df = pd.read_csv(io.StringIO(contents.decode("latin-1")))
    df.columns = [c.strip() for c in df.columns]
    return df


# ── API endpoints ────────────────────────────────────────────────────────────

@app.post("/preview")
async def preview_file(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    contents = await file.read()
    if not contents.strip():
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    try:
        df = parse_csv(contents)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse CSV.")
    if df.empty:
        raise HTTPException(status_code=400, detail="The CSV file has no data rows.")
    preview = df.head(3).where(pd.notnull(df.head(3)), None).to_dict(orient="records")
    return {
        "filename":  file.filename,
        "headers":   list(df.columns),
        "row_count": len(df),
        "preview":   preview,
    }


@app.post("/analyze")
async def analyze_file(
    file: UploadFile = File(...),
    mapping: str = Form(...),
):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    try:
        mapping_dict: dict = json.loads(mapping)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid mapping format.")

    missing_fields = REQUIRED_FIELDS - set(mapping_dict.keys())
    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Mapping missing required fields: {', '.join(sorted(missing_fields))}",
        )

    contents = await file.read()
    try:
        df = parse_csv(contents)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse CSV.")

    for field, csv_col in mapping_dict.items():
        if csv_col and csv_col not in df.columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{csv_col}' not found in the uploaded file.",
            )

    rename_map = {csv_col: field for field, csv_col in mapping_dict.items() if csv_col}
    df = df.rename(columns=rename_map)
    df = df.where(pd.notnull(df), None)

    checks = run_all_checks(df)

    return {
        "filename":         file.filename,
        "total_rows":       len(df),
        "affected_rows":    checks["affected_rows"],
        "severity_counts":  checks["severity_counts"],
        "duplicate_groups": checks["duplicate_groups"],
        "mapping":          mapping_dict,
        "results":          checks["results"],
    }


@app.get("/health")
def health():
    return {"status": "ok"}


# ── PDF styles ───────────────────────────────────────────────────────────────

def _styles():
    def s(name, **kw):
        return ParagraphStyle(name, **kw)

    return {
        "title":          s("T",   fontSize=22, fontName="Helvetica-Bold",  textColor=white,        leading=28),
        "subtitle":       s("ST",  fontSize=10, fontName="Helvetica",        textColor=HexColor("#C7D2FE"), leading=14),
        "meta":           s("M",   fontSize=8,  fontName="Helvetica",        textColor=C_GRAY_700,   leading=13),
        "section_h":      s("SH",  fontSize=12, fontName="Helvetica-Bold",   textColor=C_GRAY_900,   leading=16, spaceBefore=4),
        "impact":         s("IMP", fontSize=8,  fontName="Helvetica-Oblique",textColor=C_GRAY_500,   leading=12, spaceBefore=2),
        "stat_num":       s("SN",  fontSize=18, fontName="Helvetica-Bold",   textColor=C_GRAY_900,   alignment=TA_CENTER, leading=22),
        "stat_num_red":   s("SNR", fontSize=18, fontName="Helvetica-Bold",   textColor=C_RED,        alignment=TA_CENTER, leading=22),
        "stat_num_grn":   s("SNG", fontSize=18, fontName="Helvetica-Bold",   textColor=C_GREEN,      alignment=TA_CENTER, leading=22),
        "stat_num_ind":   s("SNI", fontSize=18, fontName="Helvetica-Bold",   textColor=C_INDIGO,     alignment=TA_CENTER, leading=22),
        "stat_lbl":       s("SL",  fontSize=7,  fontName="Helvetica",        textColor=C_GRAY_500,   alignment=TA_CENTER, leading=10),
        "tbl_hdr":        s("TH",  fontSize=8,  fontName="Helvetica-Bold",   textColor=white,        leading=11),
        "tbl_cell":       s("TC",  fontSize=8,  fontName="Helvetica",        textColor=C_GRAY_700,   leading=11),
        "tbl_cell_bold":  s("TCB", fontSize=8,  fontName="Helvetica-Bold",   textColor=C_RED,        leading=11),
        "tbl_issue":      s("TI",  fontSize=8,  fontName="Helvetica-Oblique",textColor=C_AMBER,      leading=11),
        "sev_critical":   s("SC",  fontSize=10, fontName="Helvetica-Bold",   textColor=C_RED_DARK,   leading=14),
        "sev_warning":    s("SW",  fontSize=10, fontName="Helvetica-Bold",   textColor=C_AMBER_DARK, leading=14),
        "obs":            s("OB",  fontSize=9,  fontName="Helvetica",        textColor=C_GRAY_700,   leading=14, leftIndent=12, spaceBefore=3),
        "obs_h":          s("OH",  fontSize=11, fontName="Helvetica-Bold",   textColor=C_GRAY_900,   leading=16, spaceBefore=4),
        "rec":            s("RC",  fontSize=8,  fontName="Helvetica",        textColor=C_GRAY_700,   leading=13, leftIndent=8, spaceBefore=2),
        "no_issues":      s("NI",  fontSize=9,  fontName="Helvetica-Oblique",textColor=C_GREEN,      leading=13),
        "insight_label":  s("IL",  fontSize=8,  fontName="Helvetica-Bold",   textColor=C_INDIGO_DARK,leading=12),
        "insight_body":   s("IB",  fontSize=9,  fontName="Helvetica",        textColor=C_GRAY_900,   leading=14),
        "grp_id":         s("GI",  fontSize=9,  fontName="Helvetica-Bold",   textColor=C_RED_DARK,   leading=13),
        "grp_count":      s("GC",  fontSize=8,  fontName="Helvetica",        textColor=C_GRAY_500,   leading=13),
        "grp_badge":      s("GB",  fontSize=7,  fontName="Helvetica-Bold",   textColor=white,        leading=10, alignment=TA_CENTER),
        "priority_num":   s("PN",  fontSize=11, fontName="Helvetica-Bold",   textColor=white,        leading=14, alignment=TA_CENTER),
        "priority_sev":   s("PS",  fontSize=7,  fontName="Helvetica-Bold",   textColor=C_GRAY_500,   leading=10),
        "priority_text":  s("PT",  fontSize=8,  fontName="Helvetica",        textColor=C_GRAY_700,   leading=13),
        "field_tag":      s("FT",  fontSize=8,  fontName="Helvetica-Bold",   textColor=C_INDIGO,     leading=11),
        "field_val":      s("FV",  fontSize=8,  fontName="Helvetica",        textColor=C_GRAY_700,   leading=11),
        "summary_note":   s("SUM", fontSize=9,  fontName="Helvetica-Oblique",textColor=C_GRAY_700,   leading=13, spaceBefore=4),
        "sev_clean":      s("SVG", fontSize=10, fontName="Helvetica-Bold",   textColor=C_GREEN_DARK, leading=14),
        "urgency_lbl":    s("UL",  fontSize=8,  fontName="Helvetica-Bold",   textColor=white,        leading=12, alignment=TA_CENTER),
        "urgency_txt":    s("UT",  fontSize=9,  fontName="Helvetica-Bold",   textColor=C_RED_DARK,   leading=14),
    }


def _trunc(val, n=38):
    s = str(val) if val is not None else "—"
    return s if len(s) <= n else s[:n - 1] + "…"


# ── PDF block builders ───────────────────────────────────────────────────────

def _header_block(st, filename, total_rows, now_str):
    banner = Table(
        [[Paragraph("Inventory Analysis Report", st["title"]),
          Paragraph("Generated by InvCheck", st["subtitle"])]],
        colWidths=[USABLE_W],
    )
    banner.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C_INDIGO),
        ("TOPPADDING",    (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
        ("LEFTPADDING",   (0, 0), (-1, -1), 18),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 18),
    ]))

    col = USABLE_W / 3
    meta = Table(
        [[Paragraph(f"<b>FILE</b><br/>{_trunc(filename, 34)}", st["meta"]),
          Paragraph(f"<b>GENERATED</b><br/>{now_str}",          st["meta"]),
          Paragraph(f"<b>TOTAL RECORDS</b><br/>{total_rows:,}", st["meta"])]],
        colWidths=[col, col, col],
    )
    meta.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C_GRAY_100),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
        ("LINEAFTER",     (0, 0), (1, 0), 1, C_GRAY_200),
    ]))

    return [banner, meta, Spacer(1, 14)]


def _summary_block(st, total_rows, affected_rows, severity_counts):
    has_issues   = affected_rows > 0
    affected_pct = round(affected_rows / total_rows * 100) if total_rows else 0
    clean_count  = total_rows - affected_rows
    clean_pct    = 100 - affected_pct
    critical     = severity_counts.get("critical", 0)
    warning      = severity_counts.get("warning",  0)

    # ── Stat cards (3 columns) ───────────────────────────────────────────────
    col = USABLE_W / 3
    stats = Table(
        [
            [
                Paragraph(f"{total_rows:,}",  st["stat_num"]),
                Paragraph(str(affected_rows), st["stat_num_red"] if has_issues else st["stat_num_grn"]),
                Paragraph(f"{clean_count:,}", st["stat_num_ind"]),
            ],
            [
                Paragraph("Total Records",                   st["stat_lbl"]),
                Paragraph(f"Affected Records ({affected_pct}%)", st["stat_lbl"]),
                Paragraph(f"Clean Records ({clean_pct}%)",   st["stat_lbl"]),
            ],
        ],
        colWidths=[col] * 3,
        rowHeights=[32, 18],
    )
    bg2 = C_RED_LIGHT if has_issues else C_GREEN_LIGHT
    stats.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, -1), C_GRAY_50),
        ("BACKGROUND",    (1, 0), (1, -1), bg2),
        ("BACKGROUND",    (2, 0), (2, -1), C_INDIGO_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("TOPPADDING",    (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
        ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
        ("LINEBEFORE",    (1, 0), (2, -1), 1, C_GRAY_200),
    ]))

    # ── Severity breakdown row (3 columns: Critical / Warning / Clean) ────────
    third = USABLE_W / 3
    sev = Table(
        [[Paragraph(f"[!] CRITICAL  --  {critical} row{'s' if critical != 1 else ''} affected", st["sev_critical"]),
          Paragraph(f"[~] WARNING  --  {warning} row{'s' if warning != 1 else ''} affected",  st["sev_warning"]),
          Paragraph(f"[OK] CLEAN  --  {clean_count} record{'s' if clean_count != 1 else ''}", st["sev_clean"])]],
        colWidths=[third, third, third],
    )
    sev.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), C_RED_LIGHT),
        ("BACKGROUND",    (1, 0), (1, 0), C_AMBER_LIGHT),
        ("BACKGROUND",    (2, 0), (2, 0), C_GREEN_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
        ("LINEBEFORE",    (1, 0), (1, 0),   1, C_GRAY_200),
        ("LINEBEFORE",    (2, 0), (2, 0),   1, C_GRAY_200),
    ]))

    if has_issues:
        note = (
            f"This dataset has data integrity issues affecting {affected_pct}% of records "
            f"({affected_rows} rows). Resolve critical issues first — they directly impact "
            "stock accuracy and operational decisions."
        )
    else:
        note = "All records passed quality checks. The dataset is clean and ready for operational use."

    return [
        Paragraph("Executive Summary", st["section_h"]),
        Spacer(1, 8),
        stats,
        Spacer(1, 8),
        sev,
        Paragraph(note, st["summary_note"]),
        Spacer(1, 16),
    ]


def _generate_key_insight(data: dict) -> str:
    results       = data.get("results", {})
    affected_rows = data.get("affected_rows", 0)
    total_rows    = data.get("total_rows", 0)
    dup_groups    = data.get("duplicate_groups", [])

    dup     = results.get("duplicate_conflicts", [])
    missing = results.get("missing_values", [])
    invalid = results.get("invalid_quantities", [])
    outliers = results.get("outliers", [])

    if affected_rows == 0:
        return (
            "All inventory records passed quality checks. "
            "The dataset is clean and reliable for operational and reporting use."
        )

    pct = round(affected_rows / total_rows * 100) if total_rows else 0

    counts = [
        ("duplicate_conflicts", len(dup)),
        ("missing_values",      len(missing)),
        ("invalid_quantities",  len(invalid)),
        ("outliers",            len(outliers)),
    ]
    dominant = max(counts, key=lambda x: x[1])[0]

    if dominant == "duplicate_conflicts" and dup:
        conflict_count = sum(1 for g in dup_groups if g.get("has_name_conflict"))
        if conflict_count > 0:
            return (
                f"The primary risk is {conflict_count} item ID{'s' if conflict_count != 1 else ''} "
                f"with conflicting product names across {len(dup)} rows, indicating inventory data "
                "merged from multiple sources without unique-ID enforcement. "
                "This is the critical issue affecting stock accuracy and must be resolved before "
                "relying on this data for operational decisions."
            )
        else:
            return (
                f"{len(dup)} rows share duplicated item IDs (exact duplicates), affecting {pct}% "
                "of the dataset. Duplicate entries inflate apparent stock levels and cause "
                "incorrect reorder calculations. Deduplication should be the immediate priority."
            )
    elif dominant == "missing_values" and missing:
        return (
            f"{len(missing)} records ({pct}% of the dataset) contain missing fields, creating "
            "gaps that break automated reporting pipelines and audit trails. "
            "Mandatory field validation should be implemented at the point of data entry."
        )
    elif dominant == "invalid_quantities" and invalid:
        return (
            f"{len(invalid)} records carry negative quantity values — physically impossible "
            "and likely caused by unprocessed returns or data entry errors. "
            "These must be corrected before inventory figures can be used for stock "
            "replenishment or financial reporting."
        )
    else:
        return (
            f"{len(outliers)} quantity outliers were detected, possibly indicating "
            "unit-of-measure discrepancies or bulk entry mistakes. "
            "Verify these values against physical stock counts before using them in "
            "demand forecasting or reorder calculations."
        )


def _key_insight_block(st, insight_text):
    t = Table(
        [[Paragraph("Primary Insight", st["insight_label"]),
          Paragraph(insight_text,      st["insight_body"])]],
        colWidths=[USABLE_W * 0.22, USABLE_W * 0.78],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C_INDIGO_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
        ("BOX",           (0, 0), (-1, -1), 1.5, C_INDIGO),
        ("LINEBEFORE",    (1, 0), (1, 0),   1.5, C_INDIGO),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return [t, Spacer(1, 16)]


def _urgency_block(st, data: dict):
    """Bold red alert shown only when critical issues exist."""
    results = data.get("results", {})
    dup     = results.get("duplicate_conflicts", [])
    invalid = results.get("invalid_quantities", [])
    if not dup and not invalid:
        return []
    msg = (
        "This dataset is not reliable for operational decision-making until critical "
        "data integrity issues (duplicate item ID conflicts) are resolved."
    )
    t = Table(
        [[Paragraph("ACTION\nREQUIRED", st["urgency_lbl"]),
          Paragraph(msg, st["urgency_txt"])]],
        colWidths=[USABLE_W * 0.16, USABLE_W * 0.84],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), C_RED),
        ("BACKGROUND",    (1, 0), (1, 0), C_RED_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("BOX",           (0, 0), (-1, -1), 2, C_RED),
        ("LINEBEFORE",    (1, 0), (1, 0),   2, C_RED),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return [t, Spacer(1, 14)]


def _mapping_block(st, mapping):
    if not mapping:
        return []
    labels = {"item_id": "Item ID", "item_name": "Item Name",
              "quantity": "Quantity", "location": "Location"}
    pills = "     ".join(f"{labels.get(k, k)}  →  {v}" for k, v in mapping.items())
    t = Table(
        [[Paragraph("Column Mapping", st["field_tag"]),
          Paragraph(pills, st["field_val"])]],
        colWidths=[USABLE_W * 0.25, USABLE_W * 0.75],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C_INDIGO_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("BOX",           (0, 0), (-1, -1), 1, HexColor("#C7D2FE")),
        ("LINEBEFORE",    (1, 0), (1, 0),   1, HexColor("#C7D2FE")),
    ]))
    return [t, Spacer(1, 14)]


def _severity_group_header(st, label, color, color_light):
    t = Table(
        [[Paragraph(label, ParagraphStyle(
            "gh", fontSize=10, fontName="Helvetica-Bold",
            textColor=color, leading=14))]],
        colWidths=[USABLE_W],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), color_light),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("BOX",           (0, 0), (-1, -1), 1, color),
    ]))
    return [t, Spacer(1, 6)]


def _section_header(st, title, count, header_color, header_bg, impact_text):
    """Reusable section header + impact line."""
    heading = Table(
        [[Paragraph(title, ParagraphStyle(
              "sh2", fontSize=10, fontName="Helvetica-Bold",
              textColor=header_color, leading=14)),
          Paragraph(
              f"{count} record{'s' if count != 1 else ''}",
              ParagraphStyle("cnt2", fontSize=9, fontName="Helvetica-Bold",
                             textColor=header_color, alignment=TA_RIGHT, leading=14)),
          ]],
        colWidths=[USABLE_W * 0.75, USABLE_W * 0.25],
    )
    heading.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), header_bg),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (0, 0),   12),
        ("RIGHTPADDING",  (-1, 0), (-1, 0), 12),
        ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
    ]))
    elements = [heading, Paragraph(f"Why this matters: {impact_text}", st["impact"]), Spacer(1, 4)]
    return elements


def _no_issues_row(st):
    no = Table(
        [[Paragraph("No issues detected in this category.", st["no_issues"])]],
        colWidths=[USABLE_W],
    )
    no.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C_GREEN_LIGHT),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
    ]))
    return [no, Spacer(1, 10)]


def _duplicate_groups_section(st, dup_groups):
    """Grouped-by-item_id PDF view for duplicate conflicts."""
    elements = _section_header(
        st, "Duplicate ID Conflicts",
        sum(g["count"] for g in dup_groups),
        C_RED, C_RED_LIGHT,
        BUSINESS_IMPACT["duplicate_conflicts"],
    )

    if not dup_groups:
        elements += _no_issues_row(st)
        return elements

    for gi, g in enumerate(dup_groups[:25]):
        if gi > 0:
            elements.append(HRFlowable(width=USABLE_W, thickness=0.5, color=C_GRAY_200,
                                       spaceBefore=4, spaceAfter=8))
        item_id      = g["item_id"]
        count        = g["count"]
        has_conflict = g["has_name_conflict"]
        rows         = g["rows"]
        names        = g.get("names", [])

        badge_text  = "NAME CONFLICT" if has_conflict else "DUPLICATE"
        hdr_color   = C_RED    if has_conflict else C_ORANGE
        hdr_bg      = C_RED_LIGHT if has_conflict else C_ORANGE_LIGHT

        # Group header row
        grp_hdr = Table(
            [[
                Paragraph(f"Item ID: {item_id}", st["grp_id"]),
                Paragraph(f"{count} occurrences", st["grp_count"]),
                Paragraph(badge_text, ParagraphStyle(
                    "badge", fontSize=7, fontName="Helvetica-Bold",
                    textColor=white, alignment=TA_RIGHT, leading=10)),
            ]],
            colWidths=[USABLE_W * 0.45, USABLE_W * 0.30, USABLE_W * 0.25],
        )
        grp_hdr.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), hdr_bg),
            ("BACKGROUND",    (2, 0), (2, 0),   hdr_color),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 10),
            ("RIGHTPADDING",  (-1, 0), (-1, 0), 10),
            ("BOX",           (0, 0), (-1, -1), 1, hdr_color),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elements.append(grp_hdr)

        # Data rows for this group
        show_cols = [c for c in ["item_name", "quantity", "location"]
                     if rows and c in rows[0]]
        if show_cols:
            unique_names = set(names)
            col_w = USABLE_W / len(show_cols)

            tbl_data = [[Paragraph(c.replace("_", " ").title(), st["tbl_hdr"])
                         for c in show_cols]]
            for row in rows:
                tbl_data.append([
                    Paragraph(
                        _trunc(row.get(c)),
                        # Bold+red for conflicting item_name values
                        st["tbl_cell_bold"]
                        if (c == "item_name" and has_conflict and len(unique_names) > 1)
                        else st["tbl_cell"],
                    )
                    for c in show_cols
                ])

            row_tbl = Table(tbl_data, colWidths=[col_w] * len(show_cols), repeatRows=1)
            row_styles = [
                ("BACKGROUND",    (0, 0), (-1, 0), C_GRAY_700),
                ("TOPPADDING",    (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING",   (0, 0), (-1, -1), 8),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
                ("INNERGRID",     (0, 0), (-1, -1), 0.25, C_GRAY_200),
            ]
            for i in range(1, len(tbl_data)):
                row_styles.append(("BACKGROUND", (0, i), (-1, i),
                                   hdr_bg if i % 2 == 1 else white))
            row_tbl.setStyle(TableStyle(row_styles))
            elements.append(row_tbl)

        elements.append(Spacer(1, 6))

    if len(dup_groups) > 25:
        elements.append(Paragraph(
            f"  … {len(dup_groups) - 25} additional item ID groups not shown.",
            ParagraphStyle("trunc", fontSize=7, fontName="Helvetica-Oblique",
                           textColor=C_GRAY_500, leading=10)))

    elements.append(Spacer(1, 4))
    return elements


def _flat_issue_section(st, title, rows, header_color, header_bg, impact_text):
    """Standard flat-table section for missing/invalid/outliers."""
    elements = _section_header(st, title, len(rows), header_color, header_bg, impact_text)

    if not rows:
        elements += _no_issues_row(st)
        return elements

    priority = ["item_id", "item_name", "quantity", "location"]
    all_cols  = list(rows[0].keys())
    extras    = [c for c in all_cols if c not in priority and c != "issue"]
    show_cols = [c for c in priority if c in all_cols] + extras[:1]
    if "issue" in all_cols:
        show_cols.append("issue")

    issue_w   = min(USABLE_W * 0.36, 162)
    other_w   = (USABLE_W - issue_w) / max(len(show_cols) - 1, 1)
    col_widths = [issue_w if c == "issue" else other_w for c in show_cols]

    tbl_data = [[Paragraph(c.replace("_", " ").title(), st["tbl_hdr"]) for c in show_cols]]
    for row in rows[:60]:
        tbl_data.append([
            Paragraph(_trunc(row.get(c)),
                      st["tbl_issue"] if c == "issue" else st["tbl_cell"])
            for c in show_cols
        ])

    tbl = Table(tbl_data, colWidths=col_widths, repeatRows=1)
    row_styles = [
        ("BACKGROUND",    (0, 0), (-1, 0), header_color),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
        ("INNERGRID",     (0, 0), (-1, -1), 0.25, C_GRAY_200),
    ]
    for i in range(1, len(tbl_data)):
        row_styles.append(("BACKGROUND", (0, i), (-1, i),
                           header_bg if i % 2 == 1 else white))
    tbl.setStyle(TableStyle(row_styles))
    elements.append(tbl)

    if len(rows) > 60:
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(
            f"  … {len(rows) - 60} additional rows not shown.",
            ParagraphStyle("trunc", fontSize=7, fontName="Helvetica-Oblique",
                           textColor=C_GRAY_500, leading=10)))

    elements.append(Spacer(1, 12))
    return elements


def _fix_priority_block(st, data: dict):
    """Ordered numbered list of what to fix first."""
    results = data.get("results", {})
    dup     = results.get("duplicate_conflicts", [])
    missing = results.get("missing_values", [])
    invalid = results.get("invalid_quantities", [])
    outliers = results.get("outliers", [])

    if not any([dup, missing, invalid, outliers]):
        return []

    priorities = []
    rank = 1
    if dup:
        priorities.append((rank, C_RED, "CRITICAL",
                           "Enforce unique item_id constraints in your database or ERP system to prevent duplicate entries from being created."))
        rank += 1
        priorities.append((rank, C_RED, "CRITICAL",
                           "Audit and merge conflicting records for each duplicated item_id — verify correct product names and reconcile quantities across all occurrences."))
        rank += 1
    if invalid:
        priorities.append((rank, C_RED, "CRITICAL",
                           "Correct all negative quantity values — audit return-processing workflows and apply input validation to block sub-zero entries at source."))
        rank += 1
    if missing:
        priorities.append((rank, C_AMBER, "WARNING",
                           "Complete missing field values — enforce mandatory fields at the point of data entry and backfill all historical gaps before next reporting cycle."))
        rank += 1
    if outliers:
        priorities.append((rank, C_AMBER, "WARNING",
                           "Investigate outlier quantities — verify unit-of-measure consistency and confirm flagged values against physical stock counts."))
        rank += 1
    priorities.append((rank, C_GREEN, "PREVENTION",
                       "Add automated validation checks during data entry or import to block duplicates and invalid values before they enter the system."))
    rank += 1
    priorities.append((rank, C_GREEN, "PROCESS",
                       "Assign clear ownership for inventory data quality and establish a regular review and audit workflow to maintain long-term data integrity."))

    elements = [Paragraph("Recommended Fix Priority", st["obs_h"]), Spacer(1, 6)]

    for num, color, sev_label, text in priorities:
        row = Table(
            [[Paragraph(str(num), st["priority_num"]),
              Paragraph(sev_label, ParagraphStyle(
                  "ps2", fontSize=7, fontName="Helvetica-Bold",
                  textColor=color, leading=10, alignment=TA_CENTER)),
              Paragraph(text, st["priority_text"])]],
            colWidths=[22, 55, USABLE_W - 77],
        )
        row.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (0, 0), color),
            ("BACKGROUND",    (1, 0), (1, 0), C_GRAY_50),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("BOX",           (0, 0), (-1, -1), 1, C_GRAY_200),
            ("LINEBEFORE",    (1, 0), (2, 0),   1, C_GRAY_200),
        ]))
        elements.append(row)
        elements.append(Spacer(1, 4))

    elements.append(Spacer(1, 10))
    return elements


def _observations_block(st, data: dict):
    """Condensed 2–3 high-impact bullets. No repetition."""
    total_rows    = data.get("total_rows", 0)
    affected_rows = data.get("affected_rows", 0)
    sev           = data.get("severity_counts", {})
    results       = data.get("results", {})

    dup     = results.get("duplicate_conflicts", [])
    missing = results.get("missing_values", [])
    invalid = results.get("invalid_quantities", [])
    out     = results.get("outliers", [])

    bullets = []

    if affected_rows == 0:
        bullets.append(
            "All records passed quality checks — inventory data is clean and ready for operational use."
        )
    else:
        pct = round(affected_rows / total_rows * 100) if total_rows else 0

        # Bullet 1: Overall severity
        bullets.append(
            f"{pct}% of records ({affected_rows} rows) contain at least one data quality issue requiring attention."
        )

        # Bullet 2: Dominant issue only
        issue_counts = [
            ("Duplicate ID conflicts", len(dup)),
            ("Missing data",           len(missing)),
            ("Invalid quantities",     len(invalid)),
            ("Quantity outliers",      len(out)),
        ]
        dominant_label, dominant_count = max(issue_counts, key=lambda x: x[1])
        if dominant_count > 0:
            bullets.append(
                f"{dominant_label} is the dominant issue ({dominant_count} records) "
                "and should be resolved first to restore data integrity."
            )

        # Bullet 3: Categories with no issues (good news)
        clean_cats = []
        if not dup:     clean_cats.append("duplicate conflicts")
        if not missing: clean_cats.append("missing data")
        if not invalid: clean_cats.append("invalid quantities")
        if not out:     clean_cats.append("outliers")

        if clean_cats:
            bullets.append(f"No issues detected for: {', '.join(clean_cats)}.")
        elif sev.get("critical", 0) > 0:
            bullets.append(
                f"{sev['critical']} rows carry critical-severity issues "
                "and require immediate corrective action before this data is used operationally."
            )

    elements = [
        HRFlowable(width=USABLE_W, thickness=1, color=C_GRAY_200, spaceAfter=10),
        Paragraph("Observations", st["obs_h"]),
        Spacer(1, 6),
    ]
    for b in bullets:
        elements.append(Paragraph(f"•  {b}", st["obs"]))
    elements.append(Spacer(1, 14))
    return elements


def _footer_canvas(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(C_GRAY_500)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    canvas.drawString(MARGIN, 25, f"InvCheck — Inventory Analysis Report — {ts}")
    canvas.drawRightString(PAGE_W - MARGIN, 25, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


# ── PDF entry point ──────────────────────────────────────────────────────────

def build_pdf(data: dict) -> bytes:
    buffer  = io.BytesIO()
    doc     = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN,  bottomMargin=45,
        title="Inventory Analysis Report", author="InvCheck",
    )
    st           = _styles()
    results      = data.get("results", {})
    mapping      = data.get("mapping", {})
    dup_groups   = data.get("duplicate_groups", [])
    now_str      = datetime.now().strftime("%B %d, %Y  %I:%M %p")

    story = []

    # 1. Header
    story += _header_block(st, data.get("filename", "unknown.csv"),
                           data.get("total_rows", 0), now_str)

    # 2. Executive Summary
    story += _summary_block(st, data.get("total_rows", 0),
                            data.get("affected_rows", 0),
                            data.get("severity_counts", {}))

    # 3. Urgency alert (critical issues only)
    story += _urgency_block(st, data)

    # 4. Primary Insight
    insight = _generate_key_insight(data)
    story  += _key_insight_block(st, insight)

    # 5. Column mapping
    story += _mapping_block(st, mapping)

    story.append(HRFlowable(width=USABLE_W, thickness=1, color=C_GRAY_200, spaceAfter=10))
    story.append(Paragraph("Detailed Findings", st["section_h"]))
    story.append(Spacer(1, 8))

    # 5a. Critical: Grouped duplicates
    story += _severity_group_header(st, "CRITICAL ISSUES", C_RED, C_RED_LIGHT)
    story += _duplicate_groups_section(st, dup_groups)
    story += _flat_issue_section(
        st, "Invalid Quantities",
        results.get("invalid_quantities", []),
        C_ORANGE, C_ORANGE_LIGHT, BUSINESS_IMPACT["invalid_quantities"],
    )

    # 5b. Warnings: flat tables
    story += _severity_group_header(st, "WARNINGS", C_AMBER, C_AMBER_LIGHT)
    story += _flat_issue_section(
        st, "Missing Data",
        results.get("missing_values", []),
        C_AMBER, C_AMBER_LIGHT, BUSINESS_IMPACT["missing_values"],
    )
    story += _flat_issue_section(
        st, "Quantity Outliers",
        results.get("outliers", []),
        C_PURPLE, C_PURPLE_LIGHT, BUSINESS_IMPACT["outliers"],
    )

    # 6. Observations (condensed)
    story += _observations_block(st, data)

    # 7. Fix priority + recommendations
    story += _fix_priority_block(st, data)

    doc.build(story, onFirstPage=_footer_canvas, onLaterPages=_footer_canvas)
    return buffer.getvalue()


@app.post("/generate-report")
async def generate_report(request: Request):
    data      = await request.json()
    pdf_bytes = build_pdf(data)
    ts        = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename  = f"inventory_report_{ts}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
