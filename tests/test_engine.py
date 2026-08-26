from backend.engine import evaluate_label

def test_korean_caseinate_maps_to_milk():
    s, d, c = evaluate_label("원재료명: 카제인나트륨, 설탕", ["milk"])
    assert s == "conflict"
    assert any(x["allergen"] == "Milk" for x in d)

def test_may_contain_peanut_is_caution():
    s, d, c = evaluate_label("Ingredients: sugar. May contain peanut.", ["peanut"])
    assert s == "caution"

def test_unrelated_label_is_no_conflict():
    s, d, c = evaluate_label("Ingredients: sugar, cocoa mass, salt", ["milk"])
    assert s == "no_listed_conflict"

def test_model_evidence_must_be_literal():
    ev = [{
        "quoted_label_term": "whey",
        "allergen_group": "milk",
        "relationship": "derived",
        "reason": "whey is milk-derived"
    }]
    s, d, c = evaluate_label("Ingredients: sugar, cocoa", ["milk"], model_evidence=ev)
    assert s == "no_listed_conflict"

def test_model_evidence_literal_is_accepted():
    ev = [{
        "quoted_label_term": "mysterious-casein-term",
        "allergen_group": "milk",
        "relationship": "derived",
        "reason": "mapped by extraction model"
    }]
    s, d, c = evaluate_label("Ingredients: mysterious-casein-term, sugar", ["milk"], model_evidence=ev)
    assert s == "conflict"
