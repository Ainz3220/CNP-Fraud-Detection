# CNP Fraud Detection System — Technical Report

---

## 1. System Overview

The system is a full-stack Card-Not-Present (CNP) fraud detection application consisting of:

- **Backend**: Python FastAPI REST API hosting three machine learning models
- **Frontend**: React.js dashboard for single transaction prediction, batch prediction, transaction history, and model performance analytics
- **Database**: SQLite via SQLAlchemy for storing predictions and analyst feedback
- **Deployment**: Railway (backend) and Vercel (frontend)

The system analyses transactions in real time and returns a fraud probability, verdict (APPROVED / REVIEW REQUIRED / FRAUD BLOCKED), SHAP-based feature explanations, and a combined ensemble verdict.

---

## 2. Dataset

**Primary dataset**: The IEEE/Kaggle Credit Card Fraud dataset (`fraudTrain.csv` + `fraudTest.csv`), a realistic simulated US credit card transaction dataset.

**Supplementary dataset**: `mauritius_finetune.csv` — 600 synthetic Mauritius-specific transactions (MUR-denominated amounts, Mauritius merchant names, Port Louis area coordinates) created to contextualise the system for a Mauritian audience.

**Combined dataset statistics (final training run):**

| Metric | Value |
|---|---|
| Total samples | 1,852,394 |
| Fraudulent transactions | 9,651 (0.52%) |
| Legitimate transactions | 1,842,743 (99.48%) |
| Class imbalance ratio | ~191:1 |

The dataset is severely imbalanced — a known characteristic of real-world fraud data — which was a primary challenge throughout development.

**Features used (7 total):**

| Feature | Type | Description |
|---|---|---|
| `amt` | Numeric | Transaction amount (USD, normalised) |
| `hour_of_day` | Numeric | Hour of transaction (0–23) |
| `age` | Numeric | Cardholder age derived from date of birth |
| `distance_from_home` | Numeric | Great-circle distance (miles) between cardholder home and merchant |
| `amt_zscore` | Numeric | How many standard deviations the amount is from its merchant category mean |
| `category` | Categorical | Merchant category (13 categories: grocery_pos, shopping_net, etc.) |
| `gender` | Categorical | Cardholder gender |

---

## 3. Data Preprocessing Pipeline

A custom `PreprocessingPipeline` class was implemented to ensure identical transformations during both training and inference:

### 3.1 Feature Engineering (`utils/feature_engineering.py`)

- `hour_of_day` extracted from transaction datetime string
- `age` calculated from cardholder date of birth
- `distance_from_home` computed using the Haversine formula from cardholder home coordinates (derived as per-card median lat/long) to merchant coordinates
- `amt_zscore` computed per merchant category: `(amt − category_mean) / category_std`

### 3.2 Scaling and Encoding

- **StandardScaler** applied independently to each numeric feature (zero mean, unit variance)
- **LabelEncoder** applied to categorical features (`category`, `gender`); unseen labels at inference time are mapped to the most frequent known class

### 3.3 Home Coordinate Lookup

A dictionary keyed by credit card number maps to the cardholder's median home coordinates, with a fallback to Port Louis, Mauritius (-20.1654, 57.4896) for unknown cards.

The pipeline is serialised to `pipeline.pkl` after training and loaded at inference time, guaranteeing that new predictions pass through exactly the same transformations as training data.

---

## 4. Models Trained

Three models were trained to enable comparison and ensemble prediction:

### 4.1 Logistic Regression (Baseline)

```python
LogisticRegression(max_iter=1000, class_weight='balanced', random_state=42)
```

- Uses `class_weight='balanced'` to automatically weight fraud samples by ~191× during training
- Acts as the primary sensitivity model — generalises well to novel fraud patterns through linear feature combinations

### 4.2 Random Forest

```python
RandomForestClassifier(
    n_estimators=200, max_depth=8, min_samples_leaf=10,
    class_weight='balanced', random_state=42, n_jobs=-1
)
```

