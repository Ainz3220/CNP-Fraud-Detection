"""Utilities for validating and normalising uploaded CSV datasets."""

import pandas as pd
from fastapi import HTTPException

REQUIRED_COLS_PREDICT = {
    "amt", "category",
}

REQUIRED_COLS_RETRAIN = REQUIRED_COLS_PREDICT | {"is_fraud"}

OPTIONAL_COLS = {
    "trans_date_trans_time", "cc_num", "merchant", "gender", "city", "zip",
    "lat", "long", "job", "dob", "trans_num", "unix_time",
    "merch_lat", "merch_long",
}


def validate_predict_csv(df: pd.DataFrame) -> pd.DataFrame:
    missing = REQUIRED_COLS_PREDICT - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV is missing required columns for prediction: {sorted(missing)}",
        )
    return df


def validate_retrain_csv(df: pd.DataFrame) -> pd.DataFrame:
    missing = REQUIRED_COLS_RETRAIN - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV is missing required columns for retraining: {sorted(missing)}",
        )
    if not set(df["is_fraud"].dropna().unique()).issubset({0, 1, "0", "1"}):
        raise HTTPException(
            status_code=400,
            detail="Column 'is_fraud' must contain only 0 or 1 values.",
        )
    df["is_fraud"] = df["is_fraud"].astype(int)
    return df
