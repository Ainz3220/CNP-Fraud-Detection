"""Data preprocessing utilities shared between training and inference."""

import os
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler, LabelEncoder
import joblib

from utils.feature_engineering import engineer_features, build_category_stats


CATEGORICAL_COLS = ["category", "gender", "state"]
NUMERIC_COLS = ["amt", "city_pop", "hour_of_day", "age", "distance_from_home", "amt_zscore"]
FEATURE_COLS = NUMERIC_COLS + CATEGORICAL_COLS


def load_raw_data(train_path: str, test_path: str = None) -> pd.DataFrame:
    df_train = pd.read_csv(train_path)
    if test_path and os.path.exists(test_path):
        df_test = pd.read_csv(test_path)
        return pd.concat([df_train, df_test], ignore_index=True)
    return df_train


def build_home_coords(df: pd.DataFrame) -> dict:
    """Build cc_num -> (median_lat, median_lon) lookup table."""
    coords = (
        df.groupby("cc_num")[["lat", "long"]]
        .median()
        .rename(columns={"lat": "home_lat", "long": "home_lon"})
    )
    return coords.to_dict("index")


def build_state_coords(df: pd.DataFrame) -> dict:
    """Fallback: state -> (median_lat, median_lon)."""
    coords = (
        df.groupby("state")[["lat", "long"]]
        .median()
        .rename(columns={"lat": "home_lat", "long": "home_lon"})
    )
    return coords.to_dict("index")


class PreprocessingPipeline:
    def __init__(self):
        self.scalers: dict[str, StandardScaler] = {}
        self.encoders: dict[str, LabelEncoder] = {}
        self.category_stats: dict = {}
        self.home_coords: dict = {}
        self.state_coords: dict = {}
        self.fitted = False

    def fit(self, df: pd.DataFrame):
        df = engineer_features(df, self.category_stats)
        self.category_stats = build_category_stats(df)
        # Re-engineer with proper stats
        df = engineer_features(df, self.category_stats)
        self.home_coords = build_home_coords(df)
        self.state_coords = build_state_coords(df)

        for col in NUMERIC_COLS:
            if col in df.columns:
                scaler = StandardScaler()
                scaler.fit(df[[col]])
                self.scalers[col] = scaler

        for col in CATEGORICAL_COLS:
            if col in df.columns:
                enc = LabelEncoder()
                enc.fit(df[col].astype(str))
                self.encoders[col] = enc

        self.fitted = True
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        df = engineer_features(df, self.category_stats)
        result = pd.DataFrame(index=df.index)

        for col in NUMERIC_COLS:
            if col in df.columns and col in self.scalers:
                result[col] = self.scalers[col].transform(df[[col]]).ravel()
            else:
                result[col] = 0.0

        for col in CATEGORICAL_COLS:
            if col in df.columns and col in self.encoders:
                enc = self.encoders[col]
                vals = df[col].astype(str)
                # Handle unseen labels by mapping to most frequent class
                known = set(enc.classes_)
                vals = vals.apply(lambda v: v if v in known else enc.classes_[0])
                result[col] = enc.transform(vals)
            else:
                result[col] = 0

        return result[FEATURE_COLS].values

    def fit_transform(self, df: pd.DataFrame) -> np.ndarray:
        return self.fit(df).transform(df)

    def save(self, path: str):
        joblib.dump(self, path)

    @staticmethod
    def load(path: str) -> "PreprocessingPipeline":
        return joblib.load(path)


def resolve_home_coords(
    cc_num,
    state: str,
    pipeline: "PreprocessingPipeline",
) -> tuple[float, float]:
    """Return (home_lat, home_lon) for a cardholder, falling back to state median."""
    key = str(cc_num) if cc_num else None
    if key and key in pipeline.home_coords:
        rec = pipeline.home_coords[key]
        return rec["home_lat"], rec["home_lon"]
    state_key = str(state) if state else None
    if state_key and state_key in pipeline.state_coords:
        rec = pipeline.state_coords[state_key]
        return rec["home_lat"], rec["home_lon"]
    # Ultimate fallback — geographic centre of the contiguous US
    return 39.5, -98.35
