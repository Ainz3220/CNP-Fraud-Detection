"""Turn SHAP feature attributions into plain-English explanation sentences.

Amount, hour, and z-score use domain rules (e.g. % above category average) so
the wording matches what a fraud analyst expects. Other features follow SHAP:
positive values are risk factors, negative values are legitimacy factors.
"""

from datautils.preprocess import FEATURE_COLS

MUR_PER_USD = 49.0
NORMAL_HOURS = range(6, 22)  # 06:00–21:59
ZSCORE_NORMAL = 2.0
PCT_ABOVE_RISK = 5.0  # % above category average → risk factor, even if SHAP is negative
TOP_PER_SIDE = 3


def _scalar(value):
    """Unwrap numpy/pandas scalars so we can format them as ordinary Python values."""
    if hasattr(value, "item"):
        try:
            return value.item()
        except (ValueError, AttributeError):
            pass
    return value


def _to_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(_scalar(value))
    except (TypeError, ValueError):
        return default


def _to_str(value, default=""):
    if value is None:
        return default
    return str(_scalar(value))


def _fraud_indicator_label(domain_score, shap_val, max_abs):
    """HIGH / MODERATE / LOW based on domain magnitude when we have one, else SHAP size."""
    score = domain_score
    if score is None:
        score = abs(shap_val) / max_abs if max_abs else 0.0
    if score >= 0.60:
        return "HIGH FRAUD INDICATOR"
    if score >= 0.25:
        return "MODERATE FRAUD INDICATOR"
    return "LOW FRAUD INDICATOR"


def _pct_vs_mean(amt, category, category_stats):
    """Return (percent above mean, category mean) or (None, None) if unknown."""
    if not category_stats:
        return None, None
    stats = category_stats.get(str(category)) or category_stats.get("__global__") or {}
    mean = stats.get("mean")
    if mean is None or mean == 0:
        return None, None
    return ((amt - mean) / mean) * 100.0, mean


def _amount_domain_score(pct_above):
    """Map |% vs category average| onto 0–1 for HIGH/MODERATE/LOW labels."""
    if pct_above is None:
        return None
    return min(abs(pct_above) / 50.0, 1.0)


def _sentence_amt(value, shap_val, ctx):
    amt = _to_float(value)
    mur = amt * MUR_PER_USD
    pct, _ = _pct_vs_mean(amt, ctx["category"], ctx["category_stats"])
    if pct is not None and abs(pct) >= 1:
        direction = "above" if pct > 0 else "below"
        return (
            f"Transaction amount of MUR {mur:.2f} is {abs(pct):.1f}% {direction} "
            f"average for {ctx['category']} transactions.",
            _amount_domain_score(pct),
        )
    if shap_val <= 0:
        return (
            "Transaction amount is within normal statistical range for this category.",
            0.1,
        )
    return (
        f"Transaction amount of MUR {mur:.2f} is close to the {ctx['category']} average.",
        0.1,
    )


def _sentence_amt_zscore(value, shap_val, ctx):
    z = _to_float(value)
    if abs(z) < ZSCORE_NORMAL:
        return (
            "Transaction amount is within normal statistical range for this category.",
            min(abs(z) / 3.0, 1.0),
        )
    direction = "above" if z > 0 else "below"
    return (
        f"Transaction amount is {abs(z):.1f} standard deviations {direction} "
        "the category average.",
        min(abs(z) / 3.0, 1.0),
    )


def _sentence_hour(value, shap_val, ctx):
    hour = int(_to_float(value, 12))
    hour = max(0, min(23, hour))
    clock = f"{hour:02d}:00"
    if hour in NORMAL_HOURS:
        return (
            f"Transaction occurred at {clock}, which is within normal hours.",
            0.1,
        )
    return (
        f"Transaction occurred at {clock}, which is outside typical spending hours.",
        0.7,
    )


def _sentence_distance(value, shap_val, ctx):
    dist = _to_float(value)
    if dist >= 100:
        return (
            f"Transaction occurred {dist:.1f} miles from home, which is unusually far.",
            min(dist / 200.0, 1.0),
        )
    if dist <= 20:
        return (
            f"Transaction occurred {dist:.1f} miles from home, close to the "
            "cardholder's usual location.",
            0.15,
        )
    return (
        f"Transaction occurred {dist:.1f} miles from home.",
        0.3,
    )


def _sentence_age(value, shap_val, ctx):
    age = int(_to_float(value, 40))
    if shap_val > 0:
        return (f"Cardholder age ({age}) contributed to fraud risk.", 0.2)
    return (
        f"Cardholder age ({age}) is consistent with typical cardholder profiles.",
        0.15,
    )


def _sentence_gender(value, shap_val, ctx):
    gender = _to_str(value, "?")
    if shap_val > 0:
        return (f"Feature 'gender' (value: {gender}) contributed to fraud risk.", None)
    return (f"Feature 'gender' (value: {gender}) supported legitimacy.", None)


