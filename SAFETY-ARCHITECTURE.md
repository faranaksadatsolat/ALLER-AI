# ALLER AI v2.0 Safety Architecture

## Safety invariant

**A negative allergen result is never inferred from absence of a detected word alone.**

`No listed conflict` requires all of the following:

1. Every OCR family required by the current ontology completed successfully.
2. At least one ingredient or allergen-declaration region is verified with sufficient OCR quality.
3. Any script family that produces substantial readable text is itself verified for an ingredient/declaration context.
4. Explicit multilingual panel hints (for example `PER`, `ARB`, `RU`) are not left unverified.
5. No direct, cautionary, or unresolved selected-allergen mention remains.

Otherwise the result is `Unable to verify`.

## OCR architecture

The browser uses the official PaddleOCR.js SDK with PP-OCRv5. The scan is model-family based rather than asking the user to select a package language.

Current ontology coverage maps to:

| Family | Paddle `lang` | Main coverage |
|---|---|---|
| English | `en` | English |
| Korean | `korean` | Korean + English |
| Arabic/Persian | `fa` | Persian / Arabic-script family |
| Latin multilingual | `fr` | French, German, Spanish, Italian, Portuguese, Dutch, Turkish, Indonesian, etc. |
| Cyrillic | `ru` | Russian / East Slavic |
| Devanagari | `hi` | Hindi-family scripts |
| Japanese | `japan` | Japanese |
| Chinese | `ch` | Chinese |
| Thai | `th` | Thai |

One model is resident at a time.

## Orientation

Each photo keeps its own orientation state. Until orientation is strongly supported, the current model checks 0°, 90°, 270°, and 180°. Orientation is locked only when target-script characters and recognition confidence are both substantial.

## Confidence policy

OCR confidence is used internally; it is not exposed as a consumer-facing safety percentage.

- A single strong direct/declaration match can establish a conflict.
- Lower-confidence evidence needs agreement from more than one OCR family.
- An allergen mention outside a verified ingredient/declaration context blocks a negative result.
- Model failures block a negative result.

## Learning policy

The local learning subsystem is deliberately **monotonic for safety**.

A user correction can:
- add a positive Conflict/Caution signal for the same or perceptually similar product image;
- be exported as supervised training data.

A user correction cannot:
- remove an OCR conflict;
- certify a product as free of a selected allergen;
- bypass the multilingual coverage gate.

This prevents self-training errors from gradually turning uncertainty into false reassurance.

## Future model learning

The exported JSON dataset can later be used to build a reviewed training corpus for:
- OCR correction models,
- language-panel routing,
- ingredient-heading detection,
- product-specific label templates.

Any future learned model should remain behind the deterministic safety gate and should not be allowed to override verified allergen evidence.


## v2.1 Fast safety router

v2.1 reduces redundant browser inference without weakening negative-result safety:
- explicit PP-OCRv5 model names are used;
- 9 base pipelines are collapsed into 7 recognition families;
- Latin OCR is used as the routing pass because multilingual packages often expose
  labels such as PER / ARB / RU in Latin characters;
- hinted families are promoted immediately;
- a strong orientation lock prevents every later family from testing four rotations;
- a verified direct Conflict is terminal for that product;
- negative results still require full mandatory-family coverage.
