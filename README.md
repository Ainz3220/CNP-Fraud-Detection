# CNP Fraud Detection System

A full-stack Card-Not-Present (CNP) fraud detection web application with a **React** frontend and **FastAPI** Python backend, deployable on Railway.

## Architecture

```
CNP-Fraud-Detection/
├── backend/                  # FastAPI Python API
│   ├── main.py               # App entry point & all endpoints
│   ├── models/
│   │   ├── train.py          # LR, RF, XGBoost training with SMOTE
│   │   ├── predict.py        # Single & batch prediction logic
│   │   └── explain.py        # SHAP attribution (Tree/Linear explainers)
│   ├── data/
│   │   └── preprocess.py     # Feature engineering & preprocessing pipeline
│   ├── database/
│   │   ├── db.py             # SQLAlchemy setup
│   │   └── models.py         # Predictions table schema
│   ├── utils/
│   │   ├── feature_engineering.py   # Haversine, age, hour, z-score
│   │   └── text_explainer.py        # SHAP → plain English sentences
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/                 # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/            # Dashboard, Predict, Batch, Retrain, History
│   │   ├── components/       # Navbar, FraudGauge, FeatureBar, etc.
│   │   └── services/api.js   # Axios API layer
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml        # Local development
├── railway.toml              # Railway deployment config
└── README.md
```

---

## Dataset

