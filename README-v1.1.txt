ALLER AI v1.1.0 — STABLE FAST MULTILINGUAL

This version deliberately returns to the proven v1 browser OCR path.

Why:
- The experimental PaddleOCR browser branch was too slow in the real test.
- Only part of the model set initialized.
- A prior manual learning correction could contaminate the benchmark.

Runtime:
1. Korean + English + French/Latin OCR first.
2. Rotation only when the primary read needs it.
3. Explicit multilingual tags trigger only the relevant extra family:
   PER / ARB -> Persian + Arabic
   RU        -> Russian / Cyrillic
   JPN/CHN   -> Japanese / Chinese
   HI        -> Hindi / Devanagari
   TH        -> Thai
4. Generic language fallback only runs if no useful ingredient/declaration evidence
   has been verified yet.
5. The scan stops per product as soon as useful label evidence is found.

Safety:
- If an explicitly labelled alternate-language panel cannot be verified, a reassuring
  negative result is blocked.
- Manual learning corrections do NOT affect live allergen decisions in this build.

Calories:
- The observed 8253 g OCR corruption is cross-checked against 5.8 g × 44.
- This can recover 253 g -> 1227 kcal for the Korean test label.
- Unsupported extreme computed calories are suppressed.

Deploy:
  git add .
  git commit -m "Restore stable fast multilingual OCR v1.1"
  git push origin main

After deploy, hard-refresh and verify the header visibly says v1.1.0.
