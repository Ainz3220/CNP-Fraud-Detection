"""Validate an uploaded CSV before running batch predictions on it."""

import pandas as pd
from fastapi import HTTPException

REQUIRED_COLS_PREDICT = {"amt", "category"}


def validate_predict_csv(df: pd.DataFrame) -> pd.DataFrame:
    missing = REQUIRED_COLS_PREDICT - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV is missing required columns for prediction: {sorted(missing)}",
        )
    return df