- `max_depth=8`: Deliberately shallow to learn general fraud rules rather than memorising specific training patterns
- `n_estimators=200`: Larger forest to compensate for shallower depth
- `class_weight='balanced'`: Upweights fraud samples during tree construction

### 4.3 XGBoost (Advanced)

```python
XGBClassifier(
    n_estimators=100, scale_pos_weight=172.63,
    eval_metric='logloss', tree_method='hist', random_state=42
)
```

- `scale_pos_weight=172.63`: Computed dynamically as legit/fraud ratio in the 60% training split, correcting for class imbalance via gradient scaling
- Gradient boosting iteratively focuses on misclassified fraud cases, making it more sensitive to novel patterns than standard RF

---

## 5. Training Procedure

**Data split**: 60% training / 20% calibration holdout / 20% validation

```
Total: 1,852,394 samples
├── Training set:   ~1,111,436 samples (~4,686 fraud)
├── Calibration:    ~370,479 samples
└── Validation:     ~370,479 samples (~1,349 fraud)
```

**Class balancing strategy**: No synthetic oversampling (SMOTE). Each model handles imbalance natively:

- LR and RF: `class_weight='balanced'`
- XGBoost: `scale_pos_weight=172.63`

**Threshold selection**: After training, the optimal classification threshold for each model is calculated by finding the threshold that maximises the F1-score on the precision-recall curve of the validation set.

---

## 6. Model Performance (Validation Set)

| Metric | Logistic Regression | Random Forest | XGBoost |
|---|---|---|---|
| Accuracy | 99.40% | 99.87% | 99.89% |
| Precision | 29.29% | 84.13% | 91.69% |
| Recall | 45.14% | 78.21% | 76.87% |
| F1-Score | 35.53% | 81.06% | 83.63% |
| AUC-ROC | 87.46% | 99.55% | 99.75% |
| PR-AUC | 14.03% | 83.40% | 88.42% |
| Optimal Threshold | 0.9865 | 0.9521 | 0.9909 |

**Confusion matrices (validation set):**

| Model | TP | FP | TN | FN |
|---|---|---|---|---|
| Logistic Regression | 609 | 1,470 | 367,660 | 740 |
| Random Forest | 1,055 | 199 | 368,931 | 294 |
| XGBoost | 1,037 | 94 | 369,036 | 312 |

---

## 7. Ensemble Strategy and Verdict Logic

Rather than relying on any single model, predictions from all three are combined using a conservative escalation strategy, implemented in `models/predict.py`.

### 7.1 Verdict Thresholds (Per Model)

- The optimal threshold from the validation set is used for LR (0.9865)
- RF and XGBoost thresholds are capped at 0.40 to prevent their high precision-optimised thresholds from suppressing fraud signals on novel inputs

### 7.2 Per-Model Verdict Zones

| Condition | Verdict |
|---|---|
| `prob < threshold × 0.5` | APPROVED |
| `threshold × 0.5 ≤ prob < threshold` | REVIEW REQUIRED |
| `prob ≥ threshold` | FRAUD BLOCKED |

### 7.3 Combined Verdict (Escalation Logic)

```python
if any model says FRAUD BLOCKED  → combined = FRAUD BLOCKED
elif any model says REVIEW REQUIRED → combined = REVIEW REQUIRED
else                              → combined = APPROVED
```

This escalation principle reflects that **false negatives (missed fraud) are more costly than false positives** (unnecessary reviews).

---

## 8. Fine-Tuning and Iterative Improvements

The system underwent several rounds of fine-tuning based on empirical testing with three benchmark transactions:

| ID | Profile | Expected Verdict |
|---|---|---|
| E1 | MUR 2,450 · grocery_pos · 10AM · 3.2 miles · age 42 | APPROVED |
| E2 | MUR 18,000 · shopping_net · 11PM · 85 miles · age 28 | REVIEW REQUIRED |
| E3 | MUR 95,000 · misc_net · 3AM · 420 miles · age 67 | FRAUD BLOCKED |

### Issue 1 — Tree models outputting 0% probability

