# ALLER AI backend

This backend makes the single-page ALLER AI frontend actually analyze images.

## What it does

1. Receives 1–3 product photos plus the user's selected allergy profile.
2. Uses Gemini vision for **structured extraction**, not for an ungrounded "safe/unsafe" guess.
3. If a complete ingredient label is visible, it extracts the exact label text.
4. If only the product front/single wrapper is visible, it may identify the exact product and try a product database.
5. It does **not** infer ingredients from a generic product name.
6. A deterministic verifier checks high-confidence multilingual allergen aliases/derivatives.
7. If the evidence is incomplete, it returns `retake`, not a reassuring result.

## Local run

Python 3.11+ recommended.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Set `GEMINI_API_KEY` in your shell (or load it through your IDE), then:

```powershell
$env:GEMINI_API_KEY="YOUR_KEY"
uvicorn backend.main:app --reload
```

Health check:
`http://127.0.0.1:8000/health`

The included `index.html` automatically calls
`http://127.0.0.1:8000/v1/analyze` when served from localhost.

## Deploy to Render

The included `render.yaml` can create the Python web service.

Add the secret environment variable:
`GEMINI_API_KEY`

After deployment, Render gives you an HTTPS address such as:
`https://<your-service>.onrender.com`

Then edit ONE line in `index.html` and set the production endpoint to:
`https://<your-service>.onrender.com/v1/analyze`

Do not put the Gemini key in `index.html` or GitHub Pages.

## Important

This is a research/MVP decision-support system, not a medical guarantee.
A production release needs a much larger curated ingredient ontology, provenance,
benchmarking, adversarial testing, and regulatory/legal review.