Download the Kaggle dataset [Credit Card Fraud](https://www.kaggle.com/datasets/kartik2112/fraud-detection) and place the files:

```
backend/data/fraudTrain.csv
backend/data/fraudTest.csv
```

On first startup the backend checks for saved models. If none exist and the CSV files are present, training begins automatically (takes ~5–10 minutes depending on hardware).

---

## Running Locally with Docker Compose

### Prerequisites
- Docker ≥ 24
- Docker Compose ≥ 2

### Steps

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

The backend will begin training models on first boot. Monitor progress at `http://localhost:8000/api/status`.

### Hot-reload (development)

The `docker-compose.yml` mounts `./backend` into the container. For live-reload install dependencies locally and run:

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

---

## Deploying to Railway

### Step 1 — Create a Railway project

1. Go to [railway.app](https://railway.app) and create a new project.
2. Choose **"Deploy from GitHub repo"** and connect your repository.

### Step 2 — Configure the backend service

1. In Railway, click **"New Service" → "GitHub Repo"**.
2. Set the root directory to `backend/`.
3. Railway will detect the `Dockerfile` automatically.
4. Add environment variables in the service settings:
   | Variable | Value |
   |---|---|
   | `MODEL_DIR` | `./saved_models` |
   | `DATA_DIR` | `./data` |
   | `DATABASE_URL` | `sqlite:///./fraud_detection.db` |
5. Under **Deploy**, set the start command:
   ```
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
6. Set the exposed port to `8000`.
7. Upload `fraudTrain.csv` and `fraudTest.csv` to the `/app/data/` directory via Railway's volume or build step.

### Step 3 — Configure the frontend service

1. Add another service pointing to `frontend/`.
2. Add the build argument:
   | Argument | Value |
   |---|---|
   | `VITE_API_URL` | `https://<your-backend-railway-url>` |
3. Set the exposed port to `3001`.

### Step 4 — Deploy

Click **Deploy** on both services. Railway will build the Docker images and start the containers. The backend will auto-train models on first boot if data files are present.

---

## API Endpoint Documentation

Base URL: `http://localhost:8000` (or your Railway backend URL)

### `GET /api/status`
Returns current model loading status and training progress.

**Response:**
```json
{
  "models_loaded": true,
  "training_status": { "status": "done", "progress": 100, "message": "Training complete." },
  "available_models": ["lr", "rf", "xgb"]
}
```

---

### `GET /api/metrics`
Returns current model performance metrics.

**Response:**
```json
{
  "lr": { "accuracy": 0.94, "precision": 0.88, "recall": 0.91, "f1": 0.89, "auc_roc": 0.97 },
  "rf": { ... },
  "xgb": { ... }
}
```

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
  "state": "CA",
  "distance_from_home": 450.5,
  "city_pop": 250000,
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
      "explanation": {
        "risk_factors": [ { "feature": "distance_from_home", "sentence": "...", "shap": 0.45 } ],
        "safe_factors": [ ... ]
      },
      "shap_features": [ { "feature": "amt", "shap": 0.32, "value": "149.99" }, ... ]
    }
  ],
  "combined_verdict": "FRAUD BLOCKED",
  "top_risk_factors": [ ... ],
  "top_safe_factors": [ ... ]
}
```

---

### `POST /api/predict/batch`
Run fraud prediction on a CSV file.

**Query params:** `models=lr,rf,xgb`

**Body:** `multipart/form-data` with a `file` field containing the CSV.

**Response:** A downloadable CSV with extra columns:
- `fraud_probability_lr`
- `fraud_probability_rf`
- `fraud_probability_xgb`
- `combined_verdict`
- `main_fraud_reason`

---

### `POST /api/retrain`
Retrain all models with additional labelled data.

**Body:** `multipart/form-data` with a `file` field containing a CSV that includes `is_fraud`.

**Response:**
```json
{
  "lr": {
    "model_name": "lr",
    "before": { "accuracy": 0.92, "precision": 0.85, ... },
    "after":  { "accuracy": 0.94, "precision": 0.89, ... }
  },
  "rf": { ... },
  "xgb": { ... }
}
```

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
| `date_from` | ISO date | Start date |
| `date_to` | ISO date | End date |

---

### `GET /api/history/stats`
Aggregate counts and 30-day daily trend for the dashboard.

---

## Using the Retrain Feature

1. Collect new labelled transactions in a CSV file.
2. Ensure it contains all the required columns (listed on the Retrain page).
3. The `is_fraud` column must be `0` or `1`.
4. Navigate to **Retrain** in the app, upload the file, and click **Start Retraining**.
5. The backend merges your new data with the original training set, re-applies SMOTE, retrains all three models, and returns a before/after metrics comparison.

---

## Dataset Schema Requirements for Upload

Both batch prediction and retrain uploads expect these columns (same schema as the Kaggle dataset):

| Column | Type | Description |
|---|---|---|
| `trans_date_trans_time` | datetime string | Transaction datetime |
| `cc_num` | int/string | Credit card number |
| `merchant` | string | Merchant name |
| `category` | string | Merchant category |
| `amt` | float | Transaction amount (USD) |
| `gender` | string | `M` or `F` |
| `city` | string | Cardholder city |
| `state` | string | 2-letter US state code |
| `zip` | int | Zip code |
| `lat` | float | Cardholder latitude |
| `long` | float | Cardholder longitude |
| `city_pop` | int | City population |
| `job` | string | Cardholder occupation |
| `dob` | date string | Date of birth |
| `trans_num` | string | Unique transaction ID |
| `unix_time` | int | Unix timestamp |
| `merch_lat` | float | Merchant latitude |
| `merch_long` | float | Merchant longitude |
| `is_fraud` | int | `1` = fraud, `0` = legitimate *(retrain only)* |

---

## Feature Engineering Details

| Feature | Source | Description |
|---|---|---|
| `hour_of_day` | `trans_date_trans_time` | Hour extracted (0–23) |
| `age` | `dob` | Years since date of birth |
| `distance_from_home` | `lat/long` vs `merch_lat/merch_long` | Haversine distance in miles |
| `amt_zscore` | `amt` + `category` | Z-score of amount relative to merchant category |

---

## Models

| ID | Model | Badge | Notes |
|---|---|---|---|
| `lr` | Logistic Regression | Baseline | Linear, fast inference, SHAP via LinearExplainer |
| `rf` | Random Forest | Main | 100 trees, SHAP via TreeExplainer |
| `xgb` | XGBoost | Advanced | Gradient boosting, SHAP via TreeExplainer |

All models trained with `random_state=42` and SMOTE (`random_state=42`) for reproducibility.

---

## Verdict Thresholds

| Fraud Probability | Verdict |
|---|---|
| < 40% | ✅ APPROVED |
| 40% – 69% | ⚠️ REVIEW REQUIRED |
| ≥ 70% | 🚫 FRAUD BLOCKED |

When multiple models are selected the **combined verdict** is determined by majority vote.
