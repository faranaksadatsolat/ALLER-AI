import re
import requests
from difflib import SequenceMatcher

BASE = "https://world.openfoodfacts.org"
HEADERS = {"User-Agent": "ALLER-AI/0.1 research prototype"}

def get_by_barcode(code: str | None):
    if not code:
        return None
    r = requests.get(
        f"{BASE}/api/v3/product/{code}",
        params={"fields":"code,product_name,brands,ingredients_text,allergens,traces"},
        headers=HEADERS,
        timeout=12
    )
    if not r.ok:
        return None
    data = r.json()
    return data.get("product") or None

def _norm(s):
    return re.sub(r"[^a-z0-9가-힣]+"," ",(s or "").lower()).strip()

def _similar(a,b):
    a,b=_norm(a),_norm(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None,a,b).ratio()

def search_exactish(brand: str | None, product_name: str | None):
    query = " ".join(x for x in [brand,product_name] if x).strip()
    if len(query) < 4:
        return None

    r = requests.get(
        f"{BASE}/cgi/search.pl",
        params={
            "search_terms":query,
            "search_simple":1,
            "action":"process",
            "json":1,
            "page_size":5,
            "fields":"code,product_name,brands,ingredients_text,allergens,traces"
        },
        headers=HEADERS,
        timeout=12
    )
    if not r.ok:
        return None

    scored=[]
    for p in r.json().get("products",[]):
        candidate=" ".join([p.get("brands",""),p.get("product_name","")])
        scored.append((_similar(query,candidate),p))
    scored.sort(key=lambda x:x[0],reverse=True)

    # Conservative acceptance: high similarity and non-ambiguous top result.
    if not scored or scored[0][0] < 0.84:
        return None
    if len(scored)>1 and scored[0][0]-scored[1][0] < 0.08:
        return None
    return scored[0][1]
