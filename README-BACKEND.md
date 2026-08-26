# ALLER AI — OpenAI backend

## Important
Never place `OPENAI_API_KEY` in `index.html`, GitHub Pages, or any committed file.

## Local test

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:OPENAI_API_KEY="YOUR_SECRET_KEY"
uvicorn backend.main:app --reload
```

Open:
- http://127.0.0.1:8000/health

Serve the frontend separately, for example in VS Code Live Server.
On localhost, `index.html` points automatically to:
- http://127.0.0.1:8000/v1/analyze

## Render

Create a Render Web Service from the GitHub repository:

Build command:
`pip install -r requirements.txt`

Start command:
`uvicorn backend.main:app --host 0.0.0.0 --port $PORT`

Environment variables:
- `OPENAI_API_KEY` = your secret API key
- `OPENAI_MODEL` = `gpt-5.6-terra`
- `ALLOWED_ORIGINS` = `https://faranaksadatsolat.github.io`

When Render gives you:
`https://YOUR-SERVICE.onrender.com`

set the production URL in `index.html` to:
`https://YOUR-SERVICE.onrender.com/v1/analyze`

Then commit and push only the URL change.

## Design principle

The OpenAI model extracts structured visual evidence. It does not independently declare a product safe.
A deterministic verifier checks label terms against the selected profile.
Incomplete/ambiguous evidence returns `retake`.
