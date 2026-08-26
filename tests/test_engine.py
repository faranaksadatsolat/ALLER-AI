from backend.engine import evaluate_label

def test_caseinate():
    status, direct, caution = evaluate_label("원재료명: 카제인나트륨, 설탕", ["milk"])
    assert status == "conflict"

def test_may_contain():
    status, direct, caution = evaluate_label("Ingredients: sugar. May contain peanut.", ["peanut"])
    assert status == "caution"

def test_no_conflict():
    status, direct, caution = evaluate_label("Ingredients: sugar, cocoa, salt", ["milk"])
    assert status == "no_listed_conflict"

def test_model_evidence_must_be_grounded():
    evidence=[{
        "quoted_label_term":"whey",
        "allergen_group":"milk",
        "relationship":"derived",
        "reason":"whey is milk derived"
    }]
    status,_,_=evaluate_label("Ingredients: sugar, cocoa",["milk"],model_evidence=evidence)
    assert status=="no_listed_conflict"
