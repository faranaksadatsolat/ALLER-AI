ALLER AI v2.0 — SAFETY-FIRST PADDLEOCR

WHAT CHANGED
============
This is not another Tesseract patch.

1. OCR ENGINE
- Replaced Tesseract as the decision OCR with the official PaddleOCR.js browser SDK.
- Uses PP-OCRv5 on-device in the browser.
- Scans the language families represented by the current ontology:
  English, Korean, Arabic/Persian, Latin multilingual, Cyrillic,
  Devanagari, Japanese, Chinese, and Thai.
- Greek/Tamil/Telugu OCR families are added automatically when a custom avoid term
  uses those scripts.
- Images are automatically tested at 0/90/270/180 degrees until orientation is
  strongly supported by target-script OCR evidence.
- One OCR model is loaded at a time to reduce browser memory pressure.

2. SAFETY GATE
- "No listed conflict" is blocked unless EVERY required OCR family completed.
- It is also blocked if a substantial script/language panel was detected but its
  ingredient/allergen section could not be verified.
- Explicit language hints such as PER / ARB / RU force the corresponding panel
  family into the verification gate.
- A low-context allergen mention never becomes a negative result.
- Any missing model or uncertain coverage produces "Unable to verify".

3. ALLERGEN DECISION
- LLM is not used for the allergy decision.
- Canonical ontology + deterministic rules decide Conflict / Caution / Unable to verify /
  No listed conflict.
- Direct ingredient/declaration overrides precautionary cross-contact for the same allergen.
- OCR line confidence is used internally. Raw OCR and numeric confidence remain hidden
  from the consumer result.

4. LEARNING
- "Teach / correct this product" stores exact label text locally in this browser.
- Learned corrections are POSITIVE-ONLY:
  they may escalate a future result to Conflict/Caution, but they can NEVER certify
  "No listed conflict".
- A perceptual image hash links a correction to visually similar product photos.
- "Export learning data" produces a JSON dataset containing corrections and OCR snapshots.
  This can later become supervised training/fine-tuning data for a real recognition model.
- This is intentionally safer than autonomous self-training from unverified predictions.

5. CALORIES
- Keeps deterministic full-package calorie parsing.
- Regression:
  253 g + 485 kcal / 100 g = 1227 kcal.
- 2000 kcal / 8700 kJ daily-reference text is not treated as product energy.

DEPLOY TO GITHUB PAGES
======================
Replace/copy these items into the repository root:
- index.html
- src/   (entire folder)

Then:
  git add index.html src
  git commit -m "Upgrade ALLER AI to safety-first PaddleOCR"
  git push origin main

Do NOT upload node_modules.
package.json and tests/ are optional for deployment but recommended to keep in the repo.

TEST LOCALLY
============
No npm install is required for the deterministic tests:
  node tests/engine.test.mjs

For the website, serve the folder over HTTP (do not open index.html as file://).
GitHub Pages is sufficient.

IMPORTANT FIRST-RUN BEHAVIOR
============================
The first thorough scan downloads the PaddleOCR.js SDK and OCR model assets.
It can therefore take noticeably longer than later scans. Inference itself happens
on the user's device. ALLER AI does not send product photos to Render.

SAFETY STATUS
=============
This remains a prototype, not a medical safety guarantee. The architecture is designed
to fail closed: uncertainty produces "Unable to verify", not a reassuring negative result.
