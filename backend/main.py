from __future__ import annotations

import os
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import gc
import json
import re
import tempfile
import unicodedata
from pathlib import Path
from typing import List, Optional

from PIL import Image, ImageFilter, ImageOps

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from paddleocr import PaddleOCR

ROOT = Path(__file__).resolve().parent.parent
BACKEND = Path(__file__).resolve().parent
MAX_PRODUCTS = 6
MAX_PHOTOS_PER_PRODUCT = 3
MIN_REC_SCORE = 0.42

with open(BACKEND / "ontology.json", "r", encoding="utf-8") as f:
    ONTOLOGY = json.load(f)

ALLERGENS = ONTOLOGY["allergens"]
MARKERS = ONTOLOGY["label_markers"]

# Two high-probability passes first. Other scripts are lazy fallbacks.
# The user never selects the package language.
ENGINE_CONFIG = {
    "korean":    {"rec_model": "korean_PP-OCRv5_mobile_rec",    "label": "Korean + English"},
    "latin":     {"rec_model": "latin_PP-OCRv5_mobile_rec",     "label": "Latin multilingual"},
    "arabic":    {"rec_model": "arabic_PP-OCRv5_mobile_rec",    "label": "Arabic / Persian / Urdu family"},
    "cyrillic":  {"rec_model": "cyrillic_PP-OCRv5_mobile_rec",  "label": "Cyrillic family"},
    "devanagari":{"rec_model": "devanagari_PP-OCRv5_mobile_rec","label": "Devanagari family"},
    "japanese":  {"rec_model": "PP-OCRv5_mobile_rec",           "label": "Japanese"},
    "chinese":   {"rec_model": "PP-OCRv5_mobile_rec",           "label": "Chinese + English"},
    "thai":      {"rec_model": "th_PP-OCRv5_mobile_rec",        "label": "Thai + English"},
    "greek":     {"rec_model": "el_PP-OCRv5_mobile_rec",        "label": "Greek + English"},
    "tamil":     {"rec_model": "ta_PP-OCRv5_mobile_rec",        "label": "Tamil + English"},
    "telugu":    {"rec_model": "te_PP-OCRv5_mobile_rec",        "label": "Telugu + English"},
}
PRIMARY_ENGINES = ["korean", "latin"]
FALLBACK_ENGINES = ["arabic", "cyrillic", "devanagari", "japanese", "chinese", "thai", "greek", "tamil", "telugu"]

app = FastAPI(title="ALLER AI Multilingual OCR API", version="0.9.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "https://faranaksadatsolat.github.io",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ACTIVE_ENGINE_KEY: str | None = None
_ACTIVE_ENGINE: PaddleOCR | None = None

def make_engine(engine_key: str) -> PaddleOCR:
    cfg = ENGINE_CONFIG[engine_key]
    return PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name=cfg["rec_model"],
        device="cpu",
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_recognition_batch_size=1,
    )

def clear_active_engine() -> None:
    global _ACTIVE_ENGINE_KEY, _ACTIVE_ENGINE
    if _ACTIVE_ENGINE is not None:
        _ACTIVE_ENGINE = None
        _ACTIVE_ENGINE_KEY = None
        gc.collect()

def get_primary_engine(engine_key: str) -> PaddleOCR:
    """
    Keep only ONE PaddleOCR pipeline resident at a time.

    Render Free has tight memory. Korean and Latin are still both checked,
    but sequentially instead of keeping duplicate detector/recognizer
    pipelines resident simultaneously.
    """
    global _ACTIVE_ENGINE_KEY, _ACTIVE_ENGINE
    if _ACTIVE_ENGINE is None or _ACTIVE_ENGINE_KEY != engine_key:
        clear_active_engine()
        _ACTIVE_ENGINE = make_engine(engine_key)
        _ACTIVE_ENGINE_KEY = engine_key
    return _ACTIVE_ENGINE

def normalize_arabic_persian(s: str) -> str:
    table = str.maketrans({
        "ي":"ی","ى":"ی","ئ":"ی","ك":"ک","ؤ":"و","ة":"ه","ۀ":"ه",
        "أ":"ا","إ":"ا","ٱ":"ا"
    })
    s = s.translate(table)
    s = re.sub(r"[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]", "", s)
    return s

