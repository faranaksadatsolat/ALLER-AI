import os
from google import genai
from google.genai import types
from .models import VisionExtraction

SYSTEM_PROMPT = """
You are the extraction layer of ALLER AI, a packaged-food ingredient assistant.

Safety-critical rules:
1. Never invent ingredients that are not visibly supported by the image.
2. Copy ingredient/allergen terms exactly into quoted_label_term.
3. If the photo is only the front of a product, identify brand/product/variant if visible,
   but DO NOT infer its ingredients from the product type.
4. Set ingredient_list_complete=true only when the complete ingredient panel appears readable.
5. Use image_quality=poor if text is too small, blurred, blocked, distorted, or strongly reflective.
6. evidence may map an EXACT visible label term to a user-selected allergen when the relationship
   is well-established (e.g. sodium caseinate -> milk). Evidence is only a candidate; a deterministic
   verifier will independently require the quoted term to exist in the extracted text.
7. Preserve the label language. Do not translate ingredient_text.
8. A front-of-pack photo may contain a barcode; return it if readable.
"""

def extract_with_gemini(images: list[tuple[bytes,str]], profile: dict) -> VisionExtraction:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    model = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")
    client = genai.Client(api_key=api_key)

    parts = [
        SYSTEM_PROMPT,
        "User profile JSON: " + __import__("json").dumps(profile, ensure_ascii=False),
        "Analyze all supplied images as views of the same packaged-food item."
    ]
    for data, mime in images:
        parts.append(types.Part.from_bytes(data=data, mime_type=mime))

    response = client.models.generate_content(
        model=model,
        contents=parts,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=VisionExtraction,
            temperature=0.0,
        ),
    )
    return VisionExtraction.model_validate_json(response.text)