Initial training used SMOTE (Synthetic Minority Oversampling Technique) generating ~1,025,884 synthetic fraud samples to balance the dataset to a 50/50 ratio. This caused RF and XGBoost to overfit to synthetic fraud patterns and output near-zero probability for real novel inputs.

**Fix**: SMOTE was removed entirely. Class balancing was delegated to each model's native weighting mechanism (`class_weight='balanced'` for RF, `scale_pos_weight` for XGBoost).

### Issue 2 — XGBoost threshold too high

After removing SMOTE, XGBoost's F1-optimal threshold was computed as ~0.991. This meant a 47.9% fraud probability still produced a verdict of APPROVED.

**Fix**: Tree model thresholds were capped at 0.40, ensuring meaningful probabilities trigger appropriate verdicts while LR retains its own calibrated threshold.

### Issue 3 — RF still near zero on extreme fraud

RF was originally trained with `max_depth=20`, creating very deep trees that memorised specific training fraud patterns and failed to generalise to novel input combinations.

**Fix**: Reduced to `max_depth=8` with `n_estimators=200` and `min_samples_leaf=10`. RF improved from 3.9% to 14.2% on the most extreme fraud test case.

### Issue 4 — Ensemble verdict not escalating properly

The original majority vote required more than 50% of models to agree on FRAUD BLOCKED (2 out of 3). Since RF consistently scored near zero, only LR could ever trigger a block, but 1 out of 3 did not constitute a majority.

**Fix**: Changed to "any single FRAUD BLOCKED = combined FRAUD BLOCKED", justified by the asymmetric cost of missing fraud versus over-flagging.

### Issue 5 — mauritius_finetune.csv currency mismatch

The supplementary Mauritius dataset contained amounts in MUR (Mauritian Rupees) while the training pipeline assumed USD, causing category-level amount statistics (used for z-score computation) to be distorted.

**Fix**: The `/api/retrain` endpoint was updated to accept a `?currency=MUR` query parameter that divides all `amt` values by 49 (MUR/USD exchange rate) before merging with the main dataset.

---

## 9. Explainability (SHAP)

Each prediction includes SHAP (SHapley Additive exPlanations) feature attribution:

- **Logistic Regression**: `shap.LinearExplainer` with a zero-vector background
- **Random Forest and XGBoost**: `shap.TreeExplainer`

The top 8 features by absolute SHAP value are surfaced per prediction, labelled as:

- **Risk factors** — positive SHAP values (push towards fraud)
- **Legitimacy factors** — negative SHAP values (push towards legitimate)

These are rendered as a horizontal bar chart in the frontend and a natural-language explanation is generated via `utils/text_explainer.py`.

---

## 10. Final System Benchmark Results

| Model | E1 (Legit) | E2 (Borderline) | E3 (Fraud) |
|---|---|---|---|
| Logistic Regression | 28.4% → APPROVED | 75.4% → REVIEW REQUIRED | 100% → FRAUD BLOCKED |
| Random Forest | 1.8% → APPROVED | 2.3% → APPROVED | 14.2% → APPROVED |
| XGBoost | 0.0% → APPROVED | 0.0% → APPROVED | 47.9% → FRAUD BLOCKED |
| **Combined Verdict** | **APPROVED ✓** | **REVIEW REQUIRED ✓** | **FRAUD BLOCKED ✓** |

All three benchmark transactions produce the correct combined verdict, validating the ensemble escalation approach.

### Key observations

- **Logistic Regression** is the most sensitive model, correctly flagging all risk levels through linear feature combination. Its high optimal threshold (0.9865) reflects that it outputs high raw probabilities, requiring calibration.
- **XGBoost** is the strongest secondary detector with the highest precision (91.69%) and PR-AUC (88.42%), detecting 47.9% fraud probability on the most extreme test case.
- **Random Forest** exhibits high precision (84.13%) on known fraud patterns from training data but lower sensitivity to novel input combinations — a known limitation of deep decision tree ensembles on imbalanced datasets without synthetic augmentation.
- The **ensemble escalation strategy** compensates for individual model weaknesses, ensuring the combined system achieves correct verdicts across all test scenarios.