def fold(s: str) -> str:
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    s = normalize_arabic_persian(s)
    # Strip diacritics while keeping base characters. This lets OCR "lecithine"
    # match ontology "lécithine", and similarly for many Latin labels.
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s)
                if unicodedata.category(ch) != "Mn")
    s = s.replace("’", "'").replace("`", "'")
    s = re.sub(r"\s+", " ", s).strip()
    return s

def compact(s: str) -> str:
    return re.sub(r"[\s\u200b\u200c\u200d]+", "", fold(s))

def is_word_script(term: str) -> bool:
    # Latin, Greek, Cyrillic and Devanagari usually benefit from token boundaries.
    t = fold(term)
    return bool(re.search(r"[a-z\u0370-\u03ff\u0400-\u052f\u0900-\u097f]", t))

def contains_term(text: str, term: str) -> bool:
    t, q = fold(text), fold(term)
    if not q:
        return False
    if is_word_script(q):
        return re.search(r"(?<!\w)" + re.escape(q) + r"(?!\w)", t, re.I) is not None
    return compact(q) in compact(t)

def contains_any(text: str, terms: list[str]) -> bool:
    return any(contains_term(text, x) for x in terms)

def all_aliases(allergen_id: str) -> list[tuple[str, str]]:
    out = []
    item = ALLERGENS.get(allergen_id)
    if not item:
        return out
    for lang, aliases in item["aliases"].items():
        for alias in aliases:
            out.append((lang, alias))
    return out

def dedupe_lines(lines: list[str]) -> list[str]:
    seen, out = set(), []
    for x in lines:
        key = compact(x)
        if key and key not in seen:
            seen.add(key)
            out.append(x)
    return out

def ocr_paths_dual(engine: PaddleOCR, paths: list[str]) -> tuple[list[str], list[str]]:
    """
    One OCR inference, two views:
    - safe_lines: stricter text used for allergen decisions.
    - calorie_lines: lower-threshold text used only for nutrition numbers.
    """
    safe_lines: list[str] = []
    calorie_lines: list[str] = []

    for path in paths:
        for result in engine.predict(input=path):
            try:
                texts = list(result["rec_texts"])
            except Exception:
                texts = []
            try:
                scores = list(result["rec_scores"])
            except Exception:
                scores = []

            for i, txt in enumerate(texts):
                txt = str(txt).strip()
                if not txt:
                    continue

                score = 1.0
                if i < len(scores):
                    try:
                        score = float(scores[i])
                    except Exception:
                        pass

                if score >= 0.18:
                    calorie_lines.append(txt)
                if score >= MIN_REC_SCORE:
                    safe_lines.append(txt)

    return dedupe_lines(safe_lines), dedupe_lines(calorie_lines)

