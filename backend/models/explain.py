"""SHAP-based feature attribution for fraud predictions."""

import logging
from typing import Dict, List, Tuple

import numpy as np
import shap
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier

from datautils.preprocess import FEATURE_COLS

logger = logging.getLogger(__name__)

_explainer_cache: Dict[str, shap.Explainer] = {}


def _unwrap_model(model):
    """Return the raw estimator from a CalibratedClassifierCV wrapper if present."""
    try:
        from sklearn.calibration import CalibratedClassifierCV
        if isinstance(model, CalibratedClassifierCV):
            if hasattr(model, "estimator"):
                return model.estimator
            if hasattr(model, "calibrated_classifiers_") and model.calibrated_classifiers_:
                cc = model.calibrated_classifiers_[0]
                return getattr(cc, "estimator", getattr(cc, "base_estimator", model))
    except ImportError:
        pass
    return model


def _build_explainer(model_name: str, model) -> shap.Explainer:
    unwrapped = _unwrap_model(model)
    if isinstance(unwrapped, LogisticRegression):
        background = np.zeros((1, len(FEATURE_COLS)))
        return shap.LinearExplainer(unwrapped, background)
    return shap.TreeExplainer(unwrapped)


def get_explainer(model_name: str, model) -> shap.Explainer:
    if model_name not in _explainer_cache:
        _explainer_cache[model_name] = _build_explainer(model_name, model)
    return _explainer_cache[model_name]


def invalidate_cache():
    _explainer_cache.clear()


def get_shap_values(
    model_name: str,
    model,
    X: np.ndarray,
) -> np.ndarray:
    """Return SHAP values array for the fraud class (shape: [n_samples, n_features])."""
    try:
        explainer = get_explainer(model_name, model)
        shap_vals = explainer.shap_values(X)
        # For tree models with two-class output shap_values returns a list [class0, class1]
        if isinstance(shap_vals, list) and len(shap_vals) == 2:
            return shap_vals[1]
        # For linear explainer it returns a 2-D array directly
        if isinstance(shap_vals, np.ndarray) and shap_vals.ndim == 3:
            return shap_vals[:, :, 1]
        return shap_vals
    except Exception as e:
        logger.warning(f"SHAP failed for {model_name}: {e}. Returning zeros.")
        return np.zeros((X.shape[0], len(FEATURE_COLS)))


def top_features(
    shap_row: np.ndarray,
    raw_values,
    top_n: int = 8,
) -> List[Tuple[str, float, object]]:
    """Return (feature_name, shap_value, raw_value) sorted by |shap| descending.

    raw_values may be a numpy numeric array (scaled) or an object array
    containing the original pre-scaling values including string categoricals.
    """
    shap_list = shap_row.tolist()
    raw_list = list(raw_values) if not isinstance(raw_values, list) else raw_values
    pairs = list(zip(FEATURE_COLS, shap_list, raw_list))
    pairs.sort(key=lambda x: abs(x[1]), reverse=True)
    return pairs[:top_n]
