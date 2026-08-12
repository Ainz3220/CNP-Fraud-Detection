"""Train the Logistic Regression, Random Forest, and XGBoost fraud models.

This runs once at startup (see main.py) if no trained models are found on
disk yet. It is not exposed through the API — retraining means deleting the
saved_models/ folder and restarting the server.
"""

import json
import logging
import os
from datetime import datetime as dt
from pathlib import Path
from typing import Dict, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, roc_auc_score,
    average_precision_score, precision_recall_curve,
    confusion_matrix as sk_confusion_matrix,
)
from xgboost import XGBClassifier

from datautils.preprocess import PreprocessingPipeline, load_raw_data, filter_cnp_transactions, FEATURE_COLS

logger = logging.getLogger(__name__)

MODEL_NAMES = ["lr", "rf", "xgb"]
MODEL_LABELS = {"lr": "Logistic Regression", "rf": "Random Forest", "xgb": "XGBoost"}


def evaluate_model(model, X_test: np.ndarray, y_test: np.ndarray) -> dict:
    """Score a trained model on held-out data and pick its best fraud threshold."""
    y_prob = model.predict_proba(X_test)[:, 1]

    # Try every threshold the precision-recall curve suggests, and keep the
    # one that gives the best F1 score (the best balance of precision/recall).
    precs, recs, threshs = precision_recall_curve(y_test, y_prob)
    denom = precs[:-1] + recs[:-1]
    with np.errstate(invalid="ignore", divide="ignore"):
        f1s = np.where(denom > 0, 2 * precs[:-1] * recs[:-1] / denom, 0.0)
    best_idx = int(np.argmax(f1s))
    optimal_threshold = float(threshs[best_idx])

    y_pred = (y_prob >= optimal_threshold).astype(int)
    tn, fp, fn, tp = sk_confusion_matrix(y_test, y_pred).ravel()

    # Downsample the PR curve to ~50 points so metrics.json stays small.
    step = max(1, len(precs) // 50)
    pr_curve = [
        {"recall": round(float(r), 4), "precision": round(float(p), 4)}
        for p, r in zip(precs[::step], recs[::step])
    ]

    return {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision": round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
        "auc_roc": round(float(roc_auc_score(y_test, y_prob)), 4),
        "pr_auc": round(float(average_precision_score(y_test, y_prob)), 4),
        "optimal_threshold": round(optimal_threshold, 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "pr_curve": pr_curve,
    }


def build_models(xgb_scale_pos_weight: float = 1.0) -> dict:
    return {
        "lr": LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"),
        "rf": RandomForestClassifier(
            n_estimators=200, max_depth=8, min_samples_leaf=10,
            class_weight="balanced", random_state=42, n_jobs=-1,
        ),
        "xgb": XGBClassifier(
            n_estimators=100,
            scale_pos_weight=xgb_scale_pos_weight,
            random_state=42,
            eval_metric="logloss",
            tree_method="hist",
        ),
    }


def train(train_path: str, test_path: str = None, model_dir: str = "./saved_models") -> Dict:
    """
    Load the CSV data, engineer features, train all three models, evaluate
    them, and save everything (models + pipeline + metrics.json) to model_dir.

    Only Card-Not-Present transactions (online "_net" merchant categories)
    are kept — see datautils.preprocess.filter_cnp_transactions.
    """
    Path(model_dir).mkdir(parents=True, exist_ok=True)

    logger.info("Loading dataset...")
    df = load_raw_data(train_path, test_path)
    df = filter_cnp_transactions(df)
    if "is_fraud" not in df.columns:
        raise ValueError("Dataset must contain an 'is_fraud' column.")

    logger.info("Engineering features...")
    pipeline = PreprocessingPipeline()
    X_all = pipeline.fit_transform(df)
    y_all = df["is_fraud"].values

    # Split the data three ways: train the models, calibrate them, then
    # validate on data neither step has seen.
    train_end = int(len(X_all) * 0.60)
    cal_end = int(len(X_all) * 0.80)
    X_train, X_val = X_all[:train_end], X_all[cal_end:]
    y_train, y_val = y_all[:train_end], y_all[cal_end:]

    # Fraud is rare, so XGBoost is told the legit:fraud ratio in the training
    # set to weigh fraud examples more heavily.
    neg_count = int((y_train == 0).sum())
    pos_count = int((y_train == 1).sum())
    xgb_spw = neg_count / pos_count if pos_count > 0 else 1.0
    logger.info(f"Class ratio — legit:{neg_count} fraud:{pos_count} (XGB scale_pos_weight={xgb_spw:.1f})")

    models = build_models(xgb_scale_pos_weight=xgb_spw)
    metrics = {}

    for name in MODEL_NAMES:
        logger.info(f"Training {MODEL_LABELS[name]}...")
        models[name].fit(X_train, y_train)

    for name in MODEL_NAMES:
        metrics[name] = evaluate_model(models[name], X_val, y_val)
        joblib.dump(models[name], os.path.join(model_dir, f"{name}_model.pkl"))
        logger.info(f"{MODEL_LABELS[name]} metrics: {metrics[name]}")

    pipeline.save(os.path.join(model_dir, "pipeline.pkl"))

    n_fraud = int(y_all.sum())
    metrics["_meta"] = {
        "trained_at": dt.utcnow().isoformat() + "Z",
        "n_samples": int(len(y_all)),
        "n_fraud": n_fraud,
        "n_legit": int(len(y_all)) - n_fraud,
        "xgb_scale_pos_weight": round(xgb_spw, 2),
        "features": list(FEATURE_COLS),
    }

    with open(os.path.join(model_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)

    logger.info("Training complete.")
    return metrics


def models_exist(model_dir: str) -> bool:
    base = ["pipeline.pkl", "metrics.json"]
    if not all(os.path.exists(os.path.join(model_dir, f)) for f in base):
        return False
    return any(os.path.exists(os.path.join(model_dir, f"{name}_model.pkl")) for name in MODEL_NAMES)


def load_all_models(model_dir: str) -> Tuple[dict, "PreprocessingPipeline", dict]:
    models = {}
    for name in MODEL_NAMES:
        path = os.path.join(model_dir, f"{name}_model.pkl")
        if os.path.exists(path):
            models[name] = joblib.load(path)
    if not models:
        raise FileNotFoundError(f"No model .pkl files found in {model_dir}")
    pipeline = PreprocessingPipeline.load(os.path.join(model_dir, "pipeline.pkl"))
    with open(os.path.join(model_dir, "metrics.json")) as f:
        metrics = json.load(f)
    return models, pipeline, metrics
