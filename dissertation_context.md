# CNP Fraud Detection — Dissertation Context Reference

> Generated: 2026-05-24  
> Branch: main

---

## 1. Folder / File Structure

```
CNP-Fraud-Detection/
├── README.md
├── CNP_Fraud_Detection_Report.md
├── TO DO
├── dissertation_context.md          ← this file
│
├── backend/
│   ├── main.py                      ← FastAPI app entry point, all route definitions
│   ├── fraud_detection.db           ← SQLite database (auto-created on startup)
│   ├── requirements.txt
│   ├── .env / .env.example
│   │
│   ├── data/
│   │   ├── fraudTrain.csv           ← primary training dataset
│   │   ├── fraudTest.csv            ← held-out test dataset
│   │   ├── mauritius_finetune.csv   ← Mauritius-specific fine-tuning data
│   │   ├── preprocess.py            ← (legacy, superseded by datautils/)
│   │   └── __init__.py
│   │
│   ├── database/
│   │   ├── db.py                    ← SQLAlchemy engine, session factory, schema migrations
│   │   ├── models.py                ← Prediction ORM model
│   │   └── __init__.py
│   │
│   ├── datautils/
│   │   ├── preprocess.py            ← PreprocessingPipeline class, feature column definitions
│   │   ├── upload.py                ← CSV validation helpers for predict/retrain uploads
│   │   └── __init__.py
│   │
│   ├── models/
│   │   ├── train.py                 ← build_models(), train(), evaluate_model(), retrain_with_new_data()
│   │   ├── predict.py               ← predict_single(), predict_batch(), verdict logic
│   │   ├── explain.py               ← SHAP explainers (LinearExplainer / TreeExplainer)
│   │   └── __init__.py
│   │
│   ├── utils/
│   │   ├── feature_engineering.py   ← haversine distance, hour extraction, age calc, amt z-score
│   │   └── text_explainer.py        ← human-readable SHAP narrative generator
│   │
│   └── saved_models/                ← auto-created by training
│       ├── lr_model.pkl
│       ├── rf_model.pkl
│       ├── xgb_model.pkl
│       ├── pipeline.pkl
│       ├── metrics.json
│       └── preprocess_cache.pkl     ← MD5-keyed preprocessing cache
│
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── services/
        │   └── api.js               ← Axios wrapper for all backend calls
        ├── pages/
        │   ├── Dashboard.jsx        ← summary stats + daily trend chart
        │   ├── Predict.jsx          ← single-transaction prediction form
        │   ├── BatchPredict.jsx     ← CSV upload + streaming progress
        │   ├── History.jsx          ← paginated prediction history with filters
        │   └── Retrain.jsx          ← new-data upload + before/after metrics
        └── components/
            ├── Navbar.jsx
            ├── FraudGauge.jsx
            ├── ModelSelector.jsx
            ├── ExplanationCard.jsx
            ├── MetricsTable.jsx
            ├── PredictionResult.jsx
            └── FeatureBar.jsx
```

---

## 2. API Endpoints

Base URL (local dev): `http://localhost:8000`

### GET `/api/status`
Check whether models are loaded and training progress.

**Response**
```json
{
  "models_loaded": true,
  "training_status": { "status": "done", "progress": 100, "message": "Training complete." },
  "available_models": ["lr", "rf", "xgb"]
}
```

---

### GET `/api/metrics`
Return per-model evaluation metrics from `metrics.json`.

**Response** — see Section 5 for the full metrics structure.

---

### POST `/api/predict`
Classify a single transaction.

**Query params**
| Param | Default | Description |
|-------|---------|-------------|
| `models` | `lr,rf,xgb` | Comma-separated list of models to run |

**Request body** (`application/json`)
```json
{
  "amt": 150.00,
  "category": "grocery_pos",
  "hour_of_day": 14,
  "age": 35,
  "distance_from_home": 2.5,
  "gender": "M",
  "cc_num": "1234567890123456",
  "lat": -20.1654,
  "long": 57.4896,
  "merch_lat": -20.2000,
  "merch_long": 57.5000,
  "trans_date_trans_time": "2024-06-01 14:30:00",
  "merchant": "Jumbo",
  "dob": "1989-03-15",
  "job": "Engineer",
  "zip": 11001,
  "city": "Port Louis",
  "unix_time": 1717245000,
  "trans_num": "abc123"
}
```

Only `amt` and `category` are required; all other fields are optional with sensible defaults.

