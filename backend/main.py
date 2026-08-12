"""CNP Fraud Detection — FastAPI application entry point.

This file wires together the whole backend: it starts model training in the
background on startup, then exposes a small set of HTTP endpoints that the
frontend calls to get predictions, metrics, and prediction history.
"""

import io
import json
import logging
import os
import threading
from datetime import datetime
from typing import Optional

import pandas as pd
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

# Folders that hold the trained model files (.pkl) and the raw CSV dataset.
MODEL_DIR = os.getenv("MODEL_DIR", "./saved_models")
DATA_DIR = os.getenv("DATA_DIR", "./data")

from database.db import get_db, init_db
from database.models import Prediction
from datautils.upload import validate_predict_csv
from models.train import load_all_models, models_exist, train
from models.predict import predict_batch, predict_single

app = FastAPI(title="CNP Fraud Detection API", version="1.0.0")

# Allow the frontend (running on a different port) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory model state ────────────────────────────────────────────────────
# The trained models are loaded once into these variables and reused for
# every request, instead of reading the .pkl files from disk each time.
_models: dict = {}
_pipeline = None
_metrics: dict = {}
_models_loaded = False
_load_lock = threading.Lock()


def _load_models():
    """Load the trained models, preprocessing pipeline, and metrics into memory."""
    global _models, _pipeline, _metrics, _models_loaded
    with _load_lock:
        if _models_loaded:
            return
        try:
            _models, _pipeline, _metrics = load_all_models(MODEL_DIR)
            _models_loaded = True
            logger.info("Models loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load models: {e}")


def _train_if_needed():
    """Train models from the CSV dataset if no saved models exist yet, then load them."""
    train_csv = os.path.join(DATA_DIR, "fraudTrain.csv")
    test_csv = os.path.join(DATA_DIR, "fraudTest.csv")
    if not models_exist(MODEL_DIR):
        if not os.path.exists(train_csv):
            logger.warning("Training data not found at %s. Add fraudTrain.csv to the data/ folder and restart.", train_csv)
            return
        logger.info("No saved models found — starting training...")
        try:
            train(
                train_path=train_csv,
                test_path=test_csv if os.path.exists(test_csv) else None,
                model_dir=MODEL_DIR,
            )
        except Exception as e:
            logger.error(f"Training failed: {e}")
            return
    _load_models()


@app.on_event("startup")
async def startup_event():
    init_db()
    # Training can take a while, so it runs on a background thread instead of
    # blocking the API from starting up.
    thread = threading.Thread(target=_train_if_needed, daemon=True)
    thread.start()


# Random Forest and XGBoost tend to predict very low probabilities even for
# fraud, so their "fraud" threshold is capped lower than Logistic Regression's.
_TREE_MAX_THRESHOLD = 0.40


def _extract_thresholds(metrics: dict) -> dict:
    """Read each model's fraud-decision threshold out of metrics.json."""
    result = {}
    for name in ("lr", "rf", "xgb"):
        t = metrics.get(name, {}).get("optimal_threshold")
        if t is not None:
            result[name] = float(t) if name == "lr" else min(float(t), _TREE_MAX_THRESHOLD)
    return result


def require_models():
    if not _models_loaded:
        raise HTTPException(status_code=503, detail="Models are still loading. Check /api/status.")
    return _models, _pipeline


# ── Request body for a single prediction ─────────────────────────────────────

class TransactionInput(BaseModel):
    amt: float
    category: str
    hour_of_day: Optional[int] = 12
    age: Optional[int] = 40
    distance_from_home: Optional[float] = None
    gender: Optional[str] = "M"
    cc_num: Optional[str] = None
    lat: Optional[float] = None
    long: Optional[float] = None
    merch_lat: Optional[float] = None
    merch_long: Optional[float] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/status")
def get_status():
    """Tell the frontend whether the models have finished loading/training."""
    return {
        "models_loaded": _models_loaded,
        "available_models": list(_models.keys()) if _models_loaded else [],
    }


@app.get("/api/metrics")
def get_metrics():
    """Return the accuracy/precision/recall/etc. metrics computed during training."""
    if not _metrics:
        metrics_path = os.path.join(MODEL_DIR, "metrics.json")
        if os.path.exists(metrics_path):
            with open(metrics_path) as f:
                return json.load(f)
        raise HTTPException(status_code=404, detail="Metrics not available yet.")
    return _metrics