def _sentence_category(value, shap_val, ctx):
    category = _to_str(value, ctx["category"])
    if shap_val > 0:
        return (f"Merchant category '{category}' contributed to fraud risk.", None)
    return (
        f"Merchant category '{category}' is consistent with legitimate activity.",
        None,
    )


def _sentence_generic(name, value, shap_val, ctx):
    display = _to_str(value)
    if shap_val > 0:
        return (f"Feature '{name}' (value: {display}) contributed to fraud risk.", None)
    return (f"Feature '{name}' (value: {display}) supported legitimacy.", None)


_HANDLERS = {
    "amt": _sentence_amt,
    "amt_zscore": _sentence_amt_zscore,
    "hour_of_day": _sentence_hour,
    "distance_from_home": _sentence_distance,
    "age": _sentence_age,
    "gender": _sentence_gender,
    "category": _sentence_category,
}


def _item(name, shap_val, raw, ctx, max_abs, side):
    handler = _HANDLERS.get(name)
    if handler:
        text, domain_score = handler(raw, shap_val, ctx)
    else:
        text, domain_score = _sentence_generic(name, raw, shap_val, ctx)
    if side == "safe":
        label = "SUPPORTS LEGITIMACY"
    else:
        label = _fraud_indicator_label(domain_score, shap_val, max_abs)
    return {"feature": name, "text": text, "label": label, "shap": round(float(shap_val), 4)}


def _lookup(by_name, name, default_shap=0.0, default_raw=0):
    shap_val, raw = by_name.get(name, (default_shap, default_raw))
    return shap_val, raw


def generate_explanation(shap_row, raw_row, category_stats=None, feature_names=None, top_n=TOP_PER_SIDE):
    """Return {"risk_factors": [...], "safe_factors": [...]} for one prediction.

    Amount, z-score and hour are classified with domain rules so a high amount
    is always a risk factor (matching the analyst-facing wording), even when
    SHAP happens to push the other way. Remaining features follow SHAP sign.
    """
    names = list(feature_names or FEATURE_COLS)
    shap_vals = [_to_float(v) for v in list(shap_row)[: len(names)]]
    raw_vals = [_scalar(v) for v in list(raw_row)[: len(names)]]

    pairs = list(zip(names, shap_vals, raw_vals))
    by_name = {name: (shap_val, raw) for name, shap_val, raw in pairs}

    category = _to_str(by_name.get("category", (0, "unknown"))[1], "unknown")
    ctx = {"category": category, "category_stats": category_stats or {}}
    max_abs = max((abs(s) for _, s, _ in pairs), default=0.0) or 0.001

    risk, safe = [], []
    used = set()

    amt_shap, amt_raw = _lookup(by_name, "amt")
    z_shap, z_raw = _lookup(by_name, "amt_zscore")
    hour_shap, hour_raw = _lookup(by_name, "hour_of_day", default_raw=12)
    dist_shap, dist_raw = _lookup(by_name, "distance_from_home")

    pct, _ = _pct_vs_mean(_to_float(amt_raw), category, ctx["category_stats"])
    z = _to_float(z_raw)
    hour = int(_to_float(hour_raw, 12))
    dist = _to_float(dist_raw)

    if pct is not None and pct >= PCT_ABOVE_RISK:
        risk.append(_item("amt", amt_shap, amt_raw, ctx, max_abs, "risk"))
        used.add("amt")
    elif pct is not None and pct <= -PCT_ABOVE_RISK:
        safe.append(_item("amt", amt_shap, amt_raw, ctx, max_abs, "safe"))
        used.add("amt")

    if abs(z) < ZSCORE_NORMAL:
        safe.append(_item("amt_zscore", z_shap, z_raw, ctx, max_abs, "safe"))
    elif z >= ZSCORE_NORMAL and "amt" not in used:
        risk.append(_item("amt_zscore", z_shap, z_raw, ctx, max_abs, "risk"))
    used.add("amt_zscore")

    if hour in NORMAL_HOURS:
        safe.append(_item("hour_of_day", hour_shap, hour_raw, ctx, max_abs, "safe"))
    else:
        risk.append(_item("hour_of_day", hour_shap, hour_raw, ctx, max_abs, "risk"))
    used.add("hour_of_day")

    if dist >= 100:
        risk.append(_item("distance_from_home", dist_shap, dist_raw, ctx, max_abs, "risk"))
    used.add("distance_from_home")
    used.add("category")  # already named in the amount sentence when present

    shap_rest = sorted(
        [(n, s, v) for n, s, v in pairs if n not in used and abs(s) > 1e-8],
        key=lambda item: abs(item[1]),
        reverse=True,
    )
    for name, shap_val, raw in shap_rest:
        side = "risk" if shap_val > 0 else "safe"
        target = risk if side == "risk" else safe
        if len(target) >= top_n:
            continue
        target.append(_item(name, shap_val, raw, ctx, max_abs, side))

    return {
        "risk_factors": risk[:top_n],
        "safe_factors": safe[:top_n],
    }