**Response**
```json
{
  "model_results": [
    {
      "model_name": "xgb",
      "fraud_probability": 0.0312,
      "verdict": "APPROVED",
      "explanation": { "summary": "...", "risk_factors": [], "safe_factors": [] },
      "shap_features": [
        { "feature": "amt", "shap": -0.12, "value": "150.0" }
      ]
    }
  ],
  "combined_verdict": "APPROVED",
  "top_risk_factors": [{ "feature": "amt_zscore", "shap": 0.08 }],
  "top_safe_factors": [{ "feature": "distance_from_home", "shap": 0.05 }]
}
```

Verdict logic:
- `prob < review_lower` → **APPROVED**
- `review_lower ≤ prob < threshold` → **REVIEW REQUIRED**
- `prob ≥ threshold` → **FRAUD BLOCKED**

Where `review_lower = min(0.30, threshold × 0.5)`. Thresholds are per-model optimal values from metrics.json, capped at 0.40 for tree models.

Multi-model: any single FRAUD BLOCKED verdict triggers FRAUD BLOCKED in the combined result.

---

### POST `/api/predict/batch`
Upload a CSV for bulk prediction. Returns a CSV file download.

**Form data**: `file` (CSV), query param `models`  
**Required CSV columns**: `amt`, `category`  
**Optional columns**: same as single predict  
**Response**: `text/csv` with `Content-Disposition: attachment; filename=batch_predictions.csv`

Added columns per model: `fraud_probability_<model>`, `combined_verdict`, `main_fraud_reason`.

---

### POST `/api/predict/batch/stream`
Same as batch but streams results as Server-Sent Events in chunks of 20 rows.

**SSE event types**:
```json
{ "type": "progress", "processed": 20, "total": 100 }
{ "type": "done", "csv": "<full csv string>" }
```

---

### POST `/api/feedback/{prediction_id}`
Record analyst ground-truth label for a previous prediction.

**Path param**: `prediction_id` (integer)  
**Query param**: `label` — `0` (legitimate) or `1` (fraud)

**Response**
```json
{ "id": 42, "analyst_label": 1 }
```

---

### POST `/api/retrain`
Upload new labeled data and retrain all models. Merges with original training set and any DB feedback rows.

**Form data**: `file` (CSV with `amt`, `category`, `is_fraud`), query param `currency` (`USD` or `MUR`)  
MUR amounts are divided by 49.0 to convert to USD before merging.

**Response** — before/after comparison per model:
```json
{
  "lr": { "model_name": "lr", "before": { "accuracy": 0.994, ... }, "after": { "accuracy": 0.995, ... } },
  "rf": { ... },
  "xgb": { ... }
}
```

---

### POST `/api/models/upload`
Upload pre-trained model files from a local machine (for deployment without in-situ training).

**Headers**: `X-Upload-Secret: <secret>` (required if `UPLOAD_SECRET` env var is set)  
**Form data**: multipart files — any subset of `lr_model.pkl`, `rf_model.pkl`, `xgb_model.pkl`, `pipeline.pkl`, `metrics.json`

**Response**
```json
{ "uploaded": ["lr_model.pkl", "metrics.json"], "models_loaded": true }
```

---

### GET `/api/history`
Paginated prediction history with optional filters.

**Query params**
| Param | Type | Description |
|-------|------|-------------|
| `page` | int (≥1) | Page number (default 1) |
| `limit` | int (1–100) | Results per page (default 20) |
| `verdict_filter` | string | `APPROVED`, `REVIEW REQUIRED`, `FRAUD BLOCKED` |
| `model_filter` | string | `lr`, `rf`, or `xgb` |
| `date_from` | ISO datetime | Filter from this timestamp |
| `date_to` | ISO datetime | Filter to this timestamp |

**Response**
```json
{
  "total": 500,
  "page": 1,
  "limit": 20,
  "pages": 25,
  "items": [
    {
      "id": 1,
      "timestamp": "2026-05-24T10:00:00",
      "amount": 150.00,
      "category": "grocery_pos",
      "model_used": "xgb",
      "fraud_probability": 0.0312,
      "verdict": "APPROVED",
      "main_reason": "amt_zscore",
      "explanation": { ... },
      "transaction_data": { ... },
      "analyst_label": null,
      "feedback_at": null
    }
  ]
}
```

---

### GET `/api/history/stats`
Aggregate statistics for the dashboard.

**Response**
```json
{
  "total_predictions": 500,
  "fraud_detected": 30,
  "review_required": 45,
  "legitimate": 425,
  "legitimacy_rate": 85.0,
  "daily_trend": [
    { "date": "2026-05-24", "fraud": 3, "legitimate": 42, "review": 5 }
  ]
}
```

---