def make_nutrition_variants(paths: list[str]) -> list[str]:
    """
    Retry difficult nutrition panels on an enlarged, autocontrasted,
    lightly sharpened copy. These variants are used ONLY for calorie OCR.
    """
    variants: list[str] = []

    for path in paths:
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                w, h = im.size
                longest = max(w, h)
                scale = 1.0 if longest >= 2200 else min(2.2, 2200.0 / max(1, longest))

                if scale > 1.02:
                    im = im.resize(
                        (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                        Image.Resampling.LANCZOS,
                    )

                gray = ImageOps.grayscale(im)
                gray = ImageOps.autocontrast(gray, cutoff=0.5)
                gray = gray.filter(
                    ImageFilter.UnsharpMask(radius=1.2, percent=145, threshold=2)
                )

                with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as tmp:
                    gray.save(tmp.name, format="PNG", optimize=False)
                    variants.append(tmp.name)
        except Exception:
            continue

    return variants

def ingredient_section(text: str) -> str:
    n = fold(text)
    starts = []
    for marker in MARKERS["ingredient_headings"]:
        m = fold(marker)
        p = n.find(m)
        if p >= 0:
            starts.append((p, len(m)))
    if not starts:
        return ""
    p, ln = min(starts)
    tail = n[p + ln:]
    stop_markers = MARKERS["nutrition_headings"] + [
        "storage", "best before", "customer service", "보관방법", "고객상담실",
        "保存方法", "保管方法", "barcode"
    ]
    stops = []
    for marker in stop_markers:
        x = tail.find(fold(marker))
        if x > 25:
            stops.append(x)
    if stops:
        tail = tail[:min(stops)]
    return tail[:2200]

def declaration_blocks(text: str, marker: str, radius: int = 190) -> list[str]:
    """
    Return text windows around a declaration marker. Markers may occur before
    or after the allergen list depending on language.
    """
    n = fold(text)
    m = fold(marker)
    out = []
    start = 0
    while True:
        p = n.find(m, start)
        if p < 0:
            break
        out.append(n[max(0, p-radius):min(len(n), p+len(m)+radius)])
        start = p + max(1, len(m))
    return out

def classify_alias_in_text(text: str, alias: str) -> Optional[str]:
    if not contains_term(text, alias):
        return None

    # Precautionary wording always wins for an occurrence close to a caution marker.
    for marker in MARKERS["caution_markers"]:
        for block in declaration_blocks(text, marker):
            if contains_term(block, alias):
                return "caution"

    # Direct "contains / 함유 / contient / ..." statement.
    for marker in MARKERS["direct_markers"]:
        for block in declaration_blocks(text, marker, radius=150):
            if contains_term(block, alias):
                return "direct"

    # Explicit ingredient section.
    section = ingredient_section(text)
    if section and contains_term(section, alias):
        return "direct"

    return None

def scan_profile(source_texts: dict[str, list[str]], profile: dict) -> tuple[list[dict], list[dict]]:
    direct, caution = [], []

    for engine_key, lines in source_texts.items():
        text = " ".join(lines)
        if not text:
            continue

        for allergen_id in profile.get("allergens") or []:
            item = ALLERGENS.get(allergen_id)
            if not item:
                continue

            best_direct = None
            best_caution = None
            for lang, alias in all_aliases(allergen_id):
                kind = classify_alias_in_text(text, alias)
                if kind == "direct" and best_direct is None:
                    best_direct = {
                        "allergen_id": allergen_id,
                        "allergen": item["label"],
                        "term": alias,
                        "language": lang,
                        "ocr_family": ENGINE_CONFIG[engine_key]["label"],
                    }
                elif kind == "caution" and best_caution is None:
                    best_caution = {
                        "allergen_id": allergen_id,
                        "allergen": item["label"],
                        "term": alias,
                        "language": lang,
                        "ocr_family": ENGINE_CONFIG[engine_key]["label"],
                    }

            if best_direct:
                direct.append(best_direct)
            elif best_caution:
                caution.append(best_caution)

        # Custom avoid terms are exact user-provided concepts; we do not silently
        # translate them. They are checked across every OCR family.
        for term in profile.get("custom_avoid") or []:
            term = str(term).strip()
            if not term:
                continue
            kind = classify_alias_in_text(text, term)
            hit = {
                "allergen_id": "custom",
                "allergen": "Custom avoid",
                "term": term,
                "language": "user",
                "ocr_family": ENGINE_CONFIG[engine_key]["label"],
            }
            if kind == "direct":
                direct.append(hit)
            elif kind == "caution":
                caution.append(hit)

    def dedupe(items: list[dict]) -> list[dict]:
        seen, out = set(), []
        for item in items:
            key = (item["allergen_id"], item["term"])
            if key not in seen:
                seen.add(key)
                out.append(item)
        return out

    # A direct match for an allergen supersedes a caution-only match for the same allergen.
    direct = dedupe(direct)
    direct_ids = {x["allergen_id"] for x in direct}
    caution = [x for x in dedupe(caution) if x["allergen_id"] not in direct_ids]
    return direct, caution

def label_evidence(source_texts: dict[str, list[str]]) -> dict:
    joined = " ".join(" ".join(v) for v in source_texts.values())
    ingredient = contains_any(joined, MARKERS["ingredient_headings"])
    nutrition_hits = sum(1 for x in MARKERS["nutrition_headings"] if contains_term(joined, x))
    declaration = contains_any(joined, MARKERS["direct_markers"] + MARKERS["caution_markers"])
    return {
        "ingredient": ingredient,
        "nutrition": nutrition_hits > 0,
        "declaration": declaration,
        "readable": len(compact(joined)) >= 18,
    }

def num(s: str) -> float:
    return float(str(s).replace(",", ""))

def normalize_calorie_ocr(text: str) -> str:
    """
    Nutrition-only normalization.

    IMPORTANT: unlike fold(), this keeps Korean Hangul syllables composed.
    The previous parser used NFKD through fold(), which turned 내용량/100g당
    into Jamo and made Korean calorie regexes fail.
    """
    s = unicodedata.normalize("NFKC", str(text or "")).lower()
    s = normalize_arabic_persian(s)
    s = s.replace("’", "'").replace("`", "'").replace("×", "x")
    s = re.sub(r"\bk\s*c\s*a\s*[l1i|!]\b", "kcal", s, flags=re.I)
    s = re.sub(r"\bk\s*c\s*a\s*l\b", "kcal", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return s

ENERGY_UNIT = r"(?:kcal|킬로칼로리|千卡(?:路里)?|キロカロリー)"

TOTAL_WEIGHT_PATTERNS = [
    r"총\s*내\s*용\s*[량양랑]\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"총내용[량양랑]\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:net\s*(?:wt|weight)|total\s*(?:content|weight))\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:poids\s*net|peso\s*neto|nettogewicht|peso\s*liquido|peso\s*líquido)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:peso\s*netto|netto\s*gewicht)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:масса\s*нетто|вес\s*нетто)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:الوزن\s*الصافي|الوزن\s*الصافى)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:وزن\s*خالص)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:内容量|正味量)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:净含量|淨含量)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:शुद्ध\s*वजन)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:น้ำหนักสุทธิ)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:net\s*ağırlık|net\s*agirlik)\s*[:：]?\s*([\d,.]+)\s*g\b",
    r"(?:berat\s*bersih)\s*[:：]?\s*([\d,.]+)\s*g\b",
]

