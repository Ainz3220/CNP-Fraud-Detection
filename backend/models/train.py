"""Train LR, RF, and XGBoost fraud detection models with SMOTE."""

import hashlib
import json
import logging
import os
from datetime import datetime as dt
from pathlib import Path
from typing import Dict, Optional, Tuple

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

from datautils.preprocess import PreprocessingPipeline, load_raw_data, FEATURE_COLS  # noqa: F401 (used in _meta)

logger = logging.getLogger(__name__)

MODEL_NAMES = ["lr", "rf", "xgb"]

_TRAINING_STATUS = {"status": "idle", "progress": 0, "message": ""}


def get_training_status() -> dict:
    return dict(_TRAINING_STATUS)


# ---------------------------------------------------------------------------
# Preprocessing cache helpers
# ---------------------------------------------------------------------------

_CACHE_FILE = "preprocess_cache.pkl"


def _data_hash(train_path: str, test_path: Optional[str], extra_df: Optional[pd.DataFrame]) -> str:
    h = hashlib.md5()
    for path in (train_path, test_path):
        if path and os.path.exists(path):
            stat = os.stat(path)
            h.update(f"{path}:{stat.st_size}:{stat.st_mtime}".encode())
    if extra_df is not None:
        h.update(pd.util.hash_pandas_object(extra_df, index=True).values.tobytes())
    return h.hexdigest()


def _load_cache(model_dir: str, expected_hash: str) -> Optional[Tuple]:
    path = os.path.join(model_dir, _CACHE_FILE)
    if not os.path.exists(path):
        return None
    try:
        cached = joblib.load(path)
        if cached.get("hash") != expected_hash:
            return None
        return cached["pipeline"], cached["X_all"], cached["y_all"]
    except Exception:
        return None


def _save_cache(model_dir: str, data_hash: str, pipeline: PreprocessingPipeline,
                X_all: np.ndarray, y_all: np.ndarray):
    path = os.path.join(model_dir, _CACHE_FILE)
    joblib.dump({"hash": data_hash, "pipeline": pipeline, "X_all": X_all, "y_all": y_all}, path)


def _update_status(status: str, progress: int, message: str):
    _TRAINING_STATUS["status"] = status
    _TRAINING_STATUS["progress"] = progress
    _TRAINING_STATUS["message"] = message
    logger.info(f"[Training] {message} ({progress}%)")


def evaluate_model(model, X_test: np.ndarray, y_test: np.ndarray) -> dict:
    y_prob = model.predict_proba(X_test)[:, 1]

    # Find F1-optimal threshold
    precs, recs, threshs = precision_recall_curve(y_test, y_prob)
    denom = precs[:-1] + recs[:-1]
    with np.errstate(invalid="ignore", divide="ignore"):
        f1s = np.where(denom > 0, 2 * precs[:-1] * recs[:-1] / denom, 0.0)
    best_idx = int(np.argmax(f1s))
    optimal_threshold = float(threshs[best_idx])

    y_pred = (y_prob >= optimal_threshold).astype(int)
    cm = sk_confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()

    # Downsample PR curve to ~50 points so metrics.json stays small
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
            use_label_encoder=False,
            eval_metric="logloss",
            tree_method="hist",
        ),
    }


def train(
    train_path: str,
    test_path: str = None,
    model_dir: str = "./saved_models",
    extra_df: pd.DataFrame = None,
) -> Dict:
    """
    Full training pipeline. Returns metrics dict keyed by model name.
    If extra_df is provided it is merged with the CSV data before training.
    """
    Path(model_dir).mkdir(parents=True, exist_ok=True)

    data_hash = _data_hash(train_path, test_path, extra_df)
    cached = _load_cache(model_dir, data_hash)
    if cached:
        pipeline, X_all, y_all = cached
        logger.info("Loaded preprocessed data from cache — skipping feature engineering.")
    else:
        _update_status("running", 5, "Loading dataset...")
        df = load_raw_data(train_path, test_path)
        if extra_df is not None:
            df = pd.concat([df, extra_df], ignore_index=True)
        if "is_fraud" not in df.columns:
            raise ValueError("Dataset must contain an 'is_fraud' column.")
        _update_status("running", 15, "Engineering features...")
        pipeline = PreprocessingPipeline()
        X_all = pipeline.fit_transform(df)
        y_all = df["is_fraud"].values
        _save_cache(model_dir, data_hash, pipeline, X_all, y_all)

    # 60/20/20 split: train / calibration / validation
    train_end = int(len(X_all) * 0.60)
    cal_end = int(len(X_all) * 0.80)
    X_train, X_cal, X_val = X_all[:train_end], X_all[train_end:cal_end], X_all[cal_end:]
    y_train, y_cal, y_val = y_all[:train_end], y_all[train_end:cal_end], y_all[cal_end:]

    # XGBoost scale_pos_weight: ratio of legit to fraud in training set
    neg_count = int((y_train == 0).sum())
    pos_count = int((y_train == 1).sum())
    xgb_spw = neg_count / pos_count if pos_count > 0 else 1.0
    _update_status("running", 25, f"Class ratio — legit:{neg_count} fraud:{pos_count} (XGB spw={xgb_spw:.1f})")

    models = build_models(xgb_scale_pos_weight=xgb_spw)
    metrics = {}
    label_map = {"lr": "Logistic Regression", "rf": "Random Forest", "xgb": "XGBoost"}
    model_steps = {"lr": (30, 50), "rf": (50, 70), "xgb": (70, 85)}

    for name, (start_pct, end_pct) in model_steps.items():
        _update_status("running", start_pct, f"Training {label_map[name]}...")
        models[name].fit(X_train, y_train)
        logger.info(f"{label_map[name]} trained.")

    for name in model_steps:
        _update_status("running", 88, f"Evaluating {label_map[name]}...")
        metrics[name] = evaluate_model(models[name], X_val, y_val)
        joblib.dump(models[name], os.path.join(model_dir, f"{name}_model.pkl"))
        logger.info(f"{label_map[name]} metrics: {metrics[name]}")

    _update_status("running", 90, "Saving pipeline and metrics...")
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

    metrics_path = os.path.join(model_dir, "metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics, f, indent=2)

    _update_status("done", 100, "Training complete.")
    return metrics


def retrain_with_new_data(
    original_train_path: str,
    new_data_df: pd.DataFrame,
    model_dir: str = "./saved_models",
) -> dict:
    """Merge original + new data, retrain all models, return before/after metrics."""
    # Load before metrics
    metrics_path = os.path.join(model_dir, "metrics.json")
    before_metrics = {}
    if os.path.exists(metrics_path):
        with open(metrics_path) as f:
            before_metrics = json.load(f)

    after_metrics = train(
        train_path=original_train_path,
        model_dir=model_dir,
        extra_df=new_data_df,
    )

    comparison = {}
    for name in MODEL_NAMES:
        comparison[name] = {
            "model_name": name,
            "before": before_metrics.get(name, {}),
            "after": after_metrics.get(name, {}),
        }
    return comparison


def models_exist(model_dir: str) -> bool:
    base = ["pipeline.pkl", "metrics.json"]
    if not all(os.path.exists(os.path.join(model_dir, f)) for f in base):
        return False
    return any(
        os.path.exists(os.path.join(model_dir, f"{name}_model.pkl"))
        for name in MODEL_NAMES
    )


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
