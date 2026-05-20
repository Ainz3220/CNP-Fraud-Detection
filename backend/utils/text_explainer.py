"""Convert SHAP feature contributions into plain-English sentences."""

from typing import Dict, List, Tuple


CATEGORY_FRAUD_RATES = {
    "shopping_net": "high",
    "misc_net": "high",
    "grocery_pos": "moderate",
    "entertainment": "moderate",
    "food_dining": "low",
    "health_fitness": "low",
    "gas_transport": "moderate",
    "home": "low",
    "kids_pets": "low",
    "misc_pos": "moderate",
    "personal_care": "low",
    "shopping_pos": "moderate",
    "travel": "moderate",
}


def _indicator_level(shap_val: float) -> str:
    abs_val = abs(shap_val)
    if abs_val >= 0.3:
        return "HIGH"
    if abs_val >= 0.1:
        return "MODERATE"
    return "LOW"


def _direction(shap_val: float) -> str:
    return "above" if shap_val > 0 else "below"


def explain_feature(
    feature: str,
    value,
    shap_val: float,
    is_fraud: bool,
    context: Dict = None,
) -> str:
    context = context or {}
    level = _indicator_level(shap_val)
    direction = _direction(shap_val)

    if feature == "amt":
        pct = abs(round(shap_val * 100, 1))
        category = context.get("category", "this category")
        if is_fraud:
            return (
                f"Transaction amount of ${float(value):.2f} is {pct}% {direction} average "
                f"for {category} transactions. {level} FRAUD INDICATOR."
            )
        return f"Transaction amount of ${float(value):.2f} is within normal range for {category} transactions. SUPPORTS LEGITIMACY."

    if feature == "hour_of_day":
        hour = int(value)
        time_str = f"{hour:02d}:00"
        unusual = hour < 6 or hour > 22
        if is_fraud:
            label = "unusual" if unusual else "normal"
            return f"Transaction occurred at {time_str}, which is {label} for this transaction profile. {level} FRAUD INDICATOR."
        return f"Transaction occurred at {time_str}, which is within normal hours. SUPPORTS LEGITIMACY."

    if feature == "distance_from_home":
        miles = round(float(value), 1)
        if is_fraud:
            return (
                f"Transaction location is {miles} miles from the cardholder home coordinates. "
                f"{level} FRAUD INDICATOR."
            )
        return f"Transaction location is {miles} miles from home — within acceptable range. SUPPORTS LEGITIMACY."

    if feature == "category":
        rate = CATEGORY_FRAUD_RATES.get(str(value), "moderate")
        if is_fraud:
            return f"Merchant category ({value}) has a {rate} fraud rate in historical data. {level} FRAUD INDICATOR."
        return f"Merchant category ({value}) has a {rate} fraud rate — consistent with legitimate activity."

    if feature == "age":
        age = int(value)
        if is_fraud:
            return (
                f"Cardholder age ({age}) is outside the typical profile for this transaction type. "
                f"{level} FRAUD INDICATOR."
            )
        return f"Cardholder age ({age}) is within the typical profile for this transaction type. SUPPORTS LEGITIMACY."

    if feature == "amt_zscore":
        z = round(float(value), 2)
        if is_fraud:
            return f"Transaction amount is {z} standard deviations from the mean for this category. {level} FRAUD INDICATOR."
        return "Transaction amount is within normal statistical range for this category. SUPPORTS LEGITIMACY."

    if feature == "city_pop":
        pop = int(value)
        if is_fraud:
            return f"City population ({pop:,}) is atypical for this cardholder's region. {level} FRAUD INDICATOR."
        return f"City population ({pop:,}) is consistent with cardholder profile. SUPPORTS LEGITIMACY."

    # Generic fallback
    if is_fraud:
        return f"Feature '{feature}' (value: {value}) contributed to fraud risk. {level} FRAUD INDICATOR."
    return f"Feature '{feature}' (value: {value}) supports transaction legitimacy."


def generate_explanation(
    feature_shap_pairs: List[Tuple[str, float, object]],
    is_fraud: bool,
    context: Dict = None,
) -> Dict:
    """
    Args:
        feature_shap_pairs: list of (feature_name, shap_value, raw_value)
        is_fraud: True if the prediction verdict is fraud
        context: dict with extra context (e.g. category)

    Returns dict with 'sentences', 'risk_factors', 'safe_factors'
    """
    sentences = []
    risk_factors = []
    safe_factors = []

    for feature, shap_val, raw_val in feature_shap_pairs:
        sentence = explain_feature(feature, raw_val, shap_val, shap_val > 0, context)
        sentences.append({"feature": feature, "sentence": sentence, "shap": shap_val, "value": str(raw_val)})
        if shap_val > 0.01:
            risk_factors.append({"feature": feature, "sentence": sentence, "shap": shap_val})
        elif shap_val < -0.01:
            safe_factors.append({"feature": feature, "sentence": sentence, "shap": abs(shap_val)})

    risk_factors.sort(key=lambda x: x["shap"], reverse=True)
    safe_factors.sort(key=lambda x: x["shap"], reverse=True)

    return {
        "sentences": sentences,
        "risk_factors": risk_factors[:5],
        "safe_factors": safe_factors[:3],
    }
