"""
evaluate_ensemble.py
Run locally from the repository root (same environment used for training).

Produces the two pieces of evidence requested by the examiner (Round 2,
Priority Actions 5 and 6):

  1. Ensemble three-tier verdict confusion matrix on the FULL validation set
     (58,971 transactions), applying the escalation rule:
        FRAUD BLOCKED  if p_i >= t_i for any model i
        REVIEW REQUIRED if min(0.30, 0.5*t_i) <= p_i < t_i for any model i
        APPROVED       otherwise
  2. Threshold-sensitivity table for RF and XGBoost (F1 at 0.30/0.35/0.40/0.45/0.50
     and at the raw F1-optimal thresholds) to justify the 0.40 cap.

Outputs: ensemble_results.json and two printed tables.

Reproduces the exact validation split used by backend/models/train.py by
loading the cached preprocessed feature matrix (X_all/y_all) that training
already saved, rather than re-running feature engineering from scratch.
"""

import json
import sys
import joblib
import numpy as np

# The cached pipeline object was pickled while backend/ was on sys.path
# (train.py does `from datautils.preprocess import ...`), so unpickling it
# here requires the same module path to be resolvable.
sys.path.insert(0, "backend")

# ---------------------------------------------------------------- PATHS -----
MODEL_DIR = "backend/saved_models"
MODEL_PKLS = {
    "lr": f"{MODEL_DIR}/lr_model.pkl",
    "rf": f"{MODEL_DIR}/rf_model.pkl",
    "xgb": f"{MODEL_DIR}/xgb_model.pkl",
}
CACHE_PKL = f"{MODEL_DIR}/preprocess_cache_cnp_v2.pkl"

# Deployed (capped) thresholds; LR keeps its raw threshold
THRESHOLDS = {"lr": 0.9865, "rf": 0.40, "xgb": 0.40}
# Raw F1-optimal thresholds before capping (for the sensitivity table)
RAW_THRESHOLDS = {"rf": 0.9451, "xgb": 0.9217}


def load_validation_set():
    """Reload the exact X_all/y_all matrix train.py cached during training and
    reproduce its positional 60/20/20 train/calibration/validation split."""
    cached = joblib.load(CACHE_PKL)
    X_all, y_all = cached["X_all"], cached["y_all"]

    n = len(X_all)
    train_end = int(n * 0.60)
    cal_end = int(n * 0.80)
    X_val, y_val = X_all[cal_end:], y_all[cal_end:]

    partitions = {
        "train": {"n": train_end, "fraud": int(y_all[:train_end].sum())},
        "calibration": {"n": cal_end - train_end, "fraud": int(y_all[train_end:cal_end].sum())},
        "validation": {"n": n - cal_end, "fraud": int(y_val.sum())},
    }
    return X_val, y_val, partitions


def verdict(p, t):
    if p >= t:
        return "FRAUD BLOCKED"
    if min(0.30, 0.5 * t) <= p < t:
        return "REVIEW REQUIRED"
    return "APPROVED"


ESCALATION_RANK = {"APPROVED": 0, "REVIEW REQUIRED": 1, "FRAUD BLOCKED": 2}


def main():
    X_val, y_val, partitions = load_validation_set()
    print("Partition summary (paste into Table 5):")
    print(json.dumps(partitions, indent=2))

    models, probs = {}, {}
    for name, path in MODEL_PKLS.items():
        models[name] = joblib.load(path)
        probs[name] = models[name].predict_proba(X_val)[:, 1]

    # ---- 1. Ensemble three-tier confusion matrix -----------------------
    per_model = {
        name: [verdict(p, THRESHOLDS[name]) for p in probs[name]]
        for name in models
    }
    combined = [
        max((per_model[m][i] for m in models), key=ESCALATION_RANK.get)
        for i in range(len(y_val))
    ]

    tiers = ["APPROVED", "REVIEW REQUIRED", "FRAUD BLOCKED"]
    matrix = {
        cls: {t: 0 for t in tiers} for cls in ("legitimate", "fraud")
    }
    for v, y in zip(combined, y_val):
        matrix["fraud" if y == 1 else "legitimate"][v] += 1

    print("\nEnsemble three-tier verdict matrix (validation set):")
    print(f"{'':>12} | " + " | ".join(f"{t:>16}" for t in tiers))
    for cls in ("legitimate", "fraud"):
        print(f"{cls:>12} | " + " | ".join(f"{matrix[cls][t]:>16,}" for t in tiers))

    blocked_fraud = matrix["fraud"]["FRAUD BLOCKED"]
    blocked_leg = matrix["legitimate"]["FRAUD BLOCKED"]
    total_fraud = int(np.sum(y_val))
    prec = blocked_fraud / max(blocked_fraud + blocked_leg, 1)
    rec = blocked_fraud / max(total_fraud, 1)
    print(f"\nEnsemble BLOCK precision: {prec:.4f}  recall: {rec:.4f}")
    print("(Expect precision to be bounded below by LR's false positives - "
        "this is the measured cost of escalation.)")

    # ---- 2. Threshold sensitivity for the 0.40 cap ---------------------
    from sklearn.metrics import precision_score, recall_score, f1_score

    print("\nThreshold sensitivity (paste into Section 3.6.6 justification):")
    header = f"{'model':>6} | {'threshold':>9} | {'precision':>9} | {'recall':>7} | {'F1':>7}"
    print(header)
    for name in ("rf", "xgb"):
        cand = [0.30, 0.35, 0.40, 0.45, 0.50, RAW_THRESHOLDS[name]]
        for t in cand:
            pred = (probs[name] >= t).astype(int)
            print(
                f"{name:>6} | {t:>9.4f} | "
                f"{precision_score(y_val, pred):>9.4f} | "
                f"{recall_score(y_val, pred):>7.4f} | "
                f"{f1_score(y_val, pred):>7.4f}"
            )

    out = {
        "partitions": partitions,
        "ensemble_matrix": matrix,
        "ensemble_block_precision": prec,
        "ensemble_block_recall": rec,
    }
    with open("ensemble_results.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\nSaved ensemble_results.json - upload it (or paste the printed "
          "tables) back into the chat.")


if __name__ == "__main__":
    main()
