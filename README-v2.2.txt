ALLER AI v2.2.0 — CACHE + CALORIE SAFETY GUARD

This version addresses two issues observed in the live test:

1. OLD CODE STILL RUNNING
- v2.1 has 7 mandatory OCR families.
- A live result showing 3/9 proves the browser/page is still running v2.0 code.
- v2.2 shows an explicit visible version badge in the header.
- Module URLs include ?v=2.2.0 to force GitHub Pages/browser cache refresh.

Expected live header:
  ALLER AI v2.2.0

Expected safety denominator:
  /7
(not /9)

2. CALORIE OCR CORRUPTION
Observed:
  printed: 253 g
  OCR/parser path: 8253 g
  bad output: 40027 kcal

Fix:
- Multipack evidence such as 5.8 g × 44 is parsed first.
- Printed total weight is cross-checked against multipack weight.
- If OCR prepends a stray digit (8253 vs ~255), numeric suffix recovery can
  recover 253 only when independent multipack evidence supports it.
- Without independent support, extreme computed calorie values are rejected
  rather than displayed.
- Exact regression:
    8253 g + (5.8 g × 44) + 485 kcal/100g
    -> recover 253 g
    -> 1227 kcal

DEPLOY
------
Replace all repository files with this package, then:

  git add .
  git commit -m "Fix cache versioning and calorie sanity guard v2.2"
  git push origin main

After GitHub Pages deploys:
- open the site
- press Ctrl+Shift+R (or Ctrl+F5)
- VERIFY the header visibly says v2.2.0
- only then run the product test

If the header does not say v2.2.0, do not trust the test result: the old app is still loaded.
