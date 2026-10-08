from __future__ import annotations

from typing import TypedDict


class CryptoConfig(TypedDict):
    symbol: str
    name: str
    coingecko_id: str
    binance_symbol: str
    quote_currency: str


CRYPTOCURRENCIES: dict[str, CryptoConfig] = {
    "BTC": {
        "symbol": "BTC",
        "name": "Bitcoin",
        "coingecko_id": "bitcoin",
        "binance_symbol": "BTCUSDT",
        "quote_currency": "USD",
    },
    "ETH": {
        "symbol": "ETH",
        "name": "Ethereum",
        "coingecko_id": "ethereum",
        "binance_symbol": "ETHUSDT",
        "quote_currency": "USD",
    },
    "BNB": {
        "symbol": "BNB",
        "name": "BNB",
        "coingecko_id": "binancecoin",
        "binance_symbol": "BNBUSDT",
        "quote_currency": "USD",
    },
    "XRP": {
        "symbol": "XRP",
        "name": "XRP",
        "coingecko_id": "ripple",
        "binance_symbol": "XRPUSDT",
        "quote_currency": "USD",
    },
    "SOL": {
        "symbol": "SOL",
        "name": "Solana",
        "coingecko_id": "solana",
        "binance_symbol": "SOLUSDT",
        "quote_currency": "USD",
    },
    "ADA": {
        "symbol": "ADA",
        "name": "Cardano",
        "coingecko_id": "cardano",
        "binance_symbol": "ADAUSDT",
        "quote_currency": "USD",
    },
    "DOGE": {
        "symbol": "DOGE",
        "name": "Dogecoin",
        "coingecko_id": "dogecoin",
        "binance_symbol": "DOGEUSDT",
        "quote_currency": "USD",
    },
    "AVAX": {
        "symbol": "AVAX",
        "name": "Avalanche",
        "coingecko_id": "avalanche-2",
        "binance_symbol": "AVAXUSDT",
        "quote_currency": "USD",
    },
}

FIAT_CURRENCIES: dict[str, dict[str, str | float]] = {
    "USD": {"name": "US Dollar", "symbol": "$", "rate_to_usd": 1.0},
    "EUR": {"name": "Euro", "symbol": "EUR", "rate_to_usd": 1.09},
    "INR": {"name": "Indian Rupee", "symbol": "INR", "rate_to_usd": 0.012},
}

SYMBOL_ALIASES: dict[str, str] = {}
for symbol, config in CRYPTOCURRENCIES.items():
    SYMBOL_ALIASES[symbol.lower()] = symbol
    SYMBOL_ALIASES[config["name"].lower()] = symbol
    SYMBOL_ALIASES[config["coingecko_id"].lower()] = symbol
    if symbol == "BTC":
        SYMBOL_ALIASES["xbt"] = symbol


def normalize_symbol(symbol: str) -> str:
    normalized = SYMBOL_ALIASES.get(symbol.strip().lower())
    if not normalized:
        supported = ", ".join(supported_symbols())
        raise ValueError(f"Unsupported cryptocurrency symbol '{symbol}'. Supported values: {supported}.")
    return normalized


def supported_symbols() -> list[str]:
    return list(CRYPTOCURRENCIES.keys())


def get_crypto_config(symbol: str) -> CryptoConfig:
    return CRYPTOCURRENCIES[normalize_symbol(symbol)]


def display_symbol(symbol: str) -> str:
    return normalize_symbol(symbol)


def asset_name(symbol: str) -> str:
    return get_crypto_config(symbol)["name"]


def coingecko_id(symbol: str) -> str:
    return get_crypto_config(symbol)["coingecko_id"]


def binance_symbol(symbol: str) -> str:
    return get_crypto_config(symbol)["binance_symbol"]


def list_supported_cryptocurrencies() -> list[dict[str, str]]:
    return [
        {
            "symbol": config["symbol"],
            "name": config["name"],
            "coingecko_id": config["coingecko_id"],
            "binance_symbol": config["binance_symbol"],
        }
        for config in CRYPTOCURRENCIES.values()
    ]


def is_supported_crypto(symbol: str) -> bool:
    return symbol.strip().lower() in SYMBOL_ALIASES


def normalize_currency(code: str) -> str:
    candidate = code.strip().upper()
    if candidate in FIAT_CURRENCIES:
        return candidate
    return normalize_symbol(candidate)


def is_fiat_currency(code: str) -> bool:
    return code.strip().upper() in FIAT_CURRENCIES


def is_supported_currency(code: str) -> bool:
    stripped = code.strip()
    return is_fiat_currency(stripped) or is_supported_crypto(stripped)


def list_supported_currencies() -> list[dict[str, str]]:
    crypto_entries = [
        {"code": config["symbol"], "name": config["name"], "type": "crypto"}
        for config in CRYPTOCURRENCIES.values()
    ]
    fiat_entries = [
        {"code": code, "name": str(meta["name"]), "type": "fiat"}
        for code, meta in FIAT_CURRENCIES.items()
    ]
    return crypto_entries + fiat_entries
