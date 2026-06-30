from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Bill AI OCR Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HeaderExtraction(BaseModel):
    business_name: str = ""
    address: str = ""
    phone: str = ""
    gst_number: str = ""
    raw_text: str = ""
    engine: str = "placeholder"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/ocr/header", response_model=HeaderExtraction)
async def extract_header(file: Optional[UploadFile] = File(default=None)):
    """OCR-ready endpoint.

    Install PaddleOCR later and replace this placeholder with real image
    preprocessing plus text extraction. The desktop UI can already call this
    endpoint without changing its API contract.
    """
    filename = Path(file.filename).name if file else ""
    return HeaderExtraction(
        business_name="",
        address="",
        phone="",
        gst_number="",
        raw_text=f"Upload received: {filename}" if filename else "",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
