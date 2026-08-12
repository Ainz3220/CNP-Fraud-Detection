"""Single-transaction and batch prediction logic.

Given a trained model and a transaction, this module turns a raw fraud
probability (a number between 0 and 1) into one of three plain-English
verdicts, and combines the verdicts of several models into one final answer.
"""

import logging
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from datautils.preprocess import PreprocessingPipeline, resolve_home_coords, FEATURE_COLS
from models.explain import get_shap_values, top_features
from utils.feature_engineering import engineer_features

logger = logging.getLogger(__name__)

DEFAULT_FRAUD_THRESHOLD = 0.40
REVIEW_LOWER = 0.30  # below this probability, a transaction is APPROVED outright


def probability_to_verdict(prob: float, threshold: float = DEFAULT_FRAUD_THRESHOLD) -> str:
    """Turn a fraud probability into APPROVED / REVIEW REQUIRED / FRAUD BLOCKED."""
    review_lower = min(REVIEW_LOWER, threshold * 0.5)
    if prob < review_lower:
        return "APPROVED"
    if prob < threshold:
        return "REVIEW REQUIRED"
    return "FRAUD BLOCKED"


def majority_vote(verdicts: List[str]) -> str:
    """Combine several models' verdicts into one, erring on the side of caution.

    A single "FRAUD BLOCKED" from any model blocks the transaction, because
    missing real fraud is more costly than double-checking a legitimate one.
    """
    if "FRAUD BLOCKED" in verdicts:
        return "FRAUD BLOCKED"
    if "REVIEW REQUIRED" in verdicts:
        return "REVIEW REQUIRED"
    return "APPROVED"


def _build_input_df(transaction: dict, pipeline: PreprocessingPipeline) -> pd.DataFrame:
    """Convert a raw transaction dict into the one-row DataFrame the pipeline expects."""
    row = dict(transaction)

    home_lat, home_lon = resolve_home_coords(row.get("cc_num"), None, pipeline)
    if row.get("lat") is None:
        row["lat"] = home_lat
    if row.get("long") is None:
        row["long"] = home_lon
    if row.get("merch_lat") is None:
        row["merch_lat"] = row["lat"]
    if row.get("merch_long") is None:
        row["merch_long"] = row["long"]

    # The model needs a full datetime, but the API only takes an hour — fake
    # the date part since only the hour is actually used as a feature.
    if "trans_date_trans_time" not in row and "hour_of_day" in row:
        h = int(row["hour_of_day"])
        row["trans_date_trans_time"] = f"2024-01-01 {h:02d}:00:00"

    return pd.DataFrame([row])


def _raw_feature_row(df: pd.DataFrame, pipeline: PreprocessingPipeline) -> np.ndarray:
    """Return each feature's real value (e.g. actual amount, actual age) —
    used for display, since the model itself only sees scaled/encoded numbers."""
    eng_df = engineer_features(df.copy(), pipeline.category_stats)
    return np.array([eng_df[col].iloc[0] if col in eng_df.columns else 0 for col in FEATURE_COLS], dtype=object)


def predict_single(
    transaction: dict,
    models: dict,
    pipeline: PreprocessingPipeline,
    selected_models: Optional[List[str]] = None,
    thresholds: Optional[Dict[str, float]] = None,
) -> dict:
    """Run one transaction through each selected model and combine the verdicts."""
    selected_models = selected_models or list(models.keys())
    df = _build_input_df(transaction, pipeline)
    X = pipeline.transform(df)
    raw_row = _raw_feature_row(df, pipeline)

    model_results = []
    verdicts = []

    for name in selected_models:
        if name not in models:
            continue
        prob = float(models[name].predict_proba(X)[0, 1])
        threshold = (thresholds or {}).get(name, DEFAULT_FRAUD_THRESHOLD)
        verdict = probability_to_verdict(prob, threshold)
        verdicts.append(verdict)

        shap_row = get_shap_values(name, models[name], X)[0]
        features = top_features(shap_row, raw_row, top_n=5)

        model_results.append({
            "model_name": name,
            "fraud_probability": round(prob, 4),
            "verdict": verdict,
            "top_features": [
                {"feature": feature, "shap": round(float(value), 4), "value": str(raw)}
                for feature, value, raw in features
            ],
        })

    combined_verdict = majority_vote(verdicts) if verdicts else "APPROVED"

    return {
        "model_results": model_results,
        "combined_verdict": combined_verdict,
    }


def predict_batch(
    df: pd.DataFrame,
    models: dict,
    pipeline: PreprocessingPipeline,
    selected_models: Optional[List[str]] = None,
    thresholds: Optional[Dict[str, float]] = None,
) -> pd.DataFrame:
    """Run every row of a DataFrame through each selected model."""
    selected_models = selected_models or list(models.keys())
    result_df = df.copy()

    def _resolve(row):
        home_lat, home_lon = resolve_home_coords(row.get("cc_num"), None, pipeline)
        if "lat" not in row or pd.isna(row.get("lat")):
            row["lat"] = home_lat
        if "long" not in row or pd.isna(row.get("long")):
            row["long"] = home_lon
        return row

    result_df = result_df.apply(_resolve, axis=1)
    X = pipeline.transform(result_df)

    active = [name for name in selected_models if name in models]
    model_verdicts: Dict[str, List[str]] = {}

    for name in active:
        probs = models[name].predict_proba(X)[:, 1]
        result_df[f"fraud_probability_{name}"] = probs
        threshold = (thresholds or {}).get(name, DEFAULT_FRAUD_THRESHOLD)
        model_verdicts[name] = [probability_to_verdict(float(p), threshold) for p in probs]

    if active:
        result_df["combined_verdict"] = [
            majority_vote([model_verdicts[name][i] for name in active])
            for i in range(len(result_df))
        ]

    return result_df
