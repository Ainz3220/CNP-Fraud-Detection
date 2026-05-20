import math
import numpy as np
import pandas as pd


EARTH_RADIUS_MILES = 3956


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in miles between two lat/lon points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))


def extract_hour(trans_date_trans_time: str) -> int:
    """Extract hour of day (0-23) from transaction datetime string."""
    try:
        dt = pd.to_datetime(trans_date_trans_time)
        return dt.hour
    except Exception:
        return 12


def calculate_age(dob: str) -> int:
    """Calculate age in years from date-of-birth string."""
    try:
        birth = pd.to_datetime(dob)
        today = pd.Timestamp.now()
        age = (today - birth).days // 365
        return max(18, min(int(age), 100))
    except Exception:
        return 40


def compute_amt_zscore(amt: float, category: str, category_stats: dict) -> float:
    """Return z-score of amount relative to its merchant category."""
    stats = category_stats.get(category, category_stats.get("__global__", {"mean": 0, "std": 1}))
    std = stats["std"] if stats["std"] > 0 else 1.0
    return (amt - stats["mean"]) / std


def engineer_features(df: pd.DataFrame, category_stats: dict = None) -> pd.DataFrame:
    """Add derived features to a dataframe in-place and return it."""
    df = df.copy()

    if "trans_date_trans_time" in df.columns:
        df["hour_of_day"] = df["trans_date_trans_time"].apply(extract_hour)
    elif "hour_of_day" not in df.columns:
        df["hour_of_day"] = 12

    if "dob" in df.columns:
        df["age"] = df["dob"].apply(calculate_age)
    elif "age" not in df.columns:
        df["age"] = 40

    if all(c in df.columns for c in ["lat", "long", "merch_lat", "merch_long"]):
        df["distance_from_home"] = df.apply(
            lambda r: haversine_distance(r["lat"], r["long"], r["merch_lat"], r["merch_long"]),
            axis=1,
        )
    elif "distance_from_home" not in df.columns:
        df["distance_from_home"] = 0.0

    if category_stats is not None and "amt" in df.columns and "category" in df.columns:
        df["amt_zscore"] = df.apply(
            lambda r: compute_amt_zscore(r["amt"], r["category"], category_stats), axis=1
        )
    elif "amt_zscore" not in df.columns:
        df["amt_zscore"] = 0.0

    return df


def build_category_stats(df: pd.DataFrame) -> dict:
    """Compute per-category mean/std for amt, plus global fallback."""
    stats = {}
    if "category" in df.columns and "amt" in df.columns:
        for cat, group in df.groupby("category"):
            stats[str(cat)] = {"mean": float(group["amt"].mean()), "std": float(group["amt"].std())}
    stats["__global__"] = {"mean": float(df["amt"].mean()), "std": float(df["amt"].std())}
    return stats
