"""Single-transaction and batch prediction logic."""

import logging
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from datautils.preprocess import PreprocessingPipeline, resolve_home_coords, FEATURE_COLS
from models.explain import get_shap_values, top_features
from utils.feature_engineering import engineer_features as _eng_features
from utils.text_explainer import generate_explanation

logger = logging.getLogger(__name__)

DEFAULT_FRAUD_THRESHOLD = 0.40
REVIEW_LOWER = 0.30  # lower bound of the review band — anything below this is APPROVED


def probability_to_verdict(prob: float, threshold: float = DEFAULT_FRAUD_THRESHOLD) -> str:
    # review zone: [review_lower, threshold); fraud zone: [threshold, 1]
    review_lower = min(REVIEW_LOWER, threshold * 0.5)
    if prob < review_lower:
        return "APPROVED"
    if prob < threshold:
        return "REVIEW REQUIRED"
    return "FRAUD BLOCKED"


def majority_vote(verdicts: List[str]) -> str:
    fraud_count = sum(1 for v in verdicts if v == "FRAUD BLOCKED")
    review_count = sum(1 for v in verdicts if v == "REVIEW REQUIRED")
    # Any single FRAUD BLOCKED blocks — false negatives are costlier than false positives
    if fraud_count >= 1:
        return "FRAUD BLOCKED"
    if review_count > 0:
        return "REVIEW REQUIRED"
    return "APPROVED"


def _raw_feature_row(df: pd.DataFrame, pipeline: PreprocessingPipeline) -> np.ndarray:
    """Return feature values *before* scaling/encoding for use in explanations.

    Categorical columns are kept as their original string values so the text
    explainer can match them by name (e.g. 'grocery_pos'). Numeric columns
    are the engineered floats (e.g. real amt in USD, real age, real distance).
    """
    eng_df = _eng_features(df.copy(), pipeline.category_stats)
    row = []
    for col in FEATURE_COLS:
        row.append(eng_df[col].iloc[0] if col in eng_df.columns else 0)
    return np.array(row, dtype=object)


def _build_input_df(transaction: dict, pipeline: PreprocessingPipeline) -> pd.DataFrame:
    """Convert raw transaction dict into a single-row DataFrame with all needed columns."""
    row = dict(transaction)

    # Resolve home coordinates
    cc_num = row.get("cc_num")
    home_lat, home_lon = resolve_home_coords(cc_num, None, pipeline)

    if row.get("lat") is None:
        row["lat"] = home_lat
    if row.get("long") is None:
        row["long"] = home_lon
    if row.get("merch_lat") is None:
        row["merch_lat"] = row["lat"]
    if row.get("merch_long") is None:
        row["merch_long"] = row["long"]

    # Supply synthetic datetime if only hour provided
    if "trans_date_trans_time" not in row and "hour_of_day" in row:
        h = int(row["hour_of_day"])
        row["trans_date_trans_time"] = f"2024-01-01 {h:02d}:00:00"

    return pd.DataFrame([row])


def predict_single(
    transaction: dict,
    models: dict,
    pipeline: PreprocessingPipeline,
    selected_models: Optional[List[str]] = None,
    thresholds: Optional[Dict[str, float]] = None,
) -> dict:
    selected_models = selected_models or list(models.keys())
    df = _build_input_df(transaction, pipeline)
    X = pipeline.transform(df)
    raw_display_row = _raw_feature_row(df, pipeline)

    model_results = []
    verdicts = []

    for name in selected_models:
        if name not in models:
            continue
        model = models[name]
        prob = float(model.predict_proba(X)[0, 1])
        threshold = (thresholds or {}).get(name, DEFAULT_FRAUD_THRESHOLD)
        verdict = probability_to_verdict(prob, threshold)
        verdicts.append(verdict)

        shap_vals = get_shap_values(name, model, X)
        shap_row = shap_vals[0]
        features = top_features(shap_row, raw_display_row, top_n=8)
        context = {"category": transaction.get("category", "")}
        explanation = generate_explanation(features, is_fraud=(prob >= threshold), context=context)

        model_results.append({
            "model_name": name,
            "fraud_probability": round(prob, 4),
            "verdict": verdict,
            "explanation": explanation,
            "shap_features": [
                {"feature": f, "shap": round(s, 4), "value": str(v)}
                for f, s, v in features
            ],
        })

    combined_verdict = majority_vote(verdicts) if len(verdicts) > 1 else (verdicts[0] if verdicts else "APPROVED")

    # Aggregate top risk/safe factors across all models
    all_shap: Dict[str, List[float]] = {}
    for res in model_results:
        for item in res["shap_features"]:
            all_shap.setdefault(item["feature"], []).append(item["shap"])

    avg_shap = {f: float(np.mean(v)) for f, v in all_shap.items()}
    sorted_shap = sorted(avg_shap.items(), key=lambda x: abs(x[1]), reverse=True)

    top_risk = [{"feature": f, "shap": s} for f, s in sorted_shap if s > 0][:5]
    top_safe = [{"feature": f, "shap": abs(s)} for f, s in sorted_shap if s < 0][:3]

    return {
        "model_results": model_results,
        "combined_verdict": combined_verdict,
        "top_risk_factors": top_risk,
        "top_safe_factors": top_safe,
    }


def predict_batch(
    df: pd.DataFrame,
    models: dict,
    pipeline: PreprocessingPipeline,
    selected_models: Optional[List[str]] = None,
    thresholds: Optional[Dict[str, float]] = None,
) -> pd.DataFrame:
    selected_models = selected_models or list(models.keys())
    result_df = df.copy()

    def _resolve(row):
        cc = row.get("cc_num")
        hl, hlo = resolve_home_coords(cc, None, pipeline)
        if "lat" not in row or pd.isna(row.get("lat")):
            row["lat"] = hl
        if "long" not in row or pd.isna(row.get("long")):
            row["long"] = hlo
        return row

    result_df = result_df.apply(_resolve, axis=1)

    X = pipeline.transform(result_df)
    probs_by_model = {}

    for name in selected_models:
        if name not in models:
            continue
        probs = models[name].predict_proba(X)[:, 1]
        result_df[f"fraud_probability_{name}"] = probs
        probs_by_model[name] = probs

    if probs_by_model:
        # Compute per-model verdicts then majority-vote per row — same logic as single prediction
        active = [n for n in selected_models if n in models]
        model_verdicts: dict[str, list[str]] = {}
        for name in active:
            thresh = (thresholds or {}).get(name, DEFAULT_FRAUD_THRESHOLD)
            model_verdicts[name] = [probability_to_verdict(float(p), thresh) for p in probs_by_model[name]]

        n_rows = len(result_df)
        result_df["combined_verdict"] = [
            majority_vote([model_verdicts[name][i] for name in active])
            for i in range(n_rows)
        ]
        first_model_name = selected_models[0]
        if first_model_name in models:
            shap_vals = get_shap_values(first_model_name, models[first_model_name], X)
            top_feat_idx = np.argmax(np.abs(shap_vals), axis=1)
            result_df["main_fraud_reason"] = [FEATURE_COLS[i] for i in top_feat_idx]

    return result_df