@app.post("/api/predict")
def predict(
    transaction: TransactionInput,
    models: str = Query(default="lr,rf,xgb"),
    db: Session = Depends(get_db),
):
    """Predict fraud probability for a single transaction, using one or more models."""
    ml_models, pipeline = require_models()
    selected = [m.strip() for m in models.split(",") if m.strip() in ml_models]
    if not selected:
        raise HTTPException(status_code=400, detail="No valid models specified.")

    tx_dict = transaction.model_dump()
    thresholds = _extract_thresholds(_metrics)
    result = predict_single(tx_dict, ml_models, pipeline, selected, thresholds=thresholds)

    # Save each model's result to the database so it shows up in /api/history.
    for model_result in result["model_results"]:
        pred = Prediction()
        pred.set_transaction_data(tx_dict)
        pred.model_used = model_result["model_name"]
        pred.fraud_probability = model_result["fraud_probability"]
        pred.verdict = model_result["verdict"]
        db.add(pred)
    db.commit()

    return result


@app.post("/api/predict/batch")
async def predict_batch_endpoint(
    file: UploadFile = File(...),
    models: str = Query(default="lr,rf,xgb"),
):
    """Predict fraud probability for every row in an uploaded CSV, returning a CSV back."""
    ml_models, pipeline = require_models()
    selected = [m.strip() for m in models.split(",") if m.strip() in ml_models]
    if not selected:
        raise HTTPException(status_code=400, detail="No valid models specified.")

    contents = await file.read()
    df = pd.read_csv(io.BytesIO(contents))
    df = validate_predict_csv(df)

    thresholds = _extract_thresholds(_metrics)
    result_df = predict_batch(df, ml_models, pipeline, selected, thresholds=thresholds)

    output = io.StringIO()
    result_df.to_csv(output, index=False)
    output.seek(0)

    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=batch_predictions.csv"},
    )


@app.get("/api/history")
def get_history(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    verdict_filter: Optional[str] = Query(default=None),
    model_filter: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Return a page of past predictions, optionally filtered by verdict/model/date."""
    query = db.query(Prediction)

    if verdict_filter:
        query = query.filter(Prediction.verdict == verdict_filter)
    if model_filter:
        query = query.filter(Prediction.model_used == model_filter)
    if date_from:
        try:
            query = query.filter(Prediction.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(Prediction.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    total = query.count()
    records = query.order_by(Prediction.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

    items = []
    for rec in records:
        tx = rec.get_transaction_data()
        items.append({
            "id": rec.id,
            "timestamp": rec.created_at.isoformat() if rec.created_at else None,
            "amount": tx.get("amt"),
            "category": tx.get("category"),
            "model_used": rec.model_used,
            "fraud_probability": rec.fraud_probability,
            "verdict": rec.verdict,
        })

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit,
        "items": items,
    }


@app.get("/api/history/stats")
def get_history_stats(db: Session = Depends(get_db)):
    """Return summary counts used by the dashboard (totals + a 30-day trend)."""
    from sqlalchemy import func

    total = db.query(Prediction).count()
    fraud = db.query(Prediction).filter(Prediction.verdict == "FRAUD BLOCKED").count()
    review = db.query(Prediction).filter(Prediction.verdict == "REVIEW REQUIRED").count()
    legit = db.query(Prediction).filter(Prediction.verdict == "APPROVED").count()

    daily = (
        db.query(
            func.date(Prediction.created_at).label("date"),
            Prediction.verdict,
            func.count().label("count"),
        )
        .group_by(func.date(Prediction.created_at), Prediction.verdict)
        .order_by(func.date(Prediction.created_at))
        .all()
    )

    daily_data: dict = {}
    for row in daily:
        d = str(row.date)
        if d not in daily_data:
            daily_data[d] = {"date": d, "fraud": 0, "legitimate": 0, "review": 0}
        if row.verdict == "FRAUD BLOCKED":
            daily_data[d]["fraud"] += row.count
        elif row.verdict == "REVIEW REQUIRED":
            daily_data[d]["review"] += row.count
        else:
            daily_data[d]["legitimate"] += row.count

    return {
        "total_predictions": total,
        "fraud_detected": fraud,
        "review_required": review,
        "legitimate": legit,
        "legitimacy_rate": round((legit / total) * 100, 1) if total > 0 else 0,
        "daily_trend": sorted(daily_data.values(), key=lambda x: x["date"]),
    }
