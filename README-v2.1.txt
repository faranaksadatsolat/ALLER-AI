ALLER AI v2.1 — FAST SAFETY ROUTER

WHY THIS VERSION
================
v2.0 was fail-closed, but the first real browser test was too slow and only 3/9
OCR families initialized. v2.1 fixes both architecture problems.

PERFORMANCE CHANGES
===================
- 7 mandatory base OCR families instead of 9:
  Latin, Korean, Arabic/Persian, Cyrillic, Devanagari, Chinese/Japanese, Thai.
- Uses explicit official PP-OCRv5 model names instead of relying on lang routing.
- Latin runs first because it often detects multilingual panel tags (PER/ARB/RU).
- If PER or ARB is seen, Arabic/Persian OCR is moved to the front immediately.
- If RU is seen, Cyrillic is prioritized.
- The first strong OCR family locks photo rotation; later families run only one angle.
- Latin/Korean/Arabic models remain warm in browser memory for later products/scans.
- Less common models are disposed after use.
- A verified direct Conflict is terminal for that product, so unrelated OCR models
  are not loaded after the highest-risk answer is already known.
- Negative results still require the full safety gate. Safety is not traded for speed.

MODEL SELECTION
===============
Detection:
  PP-OCRv5_mobile_det

Recognition:
  latin_PP-OCRv5_mobile_rec
  korean_PP-OCRv5_mobile_rec
  arabic_PP-OCRv5_mobile_rec
  cyrillic_PP-OCRv5_mobile_rec
  devanagari_PP-OCRv5_mobile_rec
  PP-OCRv5_mobile_rec (Chinese/Japanese)
  th_PP-OCRv5_mobile_rec

Optional custom-script models:
  el_PP-OCRv5_mobile_rec
  ta_PP-OCRv5_mobile_rec
  te_PP-OCRv5_mobile_rec

SAFETY
======
- Direct Conflict: may stop early because no lower result can override it.
- Caution: does NOT stop early because another language panel may contain a direct conflict.
- No listed conflict: still blocked until every required family finishes and the coverage
  gate is satisfied.
- Model failure => Unable to verify.
- Generic dairy aliases are context protected. Split OCR lines such as
  "COCOA" / "BUTTER" do not become Milk.

LEARNING
========
Local correction/export remains positive-only. A correction can raise risk but can never
create a negative safety result.

DEPLOY
======
Replace the repository files with this package and:
  git add .
  git commit -m "Optimize ALLER AI safety OCR routing v2.1"
  git push origin main
