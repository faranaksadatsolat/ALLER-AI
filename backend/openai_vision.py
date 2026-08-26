import base64
import json
import os
import requests

from .models import VisionExtraction

OPENAI_URL = "https://api.openai.com/v1/responses"

SYSTEM_PROMPT = """
You are the extraction layer of ALLER AI, a packaged-food ingredient assistant.

This is safety-sensitive. Follow these rules:
1. Never invent an ingredient that is not visibly supported by the supplied image(s).
2. Copy visible ingredient/allergen phrases exactly into ingredient_text and quoted_label_term.
3. If an image shows only the product front or an individual unwrapped food item, identify brand/product/variant only when visibly supported. DO NOT infer ingredients from product category or appearance.
4. ingredient_list_complete=true only when the COMPLETE ingredient panel is visible and readable across the supplied views.
5. image_quality=poor when relevant text is too small, blurred, blocked, distorted, cropped, or strongly reflective.
6. evidence may map an EXACT visible ingredient term to a user-selected allergen only when the relationship is well-established, e.g. sodium caseinate -> milk. The backend will independently verify that the quoted term literally exists in the extracted label text.
7. Preserve the original label language in ingredient_text.
8. Return a barcode only if actually visible/readable.
"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "image_type": {"type": "string", "enum": ["ingredient_label","product_front","mixed","unknown"]},
        "image_quality": {"type": "string", "enum": ["good","usable","poor"]},
        "ingredient_list_complete": {"type": "boolean"},
        "product_name": {"anyOf": [{"type":"string"},{"type":"null"}]},
        "brand": {"anyOf": [{"type":"string"},{"type":"null"}]},
        "variant": {"anyOf": [{"type":"string"},{"type":"null"}]},
        "barcode": {"anyOf": [{"type":"string"},{"type":"null"}]},
        "ingredient_text": {"type":"string"},
        "allergen_statement": {"type":"string"},
        "precautionary_statement": {"type":"string"},
        "evidence": {
            "type":"array",
            "items":{
                "type":"object",
                "additionalProperties":False,
                "properties":{
                    "quoted_label_term":{"type":"string"},
                    "canonical_ingredient":{"type":"string"},
                    "allergen_group":{"anyOf":[{"type":"string"},{"type":"null"}]},
                    "relationship":{"type":"string","enum":["direct","derived","possible_cross_contact","none"]},
                    "reason":{"type":"string"}
                },
                "required":["quoted_label_term","canonical_ingredient","allergen_group","relationship","reason"]
            }
        },
        "notes":{"type":"string"}
    },
    "required":[
        "image_type","image_quality","ingredient_list_complete","product_name","brand","variant",
        "barcode","ingredient_text","allergen_statement","precautionary_statement","evidence","notes"
    ]
}

def _data_url(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")

def _extract_output_text(payload: dict) -> str:
    for item in payload.get("output", []):
        if item.get("type") == "message":
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    return content.get("text", "")
    raise RuntimeError("OpenAI response did not contain output_text.")

def extract_with_openai(images: list[tuple[bytes,str]], profile: dict) -> VisionExtraction:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    model = os.getenv("OPENAI_MODEL", "gpt-5.6-terra")

    user_content = [{
        "type":"input_text",
        "text":"User profile JSON: " + json.dumps(profile, ensure_ascii=False) +
               "\\nAnalyze all supplied images as views of the same food product."
    }]
    for raw, mime in images:
        user_content.append({
            "type":"input_image",
            "image_url":_data_url(raw, mime),
            "detail":"high"
        })

    body = {
        "model": model,
        "instructions": SYSTEM_PROMPT,
        "input": [{
            "role":"user",
            "content": user_content
        }],
        "text": {
            "format": {
                "type":"json_schema",
                "name":"aller_label_extraction",
                "schema":SCHEMA,
                "strict":True
            }
        },
        "temperature": 0
    }

    r = requests.post(
        OPENAI_URL,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type":"application/json"
        },
        json=body,
        timeout=90
    )
    if not r.ok:
        # Do not leak the API key; response body contains no key but keep logs concise.
        raise RuntimeError(f"OpenAI API error {r.status_code}: {r.text[:800]}")

    parsed = json.loads(_extract_output_text(r.json()))
    return VisionExtraction.model_validate(parsed)
