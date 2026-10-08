import { getForecast, getHistory, getLivePrices, getNews, getSnapshot } from "./api.js";
import { renderComparisonChart, renderForecastChart, renderPriceChart, renderSentimentChart } from "./charts.js";

const DEFAULT_SYMBOL = "BTC";
const symbolSelect = document.getElementById("page-symbol");
const page = document.body.dataset.page;
let forecastHistory = [];
let forecastPoints = [];

function appendLiveForecastPoint(prices) {
    if (page !== "forecast") return;
    const price = Number(prices[selectedSymbol()]?.price || 0);
    if (!price) return;
    const timestamp = new Date().toISOString();
    const lastPoint = forecastHistory[forecastHistory.length - 1];
    if (!lastPoint || new Date(timestamp) > new Date(lastPoint.timestamp)) {
        forecastHistory = [...forecastHistory, { timestamp, price }].slice(-180);
    } else {
        lastPoint.price = price;
    }
    renderPriceChart(forecastHistory, selectedSymbol(), forecastPoints);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setStatus(message, isError = false) {
    const element = document.getElementById("page-status");
    if (element) {
        element.textContent = message;
        element.classList.toggle("error-text", isError);
    }
}

function formatForecastDate(point) {
    return point ? new Date(point.timestamp).toLocaleDateString([], { month: "short", day: "numeric" }) : "-";
}

function selectedSymbol() {
    return symbolSelect?.value || DEFAULT_SYMBOL;
}

async function loadHistorical() {
    const symbol = selectedSymbol();
    setStatus(`Loading ${symbol} price history...`);
    try {
        const history = await getHistory(symbol, 365);
        renderPriceChart(history.points || [], symbol, []);
        setText("history-count", `${history.points?.length || 0} data points`);
        setStatus(`${symbol} history updated`);
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function loadSentiment() {
    const symbol = selectedSymbol();
    setStatus(`Analyzing ${symbol} news...`);
    try {
        const summary = await getNews(symbol);
        const articles = summary.articles || [];
        const positive = articles.filter((article) => (article.sentiment || "").toLowerCase() === "positive").length;
        const negative = articles.filter((article) => (article.sentiment || "").toLowerCase() === "negative").length;
        const neutral = Math.max(articles.length - positive - negative, 0);
        renderSentimentChart({ positive, neutral, negative });
        setText("sentiment-label", summary.sentiment || "Neutral");
        setText("sentiment-score", Number(summary.sentiment_score || 0).toFixed(4));
        setText("sentiment-impact", summary.impact || "News flow is mixed and is not strongly altering the outlook.");
        const list = document.getElementById("news-list");
        if (list) {
            list.innerHTML = articles.length ? articles.slice(0, 8).map((article) => `
                <article class="news-item"><a href="${article.url}" target="_blank" rel="noreferrer"><strong>${article.title}</strong></a>
                <p>${article.source} • ${new Date(article.published_at).toLocaleString()}</p>
                <span class="tag">${article.sentiment} (${Number(article.sentiment_score).toFixed(3)})</span></article>
            `).join("") : "<p class=\"muted\">No articles available for this asset.</p>";
        }
        setStatus(`${symbol} sentiment updated`);
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function loadComparison() {
    setStatus("Loading market comparison...");
    try {
        const snapshot = await getSnapshot();
        renderComparisonChart(snapshot.comparison || []);
        setStatus("Comparison updated");
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function loadDecision() {
    const symbol = selectedSymbol();
    setStatus(`Loading ${symbol} decision...`);
    try {
        const forecast = await getForecast(symbol);
        setText("decision-label", forecast.decision || "HOLD");
        setText("decision-symbol", symbol);
        setText("current-price", `$${Number(forecast.current_price || 0).toFixed(2)}`);
        setText("predicted-price", `$${Number(forecast.predicted_price || forecast.predicted_tomorrow_price || 0).toFixed(2)}`);
        setText("expected-move", `${Number(forecast.expected_change_pct || 0).toFixed(2)}%`);
        setText("risk-level", forecast.risk_level || forecast.risk || "Low");
        setText("best-model", forecast.best_model || "Random Forest");
        setText("decision-summary", forecast.sentiment_impact || "Forecast loaded from the selected model.");
        renderForecastChart(forecast.future_forecast || [], symbol);
        setStatus(`${symbol} decision updated`);
    } catch (error) {
        setStatus(error.message, true);
    }
}

async function loadForecastPage() {
    const symbol = selectedSymbol();
    setStatus(`Loading ${symbol} forecast...`);
    try {
        const [forecast, history] = await Promise.all([
            getForecast(symbol),
            getHistory(symbol, 180),
        ]);

        setText("forecast-label", forecast.decision || "HOLD");
        setText("forecast-symbol", symbol);
        setText("forecast-symbol-label", symbol);
        setText("forecast-current-price", `$${Number(forecast.current_price || 0).toFixed(2)}`);
        setText("forecast-predicted-price", `$${Number(forecast.predicted_tomorrow_price || forecast.predicted_price || 0).toFixed(2)}`);
        setText("forecast-expected-move", `${Number(forecast.expected_change_pct || 0).toFixed(2)}%`);
        setText("forecast-risk-level", forecast.risk_level || forecast.risk || "Low");
        setText("forecast-best-model", forecast.best_model || "Random Forest");
        setText("forecast-model-mape", `${Number(forecast.metrics?.mape || 0).toFixed(2)}%`);
        const points = forecast.future_forecast || [];
        setText("forecast-1d", `$${Number(forecast.predicted_tomorrow_price || points[0]?.price || 0).toFixed(2)}`);
        setText("forecast-3d", `$${Number(forecast.predicted_3_day_price || points[2]?.price || 0).toFixed(2)}`);
        setText("forecast-5d", `$${Number(forecast.predicted_5_day_price || points[4]?.price || 0).toFixed(2)}`);
        setText("forecast-1d-date", formatForecastDate(points[0]));
        setText("forecast-3d-date", formatForecastDate(points[2]));
        setText("forecast-5d-date", formatForecastDate(points[4]));

        forecastHistory = history.points || [];
        forecastPoints = points.slice(0, 5);
        renderPriceChart(forecastHistory, symbol, forecastPoints);
        setStatus(`${symbol} forecast updated`);
    } catch (error) {
        setStatus(error.message, true);
    }
}

symbolSelect?.addEventListener("change", () => {
    if (page === "historical") loadHistorical();
    if (page === "sentiment") loadSentiment();
    if (page === "decision") loadDecision();
    if (page === "forecast") loadForecastPage();
});

if (page === "historical") loadHistorical();
if (page === "sentiment") loadSentiment();
if (page === "comparison") loadComparison();
if (page === "decision") loadDecision();
if (page === "forecast") loadForecastPage();

if (page === "forecast") {
    window.setInterval(async () => {
        try {
            const response = await getLivePrices();
            appendLiveForecastPoint(response.prices || response);
        } catch {
            // Keep the last chart state during a transient quote failure.
        }
    }, 15000);
}
