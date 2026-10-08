from __future__ import annotations


def _clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return max(lower, min(upper, value))


class DecisionEngine:
    """Educational decision support based on forecast, technicals, sentiment, and model error."""

    def generate_signal(
        self,
        current_price: float,
        predicted_price: float,
        rsi: float,
        volatility: float,
        trend: str,
        sentiment_score: float,
        model_mape: float,
    ) -> dict[str, str | float]:
        expected_change_pct = ((predicted_price - current_price) / current_price) * 100 if current_price else 0.0

        prediction_score = _clamp(50 + (expected_change_pct * 7))
        technical_score = 50.0
        if rsi <= 35:
            technical_score += 15
        elif rsi >= 70:
            technical_score -= 20

        if trend == "UPTREND":
            technical_score += 10
        elif trend == "DOWNTREND":
            technical_score -= 10

        sentiment_component = _clamp(50 + (sentiment_score * 120))
        confidence_component = _clamp(100 - min(model_mape, 100.0))
        stability_component = 100.0
        if volatility >= 0.08:
            stability_component = 30.0
        elif volatility >= 0.04:
            stability_component = 55.0
        elif volatility >= 0.02:
            stability_component = 75.0

        signal_score = (
            (prediction_score * 0.35)
            + (technical_score * 0.2)
            + (sentiment_component * 0.15)
            + (confidence_component * 0.2)
            + (stability_component * 0.1)
        )
        signal_score = round(_clamp(signal_score), 2)

        if signal_score >= 63:
            decision = "BUY"
        elif signal_score <= 37:
            decision = "SELL"
        else:
            decision = "HOLD"

        risk_index = (volatility * 900) + (model_mape * 0.6) + abs(expected_change_pct * 0.8)
        if risk_index < 25:
            risk_level = "LOW"
        elif risk_index < 55:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        return {
            "decision": decision,
            "risk_level": risk_level,
            "signal_score": signal_score,
            "expected_change_pct": round(expected_change_pct, 4),
            "rationale": (
                "Model-based educational signal using predicted change, RSI, market trend, "
                "volatility, sentiment, and model error."
            ),
        }


decision_engine = DecisionEngine()
