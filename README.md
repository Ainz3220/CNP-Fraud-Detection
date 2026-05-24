# CNP Fraud Detection System

A full-stack Card-Not-Present (CNP) fraud detection web application with a **React** frontend and **FastAPI** Python backend, deployable on Railway.

---

## Architecture

```
CNP-Fraud-Detection/
├── backend/                  # FastAPI Python API
│   ├── main.py               # App entry point & all endpoints
│   ├── models/
│   │   ├── train.py          # LR, RF, XGBoost training pipeline
│   │   ├── predict.py        # Single & batch prediction logic
│   │   └── explain.py        # SHAP attribution (Tree/Linear explainers)
│   ├── datautils/
│   │   ├── preprocess.py     # PreprocessingPipeline (fit/transform/save/load)
│   │   └── upload.py         # CSV validation helpers
│   ├── data/
│   │   ├── fraudTrain.csv    # Primary training data (place here)
│   │   ├── fraudTest.csv     # Primary test data (place here)
│   │   └── mauritius_finetune.csv  # Supplementary Mauritius data
│   ├── database/
│   │   ├── db.py             # SQLAlchemy setup
│   │   └── models.py         # Predictions table schema
│   ├── utils/
│   │   ├── feature_engineering.py   # Haversine, age, hour, z-score
│   │   └── text_explainer.py        # SHAP → plain English sentences
│   ├── saved_models/         # Generated at runtime
│   │   ├── lr_model.pkl
│   │   ├── rf_model.pkl
│   │   ├── xgb_model.pkl
│   │   ├── pipeline.pkl
│   │   └── metrics.json
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/                 # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/            # Dashboard, Predict, BatchPredict, Retrain, History
│   │   ├── components/       # Navbar, FraudGauge, FeatureBar, ModelSelector, etc.
│   │   └── services/api.js   # Axios API layer
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml
├── railway.toml
├── CNP_Fraud_Detection_Report.md
└── README.md
```

---

## Dataset

