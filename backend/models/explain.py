"""SHAP feature attribution — explains which features drove a single prediction.

SHAP gives each input feature a number (its "SHAP value") that says how much
it pushed the prediction up (towards fraud) or down (towards legitimate),
for one specific transaction. We just sort features by |SHAP value| and keep
the top few.
"""

import logging

import numpy as np
import shap
from sklearn.linear_model import LogisticRegression

from datautils.preprocess import FEATURE_COLS

logger = logging.getLogger(__name__)

_explainer_cache: dict = {}


def _build_explainer(model):
    # Logistic Regression is a simple weighted sum, so a lightweight linear
    # explainer works. Random Forest and XGBoost are trees, so they need
    # SHAP's tree-specific explainer instead.
    if isinstance(model, LogisticRegression):
        background = np.zeros((1, len(FEATURE_COLS)))
        return shap.LinearExplainer(model, background)
    return shap.TreeExplainer(model)


def get_shap_values(model_name: str, model, X: np.ndarray) -> np.ndarray:
    """Return one SHAP value per feature, per row, for the "fraud" class."""
    try:
        if model_name not in _explainer_cache:
            _explainer_cache[model_name] = _build_explainer(model)
        explainer = _explainer_cache[model_name]

        values = explainer.shap_values(X)
        if isinstance(values, list):  # tree models: [values_for_class_0, values_for_class_1]
            values = values[1]
        elif isinstance(values, np.ndarray) and values.ndim == 3:  # newer SHAP versions
            values = values[:, :, 1]
        return values
    except Exception as e:
        logger.warning(f"SHAP failed for {model_name}: {e}. Returning zeros.")
        return np.zeros((X.shape[0], len(FEATURE_COLS)))


def top_features(shap_row: np.ndarray, raw_row, top_n: int = 5) -> list:
    """Pair each feature with its SHAP value and its real (pre-scaling) value,
    sorted from most to least influential."""
    pairs = list(zip(FEATURE_COLS, shap_row, raw_row))
    pairs.sort(key=lambda pair: abs(pair[1]), reverse=True)
    return pairs[:top_n]
