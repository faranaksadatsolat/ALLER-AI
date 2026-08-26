from typing import Literal, Optional
from pydantic import BaseModel, Field

class IngredientEvidence(BaseModel):
    quoted_label_term: str = Field(
        description="Exact term copied from the visible ingredient/allergen text. Never invent or paraphrase."
    )
    canonical_ingredient: str
    allergen_group: Optional[str] = None
    relationship: Literal["direct", "derived", "possible_cross_contact", "none"] = "none"
    reason: str = ""

class VisionExtraction(BaseModel):
    image_type: Literal["ingredient_label", "product_front", "mixed", "unknown"]
    image_quality: Literal["good", "usable", "poor"]
    ingredient_list_complete: bool = False
    product_name: Optional[str] = None
    brand: Optional[str] = None
    variant: Optional[str] = None
    barcode: Optional[str] = None
    ingredient_text: str = ""
    allergen_statement: str = ""
    precautionary_statement: str = ""
    evidence: list[IngredientEvidence] = []
    notes: str = ""
