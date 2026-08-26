from backend.main import extract_calories_from_text

CASES = [
    ("exact Korean", "영양정보 총 내용량 253 g(5.8 g x 44봉지) 100 g당 485 kcal", 1227),
    ("split OCR", "영양정보\n총 내용량 253 g\n5.8 g x 44봉지\n100 g당\n485 kcal", 1227),
    ("compact OCR", "영양정보 총내용량253g 100g당 485kcal", 1227),
    ("kcal I-confusion", "영양정보 총내용량 253 g 100 g당 485 kcaI", 1227),
    ("kcal 1-confusion", "영양정보 총내용량 253 g 100 g당 485 kca1", 1227),
    ("내용량 OCR variant", "영양정보 총내용양 253 g 100 g당 485 kcal", 1227),
]

for name, sample, expected in CASES:
    result = extract_calories_from_text(sample)
    assert result["package_kcal"] == expected, (name, result)
    print(f"PASS {name}: {result['package_kcal']} kcal")

print("All calorie regression tests passed.")
