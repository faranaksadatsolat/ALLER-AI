import re
import unicodedata
from typing import Iterable

ALLERGENS = {
    "milk": {
        "label": "Milk",
        "direct": {
            "milk","우유","유제품","분유","전지분유","탈지분유","유크림",
            "شیر","لبنیات","حليب","ألبان","牛乳","牛奶","lait","milch","leche"
        },
        "derived": {
            "whey","whey powder","whey protein","casein","caseinate","sodium caseinate",
            "calcium caseinate","milk powder","skim milk powder","whole milk powder",
            "butter","buttermilk","cream","cheese","yogurt",
            "유청","유청분말","유청단백","카제인","카제인나트륨","버터","크림","치즈","요거트"
        }
    },
    "egg": {
        "label": "Egg",
        "direct": {"egg","eggs","계란","달걀","난류","تخم مرغ","بيض","卵","鸡蛋","雞蛋","oeuf","ei","huevo"},
        "derived": {"egg white","egg yolk","albumen","ovalbumin","난백","난황","알부민"}
    },
    "peanut": {
        "label": "Peanut",
        "direct": {"peanut","peanuts","groundnut","땅콩","بادام زمینی","فول سوداني","落花生","花生"},
        "derived": {"peanut flour","peanut powder","peanut butter","땅콩분말","땅콩버터"}
    },
    "tree_nuts": {
        "label": "Tree nuts",
        "direct": {
            "almond","walnut","cashew","pistachio","hazelnut","pecan","macadamia","brazil nut",
            "아몬드","호두","캐슈넛","피스타치오","헤이즐넛","피칸","마카다미아",
            "بادام","گردو","پسته","فندق","کاجو","اللوز","الجوز","الفستق","البندق","الكاجو",
            "アーモンド","くるみ","カシューナッツ","ピスタチオ","杏仁","核桃","腰果","开心果"
        },
        "derived": set()
    },
    "soy": {
        "label": "Soy",
        "direct": {"soy","soya","soybean","대두","سویا","فول الصويا","大豆","黄豆","soja"},
        "derived": {"soy lecithin","soya lecithin","soy protein","soy flour","대두레시틴","대두단백","콩가루"}
    },
    "wheat": {
        "label": "Wheat",
        "direct": {"wheat","밀","소맥","گندم","قمح","小麦","小麥","blé","weizen","trigo"},
        "derived": {"wheat flour","flour wheat","밀가루","소맥분","wheat gluten","밀글루텐"}
    },
    "sesame": {
        "label": "Sesame",
        "direct": {"sesame","sesame seed","참깨","کنجد","سمسم","ごま","芝麻","sésame","sesam","sésamo"},
        "derived": {"tahini","sesame oil","참기름","ارده","طحينة"}
    },
    "fish": {
        "label": "Fish",
        "direct": {"fish","생선","어류","ماهی","سمك","魚","鱼","poisson","fisch","pescado"},
        "derived": {"anchovy","tuna","salmon","cod","멸치","참치","연어","대구"}
    },
    "shellfish": {
        "label": "Shellfish",
        "direct": {
            "shrimp","prawn","crab","lobster","shellfish","crustacean",
            "새우","게","랍스터","갑각류","میگو","خرچنگ","روبيان","جمبري","سرطان البحر",
            "えび","かに","エビ","カニ","虾","蝦","蟹"
        },
        "derived": set()
    }
}

MAY_CONTAIN = [
    "may contain","may contain traces","traces of","processed in a facility",
    "manufactured in a facility","shared equipment",
    "함유 가능","혼입 가능","같은 제조시설","동일 제조시설","같은 설비",
    "ممکن است حاوی","قد يحتوي","قد يحتوي على آثار","含む可能性","可能含有"
]

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"[\[\]{}(),:;|/\\]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def term_present(text: str, term: str) -> bool:
    return normalize(term) in normalize(text)

def precautionary_context(text: str, term: str) -> bool:
    t, q = normalize(text), normalize(term)
    pos = t.find(q)
    while pos >= 0:
        ctx = t[max(0, pos - 120):pos + len(q) + 25]
        if any(normalize(x) in ctx for x in MAY_CONTAIN):
            return True
        pos = t.find(q, pos + 1)
    return False

def _dedupe(items):
    seen, out = set(), []
    for x in items:
        k = (x["allergen"], normalize(x["matched_term"]), x["relationship"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    return out

def evaluate_label(text: str, selected_allergens: Iterable[str], custom_avoid=(), model_evidence=None):
    selected = set(selected_allergens or [])
    direct, caution = [], []

    for aid in selected:
        spec = ALLERGENS.get(aid)
        if not spec:
            continue
        for rel, terms in [("direct", spec["direct"]), ("derived", spec["derived"])]:
            for term in terms:
                if term_present(text, term):
                    hit = {"allergen": spec["label"], "matched_term": term, "relationship": rel}
                    (caution if precautionary_context(text, term) else direct).append(hit)

    for term in custom_avoid or []:
        if term and term_present(text, term):
            hit = {"allergen": "Custom avoid", "matched_term": term, "relationship": "direct"}
            (caution if precautionary_context(text, term) else direct).append(hit)

    # Model-derived semantic candidates are allowed only when the model quotes
    # a literal term that is actually present in the extracted source text.
    for ev in model_evidence or []:
        aid = (ev.get("allergen_group") or "").strip().lower().replace(" ", "_")
        quote = (ev.get("quoted_label_term") or "").strip()
        rel = ev.get("relationship") or "none"
        if aid not in selected or not quote or not term_present(text, quote):
            continue
        label = ALLERGENS.get(aid, {}).get("label", aid.replace("_"," ").title())
        hit = {
            "allergen": label,
            "matched_term": quote,
            "relationship": rel,
            "reason": ev.get("reason","")
        }
        if rel == "possible_cross_contact" or precautionary_context(text, quote):
            caution.append(hit)
        elif rel in ("direct","derived"):
            direct.append(hit)

    direct, caution = _dedupe(direct), _dedupe(caution)
    if direct:
        return "conflict", direct, caution
    if caution:
        return "caution", direct, caution
    return "no_listed_conflict", [], []
