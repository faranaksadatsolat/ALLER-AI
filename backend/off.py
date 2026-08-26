import re
import requests
from difflib import SequenceMatcher

BASE = "https://world.openfoodfacts.org"
HEADERS = {"User-Agent": "ALLER-AI/0.1 (research prototype)"}

def get_by_barcode(code: str):
    if not code:
        return None
    url = f"{BASE}/api/v3/product/{code}"
    params = {"fields": "code,product_name,brands,ingredients_text,allergens,traces"}
    r = requests.get(url, params=params, headers=HEADERS, timeout=10)
    if not r.ok:
        return None
    data = r.json()
    return data.get("product") or data

def _norm(s):
    return re.sub(r"[^a-z0-9가-힣]+"," ",(s or "").lower()).strip()

def _score(query, candidate):
    q, c = _norm(query), _norm(candidate)
    if not q or not c:
        return 0.0
    return SequenceMatcher(None, q, c).ratio()

def search_exactish(brand: str | None, product_name: str | None):
    """
    Legacy OFF full-text endpoint used conservatively.
    We accept a result only when extracted visible brand+product text closely matches candidate.
    """
    query = " ".join(x for x in [brand, product_name] if x).strip()
    if len(query) < 4:
        return None

    r = requests.get(
        f"{BASE}/cgi/search.pl",
        params={
            "search_terms": query,
            "search_simple": 1,
            "action": "process",
            "json": 1,
            "page_size": 5,
            "fields": "code,product_name,brands,ingredients_text,allergens,traces",
        },
        headers=HEADERS,
        timeout=12,
    )
    if not r.ok:
        return None

    products = r.json().get("products", [])
    scored = []
    for p in products:
        candidate = " ".join([p.get("brands",""), p.get("product_name","")])
        scored.append((_score(query, candidate), p))
    scored.sort(key=lambda x: x[0], reverse=True)

    if not scored or scored[0][0] < 0.82:
        return None

    top_score, top = scored[0]
    if len(scored) > 1 and top_score - scored[1][0] < 0.08:
        return None
    return top