def _valid_weight(v: float) -> bool:
    return 0.5 <= v <= 50000

def _valid_kcal(v: float) -> bool:
    return 1 <= v <= 1500

def _find_total_weight(n: str) -> tuple[float | None, str | None]:
    c = re.sub(r"\s+", "", n)

    for pat in TOTAL_WEIGHT_PATTERNS:
        m = re.search(pat, n, re.I) or re.search(pat, c, re.I)
        if m:
            try:
                v = num(m.group(1))
                if _valid_weight(v):
                    return v, "explicit_total_weight"
            except Exception:
                pass

    # Multipack fallback: only used if explicit total content is absent.
    for pat in [
        r"([\d,.]+)\s*g\s*x\s*(\d+)\s*(?:봉지|개|팩|packs?|pcs?|pieces?|sachets?|bars?|sticks?)",
        r"([\d,.]+)gx(\d+)(?:봉지|개|팩|packs?|pcs?|pieces?|sachets?|bars?|sticks?)",
    ]:
        m = re.search(pat, n, re.I) or re.search(pat, c, re.I)
        if m:
            try:
                unit_g = num(m.group(1))
                count = int(m.group(2))
                total = unit_g * count
                if _valid_weight(total):
                    return total, "multipack_weight"
            except Exception:
                pass

    return None, None

def _find_reference_energy(n: str) -> tuple[float | None, float | None, str | None]:
    c = re.sub(r"\s+", "", n)

    # Strong pair forms.
    pairs = [
        (rf"([\d,.]+)\s*g\s*(?:당|per|pour|por|pro)?\s*[:：]?\s*([\d,.]+)\s*{ENERGY_UNIT}\b", "g_first"),
        (rf"([\d,.]+)g(?:당|per|pour|por|pro)?[:：]?([\d,.]+){ENERGY_UNIT}", "g_first"),
        (rf"([\d,.]+)\s*{ENERGY_UNIT}\s*(?:/|per|pour|por|pro)\s*([\d,.]+)\s*g\b", "kcal_first"),
    ]

    for pat, mode in pairs:
        m = re.search(pat, n, re.I) or re.search(pat, c, re.I)
        if not m:
            continue
        try:
            if mode == "g_first":
                basis_g, kcal = num(m.group(1)), num(m.group(2))
            else:
                kcal, basis_g = num(m.group(1)), num(m.group(2))
            if _valid_weight(basis_g) and _valid_kcal(kcal):
                return basis_g, kcal, "direct_reference_pair"
        except Exception:
            pass

    # OCR often emits:
    #   100 g당
    #   485 kcal
    # as separate recognition blocks.
    hundred = (
        re.search(r"100\s*g\s*당", n, re.I)
        or re.search(r"100g당", c, re.I)
        or re.search(r"100\s*g\s*(?:per|pour|por|pro)", n, re.I)
        or re.search(r"(?:per|pour|por|pro)\s*100\s*g", n, re.I)
        or re.search(r"100\s*g", n, re.I)
    )

    if hundred:
        kcal_candidates = []
        for m in re.finditer(rf"([\d,.]+)\s*{ENERGY_UNIT}\b", n, re.I):
            try:
                v = num(m.group(1))
                if _valid_kcal(v):
                    kcal_candidates.append((m.start(), v))
            except Exception:
                pass

        if kcal_candidates:
            kcal_candidates.sort(key=lambda x: abs(x[0] - hundred.start()))
            return 100.0, kcal_candidates[0][1], "layout_100g_reference"

    # Conservative final fallback: a nutrition heading + 100 g + exactly one kcal value.
    if contains_any(n, MARKERS["nutrition_headings"]) and (
        re.search(r"100\s*g", n, re.I) or "100g" in c
    ):
        vals = []
        for m in re.finditer(rf"([\d,.]+)\s*{ENERGY_UNIT}\b", n, re.I):
            try:
                v = num(m.group(1))
                if _valid_kcal(v):
                    vals.append(v)
            except Exception:
                pass
        vals = list(dict.fromkeys(vals))
        if len(vals) == 1:
            return 100.0, vals[0], "single_kcal_with_100g_basis"

    return None, None, None