## 3. Final Model Hyperparameters

### Logistic Regression (`lr`)
| Parameter | Value |
|-----------|-------|
| `max_iter` | 1000 |
| `random_state` | 42 |
| `class_weight` | `balanced` |
| Solver | default (`lbfgs`) |
| SHAP explainer | `LinearExplainer` (zero background) |

### Random Forest (`rf`)
| Parameter | Value |
|-----------|-------|
| `n_estimators` | 200 |
| `max_depth` | 8 |
| `min_samples_leaf` | 10 |
| `class_weight` | `balanced` |
| `random_state` | 42 |
| `n_jobs` | -1 |
| SHAP explainer | `TreeExplainer` |

### XGBoost (`xgb`)
| Parameter | Value |
|-----------|-------|
| `n_estimators` | 100 |
| `scale_pos_weight` | ~172.63 (ratio of legit:fraud in training split) |
| `random_state` | 42 |
| `eval_metric` | `logloss` |
| `tree_method` | `hist` |
| `use_label_encoder` | `False` |
| SHAP explainer | `TreeExplainer` |

`scale_pos_weight` is computed dynamically at training time: `(# negative samples) / (# positive samples)` in the 60% training split.

---

## 4. Training Pipeline Steps (in order)

1. **Load raw data** — Read `fraudTrain.csv`; if `fraudTest.csv` exists, concatenate both into a single DataFrame. Merge any `extra_df` (new/fine-tune data) if provided.

2. **Cache check** — Compute MD5 hash of input file paths + sizes + mtimes. If a matching `preprocess_cache.pkl` exists in `saved_models/`, skip steps 3–6 and load `(pipeline, X_all, y_all)` from cache.

3. **Feature engineering** (`engineer_features`)
   - Extract `hour_of_day` from `trans_date_trans_time`
   - Calculate `age` from `dob` (clamped 18–100)
   - Compute `distance_from_home` via haversine formula (lat/lon of cardholder home vs merchant)
   - Compute `amt_zscore` — amount z-score within merchant category (using `category_stats`)

4. **Category stats** (`build_category_stats`) — per-category mean/std of `amt`, plus global fallback `__global__`.

5. **Re-engineer features** with correct category stats (two-pass required so stats are available for z-score).

6. **Fit preprocessors** — `StandardScaler` for each numeric feature; `LabelEncoder` for `category` and `gender`. Build `home_coords` lookup (cc_num → median lat/lon).

7. **Save preprocessing cache** — serialised pipeline + full `X_all` / `y_all` to `preprocess_cache.pkl`.

8. **Train/calibration/validation split** — chronological 60/20/20 split:
   - 0–60%: `X_train / y_train` — model fitting
   - 60–80%: `X_cal / y_cal` — reserved (not currently used for post-hoc calibration)
   - 80–100%: `X_val / y_val` — evaluation

9. **Compute `scale_pos_weight`** for XGBoost: `neg_count / pos_count` from training split.

10. **Fit all three models** sequentially on `X_train / y_train`.

11. **Evaluate each model** on `X_val / y_val`:
    - Compute probabilities via `predict_proba`
    - Find F1-optimal threshold using the precision–recall curve
    - Compute accuracy, precision, recall, F1, AUC-ROC, PR-AUC, confusion matrix
    - Downsample PR curve to ~50 points for storage

12. **Save artefacts** — `lr_model.pkl`, `rf_model.pkl`, `xgb_model.pkl`, `pipeline.pkl`, `metrics.json`.

13. **Load into memory** — models, pipeline, and metrics are loaded into global state and served by the API.

---

## 5. Final Metrics Table

Evaluated on the 20% validation split (chronological; ~370,479 rows, ~1,349 fraud cases).  
Training completed: **2026-05-24T07:11:31Z**  
Total samples: **1,852,394** | Fraud: **9,651** (0.52%) | Legit: **1,842,743**  
XGBoost `scale_pos_weight`: **172.63**

| Metric | Logistic Regression | Random Forest | XGBoost |
|--------|-------------------|---------------|---------|
| Accuracy | 0.9940 | 0.9987 | **0.9989** |
| Precision | 0.2929 | 0.8413 | **0.9169** |
| Recall | 0.4514 | **0.7821** | 0.7687 |
| F1 Score | 0.3553 | 0.8106 | **0.8363** |
| AUC-ROC | 0.8746 | 0.9955 | **0.9975** |
| PR-AUC | 0.1403 | 0.8340 | **0.8842** |
| Optimal Threshold | 0.9865 | 0.9521 | 0.9909 |

