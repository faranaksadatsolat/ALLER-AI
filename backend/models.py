from typing import Literal
from pydantic import BaseModel, Field

class IngredientEvidence(BaseModel):
    quoted_label_term: str = ""
    canonical_ingredient: str = ""
    allergen_group: str | None = None
    relationship: Literal["direct", "derived", "possible_cross_contact", "none"] = "none"
    reason: str = ""

class VisionExtraction(BaseModel):
    image_type: Literal["ingredient_label", "product_front", "mixed", "unknown"]
    image_quality: Literal["good", "usable", "poor"]
    ingredient_list_complete: bool
    product_name: str | None = None
    brand: str | None = None
    variant: str | None = None
    barcode: str | None = None
    ingredient_text: str = ""
    allergen_statement: str = ""
    precautionary_statement: str = ""
    evidence: list[IngredientEvidence] = Field(default_factory=list)
    notes: str = ""