def extract_calories_from_text(text: str) -> dict:
    n = normalize_calorie_ocr(text)

    total_g, weight_method = _find_total_weight(n)
    basis_g, basis_kcal, energy_method = _find_reference_energy(n)

    explicit_total = None
    for pat in [
        rf"총\s*(?:열량|칼로리)\s*[:：]?\s*([\d,.]+)\s*{ENERGY_UNIT}\b",
        rf"(?:total\s*(?:energy|calories)|energy\s*per\s*pack)\s*[:：]?\s*([\d,.]+)\s*{ENERGY_UNIT}\b",
        rf"(?:总热量|總熱量)\s*[:：]?\s*([\d,.]+)\s*{ENERGY_UNIT}\b",
    ]:
        m = re.search(pat, n, re.I)
        if m:
            try:
                v = num(m.group(1))
                if 1 <= v <= 100000:
                    explicit_total = v
                    break
            except Exception:
                pass

    package_kcal = basis = method = None

    if explicit_total is not None:
        package_kcal = explicit_total
        basis = f"Label states total energy: {explicit_total:g} kcal"
        method = "explicit_total_energy"
    elif total_g is not None and basis_g is not None and basis_kcal is not None and basis_g > 0:
        package_kcal = basis_kcal * total_g / basis_g
        basis = f"Calculated from {basis_kcal:g} kcal / {basis_g:g} g × {total_g:g} g"
        method = f"{weight_method}+{energy_method}"

    if package_kcal is not None and 0 < package_kcal < 100000:
        package_kcal = int(round(package_kcal))
    else:
        package_kcal = None

    return {
        "package_kcal": package_kcal,
        "basis": basis,
        "total_weight_g": total_g,
        "reference_kcal": basis_kcal,
        "reference_g": basis_g,
        "method": method,
    }

def extract_best_calories(source_texts: dict[str, list[str]]) -> dict:
    candidates = []

    for engine_key, lines in source_texts.items():
        if not lines:
            continue
        c = extract_calories_from_text(" ".join(lines))
        if c["package_kcal"] is not None:
            c["ocr_family"] = ENGINE_CONFIG.get(engine_key, {}).get("label", engine_key)
            candidates.append(c)

    merged_text = " ".join(" ".join(lines) for lines in source_texts.values() if lines)
    if merged_text:
        c = extract_calories_from_text(merged_text)
        if c["package_kcal"] is not None:
            c["ocr_family"] = "Merged multilingual OCR"
            candidates.append(c)

    if not candidates:
        return {
            "package_kcal": None,
            "basis": None,
            "total_weight_g": None,
            "reference_kcal": None,
            "reference_g": None,
            "method": None,
        }

    def rank(c: dict):
        method = c.get("method") or ""
        return (
            "explicit_total_energy" in method,
            "explicit_total_weight" in method,
            "direct_reference_pair" in method,
            c.get("total_weight_g") is not None,
            c.get("reference_kcal") is not None,
        )

    candidates.sort(key=rank, reverse=True)
    return candidates[0]