**Confusion Matrices** (at optimal threshold):

| | LR | RF | XGB |
|---|---|---|---|
| True Negatives | 367,660 | 368,931 | 369,036 |
| False Positives | 1,470 | 199 | 94 |
| False Negatives | 740 | 294 | 312 |
| True Positives | 609 | 1,055 | 1,037 |

Runtime thresholds applied by the API differ from optimal thresholds: tree models (RF, XGB) are capped at 0.40 to prevent excessively high thresholds from suppressing verdicts at inference time. LR uses its full calibrated threshold (0.9865).

---

## 6. Known Limitations and Issues Encountered

### Dataset Limitations
- **Severe class imbalance** (~0.52% fraud): addressed with `class_weight="balanced"` (LR, RF) and `scale_pos_weight` (XGB). SMOTE was listed as a dependency (`imbalanced-learn`) but not applied in the final pipeline — the imbalanced-learn import is present but the SMOTE call was removed in favour of native class weighting.
- **US-centric dataset** (Kaggle credit card transaction data): geographic coordinates and merchant categories reflect US patterns. The Mauritius fine-tune CSV (`mauritius_finetune.csv`) exists but is not automatically merged at startup — it must be submitted via `/api/retrain`.
- **Currency mismatch**: MUR amounts submitted via retrain are divided by a fixed exchange rate of 49.0 MUR/USD, which does not track live rates.

### Threshold Behaviour
- Optimal thresholds found by PR-curve maximisation are very high (0.95–0.99) because the dataset is so imbalanced. Raw thresholds would cause most high-probability predictions to appear as "APPROVED" in production. The 0.40 runtime cap for tree models is a workaround.
- LR optimal threshold (0.9865) reflects poor calibration — probabilities are compressed near 0 and 1 rather than being well-distributed.

### Logistic Regression Underperformance
- LR precision (0.29) is substantially lower than RF/XGB. LR's linear decision boundary cannot capture the non-linear interaction between `distance_from_home`, `amt_zscore`, and time-of-day that tree models learn.

### SHAP / Explainability
- `LinearExplainer` uses an all-zeros background which may produce slightly misleading base values for LR; a sampled background would be more accurate but was not used to keep inference latency low.
- `TreeExplainer` results are cached per-model in memory; the cache is invalidated on every retrain or model upload.

### Data Pipeline
- The calibration split (20% of data, rows 60–80%) is computed but never used for probability calibration (e.g., Platt scaling or isotonic regression). This was an intended improvement that was not implemented.
- `preprocess_cache.pkl` is keyed by file path + size + mtime. If the CSV is replaced with a same-size file, the stale cache will be used.

### Deployment
- The app trains automatically on startup if no models are found. On constrained servers (e.g., Railway free tier), training 1.85M rows can time out or exhaust memory. The `/api/models/upload` endpoint was added to allow pre-trained artefacts to be pushed instead.
- `CORS allow_origins=["*"]` is intentional for the dissertation demo but is not safe for production.
- SQLite is used as the default database. Concurrent write throughput is limited; a PostgreSQL `DATABASE_URL` can be provided via env var for production.

---

## 7. Libraries and Versions

From `backend/requirements.txt`:

| Library | Version | Purpose |
|---------|---------|---------|
| `fastapi` | 0.111.0 | REST API framework |
| `uvicorn[standard]` | 0.29.0 | ASGI server |
| `scikit-learn` | 1.4.2 | LR, RF, preprocessing, metrics |
| `xgboost` | 2.0.3 | XGBoost classifier |
| `imbalanced-learn` | 0.12.2 | SMOTE (imported, not used in final pipeline) |
| `shap` | 0.45.0 | Feature attribution / explainability |
| `pandas` | 2.2.2 | DataFrame manipulation |
| `numpy` | 1.26.4 | Numerical operations |
| `joblib` | 1.4.2 | Model serialisation / parallelism |
| `sqlalchemy` | 2.0.30 | ORM + database migrations |
| `python-multipart` | 0.0.9 | Multipart form data (file uploads) |
| `aiofiles` | 23.2.1 | Async file I/O |
| `python-dotenv` | 1.0.1 | `.env` file loading |
| `scipy` | 1.13.0 | Statistical utilities |
| `pydantic` | 2.7.1 | Request/response schema validation |
| `pydantic-settings` | 2.2.1 | Settings management |
| `httpx` | 0.27.0 | Async HTTP client (testing / internal calls) |

**Frontend** (React + Vite stack, not versioned in requirements.txt):
- React 18, React Router v6, Recharts (charting), Tailwind CSS, date-fns, Axios
