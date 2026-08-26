import json
import os
from typing import List

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .engine import evaluate_label
from .openai_vision import extract_with_openai
from .off import get_by_barcode, search_exactish

app = FastAPI(title="ALLER AI API", version="0.2.0")

origins = [
    "https://faranaksadatsolat.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
extra = os.getenv("ALLOWED_ORIGINS","").strip()
if extra:
    origins.extend(x.strip() for x in extra.split(",") if x.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"service":"ALLER AI API","ok":True}

@app.get("/health")
def health():
    return {
        "ok":True,
        "openai_configured":bool(os.getenv("OPENAI_API_KEY")),
        "model":os.getenv("OPENAI_MODEL","gpt-5.6-terra")
    }

@app.post("/v1/analyze")
async def analyze(profile: str = Form(...), images: List[UploadFile] = File(...)):
    try:
        p = json.loads(profile)
    except Exception:
        raise HTTPException(400,"Invalid profile JSON.")

    selected = p.get("allergens") or []
    custom = p.get("custom_avoid") or []
    if not selected and not custom:
        raise HTTPException(400,"Select at least one allergen/ingredient.")
    if not images or len(images) > 3:
        raise HTTPException(400,"Upload 1 to 3 images.")

    prepared=[]
    for img in images:
        if not (img.content_type or "").startswith("image/"):
            raise HTTPException(400,"Only image files are accepted.")
        raw=await img.read()
        if len(raw) > 10*1024*1024:
            raise HTTPException(413,"Each image must be 10 MB or less.")
        prepared.append((raw,img.content_type or "image/jpeg"))

    try:
        vision=extract_with_openai(prepared,p)
    except RuntimeError as e:
        # Server logs retain detail; client gets a safe generic failure.
        print(str(e))
        raise HTTPException(502,"Image analysis service failed. Please try again.")

    if vision.image_quality == "poor":
        return {
            "status":"retake",
            "message":"The ingredient information is not clear enough for a reliable check. Please retake the label photo closer and without glare."
        }

    source_text=""
    source="label"

    if vision.ingredient_list_complete and vision.ingredient_text.strip():
        source_text="\n".join(x for x in [
            vision.ingredient_text,
            vision.allergen_statement,
            vision.precautionary_statement
        ] if x)

    # If only the product front/single item is visible, never guess ingredients.
    # Exact product lookup is allowed as a fallback.
    if not source_text:
        product=None
        if vision.barcode:
            product=get_by_barcode(vision.barcode)
        if not product and (vision.product_name or vision.brand):
            product=search_exactish(vision.brand,vision.product_name)

        if product and product.get("ingredients_text"):
            source="verified_product_database"
            source_text="\n".join(x for x in [
                product.get("ingredients_text",""),
                product.get("allergens",""),
                product.get("traces","")
            ] if x)
        else:
            return {
                "status":"retake",
                "message":"I cannot verify the exact ingredient list for this item. Please photograph the original package ingredient panel."
            }

    status,direct,caution=evaluate_label(
        source_text,
        selected_allergens=selected,
        custom_avoid=custom,
        model_evidence=[e.model_dump() for e in vision.evidence]
    )

    if status=="conflict":
        hit=direct[0]
        return {
            "status":"conflict",
            "message":f"{hit['allergen']} conflicts with your selected profile.",
            "matched_label_term":hit["matched_term"],
            "mapped_to":hit["allergen"],
            "reason":hit.get("reason") or "The verified ingredient term is a direct or known derivative match.",
            "source":source
        }

    if status=="caution":
        hit=caution[0]
        return {
            "status":"caution",
            "message":f"The label indicates possible exposure related to {hit['allergen']}.",
            "matched_label_term":hit["matched_term"],
            "mapped_to":hit["allergen"],
            "reason":hit.get("reason") or "The verified term appears in a precautionary/cross-contact statement.",
            "source":source
        }

    # A reassuring response requires complete, grounded ingredient information.
    if source=="label" and not vision.ingredient_list_complete:
        return {
            "status":"retake",
            "message":"The complete ingredient list could not be verified. Please photograph the full ingredient panel."
        }

    return {
        "status":"no_listed_conflict",
        "message":"No conflict with your selected profile was found in the ingredient information that could be verified. This is not a guarantee that the product is safe.",
        "source":source
    }