def semantic_result(pid: int, source_texts: dict[str, list[str]], profile: dict, exhaustive: bool, calorie_source_texts: dict[str, list[str]] | None = None) -> dict:
    direct, caution = scan_profile(source_texts, profile)
    evidence = label_evidence(source_texts)
    calories = extract_best_calories(calorie_source_texts or source_texts)
    used = [ENGINE_CONFIG[k]["label"] for k, v in source_texts.items() if v]

    base = {
        "product_id": pid,
        "label": f"Product {pid}",
        "calories": calories,
        "ocr_families_used": used,
        "multilingual_exhaustive": exhaustive,
        "direct_matches": direct,
        "caution_matches": caution,
    }

    if direct:
        names = ", ".join(dict.fromkeys(x["allergen"] for x in direct))
        return {
            **base, "status": "conflict", "title": "Conflict detected",
            "message": f"Selected ingredient conflict detected: {names}.",
            "matched_label_term": direct[0]["term"],
            "mapped_to": direct[0]["allergen"],
            "reason": "Detected as a listed ingredient or direct allergen declaration.",
        }

    if caution:
        names = ", ".join(dict.fromkeys(x["allergen"] for x in caution))
        return {
            **base, "status": "caution", "title": "Caution",
            "message": f"Precautionary cross-contact warning detected: {names}.",
            "matched_label_term": caution[0]["term"],
            "mapped_to": caution[0]["allergen"],
            "reason": "Detected in a precautionary statement such as may contain / 혼입가능.",
        }

    if not evidence["readable"]:
        return {
            **base, "status": "unreadable", "title": "Please retake the label photo",
            "message": "Not enough readable label text was detected."
        }

    if evidence["ingredient"]:
        return {
            **base, "status": "no_listed_conflict", "title": "No listed conflict detected",
            "message": "No selected conflict was found in the ingredient text checked by the multilingual engine."
        }

    if evidence["declaration"]:
        return {
            **base, "status": "ingredient_not_confirmed", "title": "Ingredient list not confirmed",
            "message": "An allergen declaration was checked, but the complete ingredient list was not verified."
        }

    if evidence["nutrition"]:
        return {
            **base, "status": "nutrition_panel", "title": "Nutrition panel detected",
            "message": "Nutrition information was read, but the complete ingredient list was not confirmed."
        }

    return {
        **base, "status": "ingredient_not_confirmed", "title": "Ingredient list not confirmed",
        "message": "The multilingual OCR engine could not confidently confirm an ingredient list."
    }

@app.get("/")
def home():
    return FileResponse(ROOT / "index.html")

@app.get("/api/health")
def health():
    return {
        "ok": True,
        "engine": "PaddleOCR PP-OCRv5 explicit-mobile multilingual router",
        "mode": "local-or-cloud",
        "version": "0.9.3",
        "language_selection_required": False,
        "primary_ocr_families": PRIMARY_ENGINES,
        "fallback_ocr_families": FALLBACK_ENGINES,
        "ontology_languages": sorted({
            lang
            for item in ALLERGENS.values()
            for lang in item["aliases"].keys()
        }),
        "multi_product": True,
        "calorie_estimation": True,
        "calorie_parser": "v3-multilingual-recovery",
    }