Download the Kaggle dataset [Credit Card Fraud Detection](https://www.kaggle.com/datasets/kartik2112/fraud-detection) and place the files:

```
backend/data/fraudTrain.csv
backend/data/fraudTest.csv
```

On first startup the backend checks for saved models. If none exist and the CSV files are present, training begins automatically (takes ~10–20 minutes depending on hardware).

To reset and retrain from scratch, delete the contents of `backend/saved_models/` (keep the folder) and restart the server.

---

## Running Locally

### Option A — Docker Compose

**Prerequisites:** Docker ≥ 24, Docker Compose ≥ 2

```bash
# 1. Clone the repository
git clone <repo-url>
cd CNP-Fraud-Detection

# 2. Place the dataset CSVs
cp /path/to/fraudTrain.csv backend/data/
cp /path/to/fraudTest.csv  backend/data/

# 3. Build and start both services
docker-compose up --build

# 4. Open the app
#    Frontend:  http://localhost:3001
#    API docs:  http://localhost:8000/docs
```

### Option B — Local Development (hot-reload)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Monitor training progress at `http://localhost:8000/api/status`.

---

## Deploying to Railway

### Step 1 — Create a Railway project

1. Go to [railway.app](https://railway.app) and create a new project.
2. Choose **"Deploy from GitHub repo"** and connect your repository.

### Step 2 — Configure the backend service

1. Click **"New Service" → "GitHub Repo"**, root directory: `backend/`.
2. Railway detects the `Dockerfile` automatically.
3. Add environment variables:

| Variable | Value |
|---|---|
| `MODEL_DIR` | `./saved_models` |
| `DATA_DIR` | `./data` |
| `DATABASE_URL` | `sqlite:///./fraud_detection.db` |
| `UPLOAD_SECRET` | *(optional — protects the model upload endpoint)* |

4. Start command: `uvicorn main:app --host 0.0.0.0 --port 8000`
5. Exposed port: `8000`

### Step 3 — Configure the frontend service

1. Add another service, root directory: `frontend/`.
2. Build argument:

| Argument | Value |
|---|---|
| `VITE_API_URL` | `https://<your-backend-railway-url>` |

3. Exposed port: `3001`

### Step 4 — Deploy

Click **Deploy** on both services. The backend auto-trains on first boot if CSV files are present.

---

## Models

| ID | Model | Role | Key Configuration |
|---|---|---|---|
| `lr` | Logistic Regression | Baseline / sensitivity net | `class_weight='balanced'`, `max_iter=1000` |
| `rf` | Random Forest | High-precision detector | `n_estimators=200`, `max_depth=8`, `min_samples_leaf=10`, `class_weight='balanced'` |
| `xgb` | XGBoost | Advanced detector | `n_estimators=100`, `scale_pos_weight` computed dynamically from training class ratio |

All models use `random_state=42` for reproducibility. No synthetic oversampling (SMOTE) is used — class imbalance is handled natively by each model's weighting mechanism.

---

## Training Pipeline

1. **Data split**: 60% train / 20% calibration holdout / 20% validation
2. **Class balancing**: `class_weight='balanced'` (LR, RF) and `scale_pos_weight` (XGBoost)
3. **Threshold selection**: Per-model optimal threshold is computed by maximising F1-score on the validation set precision-recall curve
4. **Persistence**: Models saved as `.pkl` files; preprocessing pipeline saved separately as `pipeline.pkl`

---

## Ensemble Verdict Logic

Predictions from all three models are combined using a conservative escalation strategy:

**Per-model verdict zones:**

| Condition | Verdict |
|---|---|
| `prob < threshold × 0.5` | ✅ APPROVED |
| `threshold × 0.5 ≤ prob < threshold` | ⚠️ REVIEW REQUIRED |
| `prob ≥ threshold` | 🚫 FRAUD BLOCKED |

> LR uses its own calibrated threshold (~0.9865). RF and XGBoost thresholds are capped at 0.40 to prevent their high-precision optimal thresholds from suppressing fraud signals on novel inputs.

**Combined verdict:**

```
Any model → FRAUD BLOCKED   ⟹  combined = FRAUD BLOCKED
Any model → REVIEW REQUIRED ⟹  combined = REVIEW REQUIRED
All models → APPROVED       ⟹  combined = APPROVED
```

False negatives (missed fraud) are treated as more costly than false positives, justifying the single-model escalation rule.

---

## API Reference

Base URL: `http://localhost:8000` (or your Railway backend URL). Interactive docs at `/docs`.

### `GET /api/status`
Returns model loading status and training progress.

```json
{
  "models_loaded": true,
  "training_status": { "status": "done", "progress": 100, "message": "Training complete." },
  "available_models": ["lr", "rf", "xgb"]
}
```

---

### `GET /api/metrics`
Returns current model performance metrics including accuracy, precision, recall, F1, AUC-ROC, PR-AUC, and confusion matrix per model.

---

### `POST /api/predict`
Predict fraud for a single transaction.

**Query params:** `models=lr,rf,xgb` (comma-separated, default all three)

**Request body:**
```json
{
  "amt": 149.99,
  "category": "shopping_net",
  "hour_of_day": 2,
  "age": 35,
  "distance_from_home": 450.5,
  "gender": "F"
}
```

**Response:**
```json
{
  "model_results": [
    {
      "model_name": "xgb",
      "fraud_probability": 0.87,
      "verdict": "FRAUD BLOCKED",
      "explanation": { "risk_factors": [...], "safe_factors": [...] },
      "shap_features": [{ "feature": "amt", "shap": 0.32, "value": "149.99" }]
    }
  ],
  "combined_verdict": "FRAUD BLOCKED",
  "top_risk_factors": [...],
  "top_safe_factors": [...]
}
```

---

### `POST /api/predict/batch`
Run fraud prediction on a CSV file.

**Query params:** `models=lr,rf,xgb`

**Body:** `multipart/form-data` with a `file` field containing the CSV.

**Response:** Downloadable CSV with added columns:
- `fraud_probability_lr`, `fraud_probability_rf`, `fraud_probability_xgb`
- `combined_verdict`
- `main_fraud_reason`

---

### `POST /api/predict/batch/stream`
Same as batch but streams progress as Server-Sent Events, used by the frontend for real-time progress bars.

---

### `POST /api/retrain`
Retrain all models with additional labelled data merged into the original training set.

**Query params:** `currency=USD` (default) or `currency=MUR` — if MUR, `amt` values are divided by 49 before merging.

**Body:** `multipart/form-data` with a `file` field containing a labelled CSV (`is_fraud` column required).

**Response:** Before/after metrics comparison per model.

---

### `POST /api/models/upload`
Upload pre-trained model files directly (for Railway deployments where training on server is impractical).

**Headers:** `X-Upload-Secret: <UPLOAD_SECRET>`

**Body:** `multipart/form-data` — accepts `lr_model.pkl`, `rf_model.pkl`, `xgb_model.pkl`, `pipeline.pkl`, `metrics.json`.

---

### `GET /api/history`
Paginated list of all past predictions.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `page` | int | Page number (default 1) |
| `limit` | int | Rows per page (default 20, max 100) |
| `verdict_filter` | string | `APPROVED`, `REVIEW REQUIRED`, or `FRAUD BLOCKED` |
| `model_filter` | string | `lr`, `rf`, or `xgb` |
| `date_from` | ISO date | Start date filter |
| `date_to` | ISO date | End date filter |

---

### `GET /api/history/stats`
Aggregate counts and 30-day daily trend for the dashboard.

---

### `POST /api/feedback/{prediction_id}`
Submit analyst label for a past prediction.

**Query params:** `label=0` (legitimate) or `label=1` (fraud)

---

## Retrain Feature

1. Collect new labelled transactions in a CSV file with the required schema.
2. The `is_fraud` column must be `0` or `1`.
3. If amounts are in MUR (Mauritian Rupees), append `?currency=MUR` to the request.
4. Navigate to **Retrain** in the app, upload the file, and click **Start Retraining**.
5. The backend merges your data with the original training set, retrains all three models, and returns a before/after metrics comparison.

Analyst feedback submitted via the History page is also automatically merged into the next retrain.

---

## CSV Schema for Upload

Both batch prediction and retrain uploads require these columns:

| Column | Type | Required for |
|---|---|---|
| `trans_date_trans_time` | datetime string | Both |
| `cc_num` | int/string | Both |
| `merchant` | string | Both |
| `category` | string | Both |
| `amt` | float | Both |
| `gender` | string (`M`/`F`) | Both |
| `lat` | float | Both |
| `long` | float | Both |
| `merch_lat` | float | Both |
| `merch_long` | float | Both |
| `dob` | date string | Both |
| `city` | string | Both |
| `job` | string | Both |
| `trans_num` | string | Both |
| `unix_time` | int | Both |
| `is_fraud` | int (`0`/`1`) | Retrain only |

---

## Resetting the Database

The prediction history is stored in `backend/fraud_detection.db` (SQLite). To clear all history:

1. Stop the backend server.
2. Delete `backend/fraud_detection.db`.
3. Restart — the database is recreated automatically on startup.

---

## Feature Engineering

| Feature | Derived From | Description |
|---|---|---|
| `hour_of_day` | `trans_date_trans_time` | Hour extracted (0–23) |
| `age` | `dob` | Years since date of birth |
| `distance_from_home` | cardholder vs merchant lat/long | Haversine great-circle distance in miles |
| `amt_zscore` | `amt` + `category` | Standard deviations from merchant category mean |
