# CryptoHub Sales Forecasting Using Machine Learning

CryptoHub is a full-stack crypto analytics platform that combines real-time market feeds, multi-model machine learning forecasting, sentiment analysis, JWT authentication, portfolio tracking, and decision support in one FastAPI-powered application.

## Architecture

Frontend dashboard
-> FastAPI backend API
-> ML engine (LSTM, Random Forest, XGBoost, ARIMA)
-> SQL database (PostgreSQL-compatible via SQLAlchemy, SQLite default for quick start)
-> Optional MongoDB logging
-> External APIs (CoinGecko + NewsAPI)
-> WebSocket live stream

## Features

- Live multi-asset coverage for BTC, ETH, BNB, XRP, SOL, ADA, DOGE, and AVAX with offline-safe sample-data fallback
- Real-time WebSocket updates at `/ws/prices`
- Forecast comparison and signal generation from the active crypto model pipeline
- Backtesting output with RMSE, MAE, and MAPE metrics
- BUY / SELL / HOLD recommendation engine with risk scoring
- Crypto news sentiment analysis using VADER and NewsAPI
- Fiat and crypto conversion flow via `/api/converter/convert`
- JWT login/signup with role-based access hooks for admin routes
- Portfolio tracking with current valuation and profit/loss
- Optional MongoDB logging for streaming and forecast events

## Project Structure

```text
CryptoHub/
├── backend/
│   ├── main.py
│   ├── auth/
│   ├── core/
│   ├── models/
│   ├── routes/
│   ├── schemas/
│   └── services/
├── ml_models/
│   ├── common.py
│   ├── lstm.py
│   ├── random_forest.py
│   ├── xgboost_model.py
│   └── arima.py
├── frontend/
│   ├── index.html
│   └── assets/
│       ├── css/styles.css
│       └── js/
│           ├── api.js
│           ├── charts.js
│           └── dashboard.js
├── data/
│   └── crypto_data.csv
├── scripts/
│   └── schema.sql
├── requirements.txt
├── .env.example
└── README.md
```

## Backend Modules

- `backend/main.py`: FastAPI app bootstrap, static frontend serving, CORS, WebSocket route, startup tasks
- `backend/routes/auth.py`: signup, login, current-user, admin user listing
- `backend/routes/crypto.py`: live price and historical market endpoints
- `backend/routes/analytics.py`: forecast, news sentiment, and market snapshot endpoints
- `backend/routes/portfolio.py`: authenticated portfolio CRUD endpoints
- `backend/services/coingecko_service.py`: CoinGecko price and history integration with CSV fallback
- `backend/services/model_service.py`: orchestrates model execution, comparison, decision engine, and backtesting
- `backend/services/sentiment_service.py`: VADER-based scoring on NewsAPI headlines
- `backend/services/live_stream.py`: WebSocket connection manager and background broadcasting loop

## ML Modules

- `ml_models/lstm.py`: TensorFlow/Keras sequence model for next-step forecasting
- `ml_models/random_forest.py`: lag-based ensemble regression
- `ml_models/xgboost_model.py`: boosted tree forecasting on lag features
- `ml_models/arima.py`: statistical time-series baseline
- `ml_models/common.py`: shared feature engineering, split logic, metrics, and backtest shaping

## Frontend Modules

- `frontend/index.html`: dashboard layout with auth, charts, sentiment, and portfolio panels
- `frontend/assets/js/api.js`: all REST API calls and token storage helpers
- `frontend/assets/js/charts.js`: Chart.js renderers for price, benchmark, and backtest charts
- `frontend/assets/js/dashboard.js`: dashboard state, auth flows, WebSocket handling, and portfolio actions
- `frontend/assets/css/styles.css`: responsive glassmorphism-style dashboard theme

## Environment Setup

1. Use Python 3.10 or 3.11 for the smoothest TensorFlow and ML dependency installation on Windows.
2. Create and activate a virtual environment.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

3. Install dependencies.

```powershell
pip install -r requirements.txt
```

4. Copy the environment template and update secrets.

```powershell
Copy-Item .env.example .env
```

5. Set these values in `.env`:

- `SECRET_KEY`: required for JWT signing
- `DATABASE_URL`: use PostgreSQL for production, for example `postgresql+psycopg2://postgres:postgres@localhost:5432/cryptohub`
- `NEWS_API_KEY`: required for live sentiment headlines
- `MONGODB_URL`: optional, only set this when MongoDB is running and you want event logging

## Database Setup

### Quick Start

The app defaults to SQLite and auto-creates tables on startup, so no extra DB setup is required for a local demo.

### PostgreSQL Setup

1. Create a PostgreSQL database named `cryptohub`.
2. Run the SQL schema in `scripts/schema.sql`.
3. Set `DATABASE_URL` in `.env`.

Example:

```sql
CREATE DATABASE cryptohub;
```

To promote a user to admin after signup:

```sql
UPDATE users SET role = 'admin' WHERE username = 'your_username';
```

## Run the Application

Start the FastAPI server:

```powershell
uvicorn backend.main:app --reload
```

If your local `.venv` stops launching because the base Python path changed on Windows, recreate it with an installed Python 3.10 or 3.11 interpreter and reinstall `requirements.txt`.

Then open:

- Dashboard: `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`
- WebSocket: `ws://127.0.0.1:8000/ws/prices`

## Key API Endpoints

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/auth/admin/users`
- `GET /api/crypto/supported`
- `GET /api/crypto/prices/live`
- `GET /api/crypto/history/{symbol}`
- `GET /api/analytics/forecast/{symbol}`
- `GET /api/analytics/news/{symbol}`
- `GET /api/analytics/snapshot`
- `GET /api/converter/convert?from_currency=BTC&to_currency=USD&amount=1`
- `GET /api/portfolio/`
- `POST /api/portfolio/`
- `DELETE /api/portfolio/{entry_id}`

## Notes

- The first forecast request may take longer because all four ML models are trained on demand.
- If CoinGecko is unavailable, the app falls back to `data/crypto_data.csv` so the dashboard still works.
- If `NEWS_API_KEY` is missing, the sentiment module returns a neutral result and explains why.
- MongoDB is optional. If configured, live-price and forecast events are stored automatically.