@app.post("/api/analyze")
async def analyze(
    profile: str = Form(...),
    images: List[UploadFile] = File(...),
    product_ids: Optional[List[int]] = Form(None),
):
    try:
        p = json.loads(profile)
    except Exception:
        return {"status": "backend_error", "message": "Invalid local profile data."}

    temp_paths: list[str] = []
    try:
        ids = product_ids or [1] * len(images)
        if len(ids) != len(images):
            return {"status": "backend_error", "message": "Image/product grouping data is inconsistent."}

        grouped: dict[int, list[str]] = {}
        for pid, upload in zip(ids, images):
            pid = int(pid)
            if pid < 1 or pid > MAX_PRODUCTS:
                continue
            grouped.setdefault(pid, [])
            if len(grouped[pid]) >= MAX_PHOTOS_PER_PRODUCT:
                continue

            suffix = Path(upload.filename or "image.jpg").suffix or ".jpg"
            data = await upload.read()
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(data)
                path = tmp.name
            temp_paths.append(path)
            grouped[pid].append(path)

        if not grouped:
            return {"status": "backend_error", "message": "No valid product images were supplied."}

        sources: dict[int, dict[str, list[str]]] = {pid: {} for pid in grouped}
        calorie_sources: dict[int, dict[str, list[str]]] = {pid: {} for pid in grouped}

        # Stage 1: Korean + Latin multilingual. These cover the common Korea/international case.
        for engine_key in PRIMARY_ENGINES:
            engine = get_primary_engine(engine_key)
            for pid, paths in grouped.items():
                safe_lines, calorie_lines = ocr_paths_dual(engine, paths)
                sources[pid][engine_key] = safe_lines
                calorie_sources[pid][engine_key] = calorie_lines

        # Products with a positive or precautionary result can stop early.
        unresolved = set()
        for pid in grouped:
            direct, caution = scan_profile(sources[pid], p)
            evidence = label_evidence(sources[pid])
            # If Korean/Latin OCR has already confirmed an ingredient list,
            # the script is sufficiently resolved for a conservative negative.
            # Only unknown/unconfirmed labels enter the expensive fallback router.
            if not direct and not caution and not evidence["ingredient"]:
                unresolved.add(pid)

        # Stage 2: automatic script-family fallbacks. No language choice is shown to the user.
        # A negative result is only returned after all fallback families have been attempted.
        if unresolved:
            clear_active_engine()

        for engine_key in FALLBACK_ENGINES:
            if not unresolved:
                break
            try:
                engine = make_engine(engine_key)
            except Exception:
                # One optional script-family model failing to initialize should not take down
                # the entire request. The final result will remain conservative.
                continue

            resolved_now = []
            for pid in list(unresolved):
                try:
                    safe_lines, calorie_lines = ocr_paths_dual(engine, grouped[pid])
                    sources[pid][engine_key] = safe_lines
                    calorie_sources[pid][engine_key] = calorie_lines
                except Exception:
                    sources[pid][engine_key] = []
                    calorie_sources[pid][engine_key] = []

                direct, caution = scan_profile(sources[pid], p)
                if direct or caution:
                    resolved_now.append(pid)

            for pid in resolved_now:
                unresolved.discard(pid)

            del engine
            gc.collect()

        # Nutrition-only recovery: retry difficult labels at larger scale,
        # but only when a nutrition panel was actually detected.
        for pid in sorted(grouped):
            if extract_best_calories(calorie_sources[pid]).get("package_kcal") is not None:
                continue
            if not label_evidence(sources[pid])["nutrition"]:
                continue

            enhanced_paths = make_nutrition_variants(grouped[pid])
            temp_paths.extend(enhanced_paths)

            for engine_key in PRIMARY_ENGINES:
                if not enhanced_paths:
                    break
                try:
                    engine = get_primary_engine(engine_key)
                    _, recovered = ocr_paths_dual(engine, enhanced_paths)
                    existing = calorie_sources[pid].get(engine_key, [])
                    calorie_sources[pid][engine_key] = dedupe_lines(existing + recovered)
                except Exception:
                    pass

        products = []
        for pid in sorted(grouped):
            # Exhaustive means every fallback was attempted for a still-negative product.
            exhaustive = pid in unresolved
            products.append(semantic_result(pid, sources[pid], p, exhaustive=exhaustive, calorie_source_texts=calorie_sources[pid]))

        known = [
            x["calories"]["package_kcal"]
            for x in products
            if x.get("calories", {}).get("package_kcal") is not None
        ]
        total_kcal = sum(known) if known else None
        complete = bool(products) and len(known) == len(products)

        priority = {
            "backend_error": 6, "conflict": 5, "caution": 4,
            "ingredient_not_confirmed": 3, "unreadable": 3,
            "nutrition_panel": 2, "no_listed_conflict": 1,
        }
        overall = max(products, key=lambda x: priority.get(x["status"], 0))["status"]

        return {
            "status": overall,
            "products": products,
            "summary": {
                "product_count": len(products),
                "total_package_kcal": total_kcal,
                "calories_complete": complete,
                "calorie_products_count": len(known),
                "automatic_multilingual": True,
            },
        }

    except Exception as exc:
        return {
            "status": "backend_error",
            "message": f"{type(exc).__name__}: {str(exc)[:700]}",
        }
    finally:
        # Release Paddle predictors after each request. Model files remain cached
        # for the lifetime of the Render instance, but RAM is returned.
        clear_active_engine()
        for path in temp_paths:
            try:
                os.remove(path)
            except OSError:
                pass
