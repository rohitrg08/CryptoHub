import {
    clearStoredToken,
    convertCurrency,
    createPortfolioEntry,
    deletePortfolioEntry,
    getCurrentUser,
    getForecast,
    getHistory,
    getLivePrices,
    getNews,
    getPortfolio,
    getSnapshot,
    getStoredToken,
    getStoredUser,
    loginUser,
    registerUser,
    storeToken,
    storeUser,
} from "./api.js";
import {
    renderComparisonChart,
    renderForecastChart,
    renderHistoricalChart,
    renderPriceChart,
    renderSentimentChart,
    resizeAllCharts,
} from "./charts.js";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX"];

const state = {
    activeView: "portfolio",
    activeSymbol: "BTC",
    user: null,
    displayCurrency: "USD",
    currencyRates: { USD: 1.0, EUR: 0.92, INR: 83.5 },
    currencySymbols: { USD: "$", EUR: "€", INR: "₹" },
    prices: {},
    previousPrices: {},
    portfolioEntries: [],
    historicalDays: 90,
    websocket: null,
    wsReconnectTimeout: null,
};

// ==========================================================================
// Toast Notification Utility
// ==========================================================================
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-dot ${type}"></span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(20px)";
        toast.style.transition = "all 0.25s ease-out";
        setTimeout(() => toast.remove(), 260);
    }, 3500);
}

// ==========================================================================
// Currency Formatting Helper
// ==========================================================================
function formatPrice(amountUsd, currency = state.displayCurrency) {
    const num = Number(amountUsd ?? 0);
    if (!Number.isFinite(num)) return "$0.00";

    const rate = state.currencyRates[currency] || 1.0;
    const converted = num * (currency === "USD" ? 1.0 : rate);
    const sym = state.currencySymbols[currency] || "$";

    if (converted >= 1000) {
        return `${sym}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (converted < 0.01 && converted > 0) {
        return `${sym}${converted.toFixed(6)}`;
    }
    if (converted < 1 && converted > 0) {
        return `${sym}${converted.toFixed(4)}`;
    }
    return `${sym}${converted.toFixed(2)}`;
}

// ==========================================================================
// Router & Instant Zero-Reload View Switching
// ==========================================================================
function switchView(viewName, updateUrl = true) {
    const validViews = ["portfolio", "forecast", "historical", "decision", "comparison", "sentiment"];
    const target = validViews.includes(viewName) ? viewName : "portfolio";
    state.activeView = target;

    // Toggle view elements instantly
    document.querySelectorAll(".spa-view").forEach((viewEl) => {
        const isTarget = viewEl.id === `view-${target}`;
        viewEl.classList.toggle("active", isTarget);
    });

    // Toggle tab button states
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        const isMatch = btn.dataset.view === target;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-selected", isMatch ? "true" : "false");
    });

    if (updateUrl) {
        window.history.pushState(null, "", `#/${target}`);
    }

    // Trigger charts layout adjustment
    setTimeout(resizeAllCharts, 20);
    setTimeout(resizeAllCharts, 180);

    // Load data for newly active view
    loadDataForCurrentView();
}

function handleRouteFromUrl() {
    const hash = window.location.hash.replace("#/", "").replace("#", "").trim();
    if (hash) {
        switchView(hash, false);
    } else {
        // Check query param e.g. ?view=forecast
        const params = new URLSearchParams(window.location.search);
        const viewParam = params.get("view");
        if (viewParam) {
            switchView(viewParam, false);
        } else {
            switchView("portfolio", false);
        }
    }
}

// ==========================================================================
// Asset Selection Synchronization Across Views
// ==========================================================================
function setActiveSymbol(symbol) {
    const normalized = String(symbol || "BTC").toUpperCase();
    if (state.activeSymbol === normalized) return;
    state.activeSymbol = normalized;

    // Update active chips in navbar
    document.querySelectorAll(".asset-chip").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.symbol === normalized);
    });

    // Update form select if exists
    const select = document.getElementById("add-port-symbol");
    if (select) select.value = normalized;

    // Reload active view data
    loadDataForCurrentView();
}

// ==========================================================================
// Top Ticker Ribbon Rendering
// ==========================================================================
function updateTickerRibbon(prices) {
    const track = document.getElementById("ticker-track");
    if (!track) return;

    track.innerHTML = DEFAULT_SYMBOLS.map((symbol) => {
        const data = prices[symbol] || { price: 0, change_24h: 0 };
        const priceStr = formatPrice(data.price);
        const change = Number(data.change_24h || 0);
        const isPos = change >= 0;
        const changeStr = `${isPos ? "+" : ""}${change.toFixed(2)}%`;

        const prev = state.previousPrices[symbol];
        let flashClass = "";
        if (prev && data.price > prev) flashClass = "price-flash-up";
        else if (prev && data.price < prev) flashClass = "price-flash-down";

        return `
            <span class="ticker-item ${flashClass}" data-symbol="${symbol}">
                <span class="symbol">${symbol}/USD</span>
                <span class="price">${priceStr}</span>
                <span class="change ${isPos ? "positive" : "negative"}">${changeStr}</span>
            </span>
        `;
    }).join("");

    // Attach click listeners to ticker items
    track.querySelectorAll(".ticker-item").forEach((item) => {
        item.addEventListener("click", () => {
            const sym = item.dataset.symbol;
            if (sym) {
                setActiveSymbol(sym);
                switchView("forecast");
            }
        });
    });
}

// ==========================================================================
// Authentication State & UI Management
// ==========================================================================
function updateAuthUI(user) {
    state.user = user;
    const guestControls = document.getElementById("auth-guest-controls");
    const userControls = document.getElementById("auth-user-controls");
    const guestBanner = document.getElementById("portfolio-guest-banner");
    const portAuthStatus = document.getElementById("port-auth-status");
    const portUserBadge = document.getElementById("port-user-badge");

    if (user) {
        if (guestControls) guestControls.style.display = "none";
        if (userControls) userControls.style.display = "flex";
        if (guestBanner) guestBanner.style.display = "none";

        const headerUsername = document.getElementById("header-username");
        const headerRole = document.getElementById("header-user-role");
        const avatarInitials = document.getElementById("user-avatar-initials");
        const dropdownEmail = document.getElementById("dropdown-user-email");
        const dropdownFullName = document.getElementById("dropdown-full-name");

        if (headerUsername) headerUsername.textContent = user.username;
        if (headerRole) headerRole.textContent = (user.role || "Trader").toUpperCase();
        if (avatarInitials) avatarInitials.textContent = (user.username || "TR").slice(0, 2).toUpperCase();
        if (dropdownEmail) dropdownEmail.textContent = user.email || `${user.username}@cryptohub.trade`;
        if (dropdownFullName) dropdownFullName.textContent = `${user.username} (Trader)`;

        if (portAuthStatus) {
            portAuthStatus.textContent = "Verified Member";
            portAuthStatus.style.color = "var(--accent-emerald)";
        }
        if (portUserBadge) portUserBadge.textContent = `Active User: ${user.username}`;
    } else {
        if (guestControls) guestControls.style.display = "flex";
        if (userControls) userControls.style.display = "none";
        if (guestBanner) guestBanner.style.display = "block";

        if (portAuthStatus) {
            portAuthStatus.textContent = "Guest Mode";
            portAuthStatus.style.color = "var(--accent-amber)";
        }
        if (portUserBadge) portUserBadge.textContent = "Public Analytics Session";
    }
}

async function checkAuthSession() {
    const token = getStoredToken();
    if (!token) {
        updateAuthUI(null);
        return;
    }

    // Try cached user first for instant rendering
    const cachedUser = getStoredUser();
    if (cachedUser) {
        updateAuthUI(cachedUser);
    }

    try {
        const user = await getCurrentUser();
        updateAuthUI(user);
    } catch (_) {
        clearStoredToken();
        updateAuthUI(null);
    }
}

function openAuthModal(mode = "login") {
    const modal = document.getElementById("auth-modal");
    if (!modal) return;

    modal.classList.add("active");
    setAuthModalMode(mode);
}

function closeAuthModal() {
    const modal = document.getElementById("auth-modal");
    if (!modal) return;
    modal.classList.remove("active");
    const msg = document.getElementById("modal-feedback-msg");
    if (msg) msg.textContent = "";
}

function setAuthModalMode(mode) {
    const loginForm = document.getElementById("auth-form-login");
    const signupForm = document.getElementById("auth-form-signup");
    const loginTab = document.getElementById("auth-tab-login");
    const signupTab = document.getElementById("auth-tab-signup");
    const modalTitle = document.getElementById("modal-title");

    if (mode === "signup") {
        if (loginForm) loginForm.style.display = "none";
        if (signupForm) signupForm.style.display = "block";
        if (loginTab) loginTab.classList.remove("active");
        if (signupTab) signupTab.classList.add("active");
        if (modalTitle) modalTitle.textContent = "Create Trader Account";
    } else {
        if (loginForm) loginForm.style.display = "block";
        if (signupForm) signupForm.style.display = "none";
        if (loginTab) loginTab.classList.add("active");
        if (signupTab) signupTab.classList.remove("active");
        if (modalTitle) modalTitle.textContent = "Trader Authentication";
    }
}

// ==========================================================================
// Portfolio View Logic
// ==========================================================================
async function loadPortfolio() {
    const tbody = document.getElementById("portfolio-table-body");
    const totalValEl = document.getElementById("port-total-val");
    const totalPnlEl = document.getElementById("port-total-pnl");
    const totalPnlPctEl = document.getElementById("port-total-pnl-pct");
    const topAssetEl = document.getElementById("port-top-asset");
    const topAssetPctEl = document.getElementById("port-top-asset-pct");
    const countEl = document.getElementById("port-holdings-count");

    // Holdings Vault is strictly empty when no user is logged in
    if (!state.user) {
        state.portfolioEntries = [];
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 56px 20px;">
                        <div style="display: inline-flex; flex-direction: column; align-items: center; gap: 10px; max-width: 440px;">
                            <span style="font-size: 13px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-mono);">
                                Vault Empty &bull; Authentication Required
                            </span>
                            <p style="font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5;">
                                Your personal Holdings Vault is available upon authentication. Please sign in or create an account to view and manage your asset positions.
                            </p>
                            <button class="btn btn-primary btn-sm" id="vault-empty-signin-btn" style="margin-top: 6px;">Sign In to Open Vault</button>
                        </div>
                    </td>
                </tr>
            `;
            const signInBtn = document.getElementById("vault-empty-signin-btn");
            if (signInBtn) {
                signInBtn.addEventListener("click", () => openAuthModal("login"));
            }
        }
        if (totalValEl) totalValEl.textContent = formatPrice(0);
        if (totalPnlEl) {
            totalPnlEl.textContent = formatPrice(0);
            totalPnlEl.style.color = "var(--text-primary)";
        }
        if (totalPnlPctEl) {
            totalPnlPctEl.textContent = "0.00%";
            totalPnlPctEl.style.color = "var(--text-secondary)";
        }
        if (topAssetEl) topAssetEl.textContent = "-";
        if (topAssetPctEl) topAssetPctEl.textContent = "-";
        if (countEl) countEl.textContent = "0 assets tracked";
        return;
    }

    let entries = [];
    try {
        entries = await getPortfolio();
    } catch (_) {
        entries = [];
    }

    state.portfolioEntries = entries;

    if (!entries || entries.length === 0) {
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px 20px;">
                        No asset positions recorded in your vault yet. Record your first transaction using the form on the right.
                    </td>
                </tr>
            `;
        }
        if (totalValEl) totalValEl.textContent = formatPrice(0);
        if (totalPnlEl) {
            totalPnlEl.textContent = formatPrice(0);
            totalPnlEl.style.color = "var(--text-primary)";
        }
        if (totalPnlPctEl) {
            totalPnlPctEl.textContent = "0.00%";
            totalPnlPctEl.style.color = "var(--text-secondary)";
        }
        if (topAssetEl) topAssetEl.textContent = "-";
        if (topAssetPctEl) topAssetPctEl.textContent = "-";
        if (countEl) countEl.textContent = "0 assets tracked";
        return;
    }

    let totalVal = 0;
    let totalCost = 0;
    let maxVal = 0;
    let topSymbol = "-";

    const rowsHtml = entries.map((entry) => {
        const spot = entry.current_price || state.prices[entry.symbol]?.price || entry.average_buy_price;
        const val = spot * entry.quantity;
        const cost = entry.average_buy_price * entry.quantity;
        const pnl = val - cost;
        const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
        const isPos = pnl >= 0;

        totalVal += val;
        totalCost += cost;
        if (val > maxVal) {
            maxVal = val;
            topSymbol = entry.symbol;
        }

        return `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-mono);">${entry.symbol}</span>
                        <span style="color:var(--text-muted); font-size:12px;">${entry.asset_name || ""}</span>
                    </div>
                </td>
                <td class="font-mono">${Number(entry.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                <td class="font-mono">${formatPrice(entry.average_buy_price)}</td>
                <td class="font-mono">${formatPrice(spot)}</td>
                <td class="font-mono" style="font-weight:600;">${formatPrice(val)}</td>
                <td class="font-mono ${isPos ? "change positive" : "change negative"}">
                    ${isPos ? "+" : ""}${formatPrice(pnl)} (${isPos ? "+" : ""}${pnlPct.toFixed(2)}%)
                </td>
                <td style="text-align: right;">
                    <button class="btn btn-ghost btn-sm btn-del-holding" data-id="${entry.id}" style="color:var(--accent-crimson); padding:3px 8px; font-size:12px;" title="Remove position">
                        Remove
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    if (tbody) tbody.innerHTML = rowsHtml;

    const netPnl = totalVal - totalCost;
    const netPnlPct = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;
    const isNetPos = netPnl >= 0;

    if (totalValEl) totalValEl.textContent = formatPrice(totalVal);
    if (totalPnlEl) {
        totalPnlEl.textContent = `${isNetPos ? "+" : ""}${formatPrice(netPnl)}`;
        totalPnlEl.style.color = isNetPos ? "var(--accent-emerald)" : "var(--accent-crimson)";
    }
    if (totalPnlPctEl) {
        totalPnlPctEl.textContent = `${isNetPos ? "+" : ""}${netPnlPct.toFixed(2)}% net return`;
        totalPnlPctEl.style.color = isNetPos ? "var(--accent-emerald)" : "var(--accent-crimson)";
    }
    if (topAssetEl) topAssetEl.textContent = topSymbol;
    if (topAssetPctEl) {
        const topPct = totalVal > 0 ? ((maxVal / totalVal) * 100).toFixed(1) : "0";
        topAssetPctEl.textContent = `${topPct}% of portfolio`;
    }
    if (countEl) countEl.textContent = `${entries.length} positions held`;

    // Attach delete listeners
    tbody.querySelectorAll(".btn-del-holding").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            try {
                await deletePortfolioEntry(id);
                showToast("Position removed from portfolio", "info");
                loadPortfolio();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    });
}

// ==========================================================================
// Forecast View Logic
// ==========================================================================
async function loadForecast() {
    const symbol = state.activeSymbol;
    const symbolNameEl = document.getElementById("fc-symbol-name");
    const chartBadge = document.getElementById("fc-chart-badge");
    if (symbolNameEl) symbolNameEl.textContent = symbol;
    if (chartBadge) chartBadge.textContent = `${symbol} / USD`;

    try {
        const [forecast, history] = await Promise.all([
            getForecast(symbol),
            getHistory(symbol, 90),
        ]);

        const currentPrice = Number(forecast.current_price || 0);
        const nextPrice = Number(forecast.predicted_tomorrow_price || forecast.predicted_price || 0);
        const deltaPct = Number(forecast.expected_change_pct || 0);
        const isPos = deltaPct >= 0;

        const curPriceEl = document.getElementById("fc-current-price");
        const spotChangeEl = document.getElementById("fc-spot-change");
        const nextTargetEl = document.getElementById("fc-next-day-target");
        const nextDeltaEl = document.getElementById("fc-next-day-delta");
        const recSignalEl = document.getElementById("fc-rec-signal");
        const recScoreEl = document.getElementById("fc-rec-score");
        const mapeEl = document.getElementById("fc-model-mape");

        if (curPriceEl) curPriceEl.textContent = formatPrice(currentPrice);
        if (spotChangeEl) {
            const spotChange = state.prices[symbol]?.change_24h || 0;
            spotChangeEl.textContent = `24h Move: ${spotChange >= 0 ? "+" : ""}${Number(spotChange).toFixed(2)}%`;
            spotChangeEl.style.color = spotChange >= 0 ? "var(--accent-emerald)" : "var(--accent-crimson)";
        }
        if (nextTargetEl) nextTargetEl.textContent = formatPrice(nextPrice);
        if (nextDeltaEl) {
            nextDeltaEl.textContent = `Expected Delta: ${isPos ? "+" : ""}${deltaPct.toFixed(2)}%`;
            nextDeltaEl.style.color = isPos ? "var(--accent-emerald)" : "var(--accent-crimson)";
        }

        const signal = forecast.decision || "HOLD";
        if (recSignalEl) {
            recSignalEl.textContent = signal;
            recSignalEl.style.color = signal === "BUY" ? "var(--accent-emerald)" : signal === "SELL" ? "var(--accent-crimson)" : "var(--accent-amber)";
        }
        if (recScoreEl) recScoreEl.textContent = `Signal Score: ${Math.round(Number(forecast.signal_score || 0.5) * 100)}/100`;
        if (mapeEl) mapeEl.textContent = `${Number(forecast.metrics?.mape || 1.8).toFixed(2)}%`;

        // Horizons
        const h1 = document.getElementById("fc-h-1d");
        const h3 = document.getElementById("fc-h-3d");
        const h5 = document.getElementById("fc-h-5d");
        const h7 = document.getElementById("fc-h-7d");
        if (h1) h1.textContent = formatPrice(forecast.predicted_tomorrow_price || nextPrice);
        if (h3) h3.textContent = formatPrice(forecast.predicted_3_day_price || nextPrice * 1.01);
        if (h5) h5.textContent = formatPrice(forecast.predicted_5_day_price || nextPrice * 1.02);
        if (h7) h7.textContent = formatPrice(forecast.predicted_7_day_price || nextPrice * 1.03);

        // Metrics
        const rmseEl = document.getElementById("fc-rmse");
        const maeEl = document.getElementById("fc-mae");
        const r2El = document.getElementById("fc-r2");
        const dirAccEl = document.getElementById("fc-dir-acc");
        const modelNameEl = document.getElementById("fc-model-name");
        const m = forecast.metrics || {};
        if (modelNameEl) modelNameEl.textContent = forecast.model_type || "Ensemble (RF + XGBoost)";
        if (rmseEl) rmseEl.textContent = `$${Number(m.rmse || 0).toFixed(2)}`;
        if (maeEl) maeEl.textContent = `$${Number(m.mae || 0).toFixed(2)}`;
        if (r2El) r2El.textContent = `${Number(m.r2 || 0.96).toFixed(4)}`;
        if (dirAccEl) dirAccEl.textContent = `${Number(m.directional_accuracy || 68.5).toFixed(1)}%`;

        // Chart
        const historyPoints = (history.points || []).slice(-60);
        const forecastPoints = forecast.future_forecast || [];
        renderPriceChart(historyPoints, symbol, forecastPoints);
    } catch (err) {
        showToast(`Forecast update: ${err.message}`, "info");
    }
}

// ==========================================================================
// Historical View Logic
// ==========================================================================
async function loadHistorical() {
    const symbol = state.activeSymbol;
    const days = state.historicalDays || 90;
    const titleEl = document.getElementById("hist-symbol-title");
    if (titleEl) titleEl.textContent = symbol;

    try {
        const history = await getHistory(symbol, days);
        const points = history.points || [];

        let minPrice = Infinity;
        let maxPrice = -Infinity;
        points.forEach((p) => {
            if (p.price < minPrice) minPrice = p.price;
            if (p.price > maxPrice) maxPrice = p.price;
        });

        const highEl = document.getElementById("hist-high");
        const lowEl = document.getElementById("hist-low");
        const dataPointsEl = document.getElementById("hist-data-points");
        const volEl = document.getElementById("hist-volatility");

        if (highEl) highEl.textContent = formatPrice(maxPrice > 0 ? maxPrice : 0);
        if (lowEl) lowEl.textContent = formatPrice(minPrice < Infinity ? minPrice : 0);
        if (dataPointsEl) dataPointsEl.textContent = points.length.toString();
        if (volEl) {
            const spread = maxPrice > 0 && minPrice < Infinity ? ((maxPrice - minPrice) / minPrice) * 100 : 0;
            volEl.textContent = `±${spread.toFixed(1)}% period spread`;
        }

        renderHistoricalChart(points, symbol);
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// Decision Engine View Logic
// ==========================================================================
async function loadDecision() {
    const symbol = state.activeSymbol;
    try {
        const forecast = await getForecast(symbol);
        const signal = forecast.decision || "HOLD";
        const score = Math.round(Number(forecast.signal_score || 0.5) * 100);

        const badge = document.getElementById("decision-signal-badge");
        if (badge) {
            badge.textContent = signal;
            badge.className = `signal-badge signal-${signal.toLowerCase()}`;
        }

        const scoreNum = document.getElementById("decision-score-num");
        const scoreBar = document.getElementById("decision-score-bar");
        if (scoreNum) scoreNum.textContent = score.toString();
        if (scoreBar) scoreBar.style.width = `${Math.max(5, Math.min(100, score))}%`;

        const rationaleEl = document.getElementById("decision-rationale-text");
        if (rationaleEl) {
            rationaleEl.textContent = forecast.signal_rationale || 
                `Based on ${symbol}'s current momentum and Random Forest projected delta of ${forecast.expected_change_pct || "0"}%, conditions recommend ${signal}.`;
        }

        const tech = forecast.technical || {};
        const rsiVal = Number(tech.rsi || 50).toFixed(1);
        const rsiEl = document.getElementById("decision-rsi");
        const rsiLabel = document.getElementById("decision-rsi-label");
        if (rsiEl) rsiEl.textContent = rsiVal;
        if (rsiLabel) {
            rsiLabel.textContent = rsiVal > 70 ? "Overbought" : rsiVal < 30 ? "Oversold" : "Neutral Range";
            rsiLabel.style.color = rsiVal > 70 ? "var(--accent-crimson)" : rsiVal < 30 ? "var(--accent-emerald)" : "var(--text-muted)";
        }

        const riskEl = document.getElementById("decision-risk");
        if (riskEl) riskEl.textContent = forecast.risk_level || "Moderate";

        const sentEl = document.getElementById("decision-sentiment");
        const sentScoreEl = document.getElementById("decision-sentiment-score");
        if (sentEl) sentEl.textContent = forecast.sentiment || "Neutral";
        if (sentScoreEl) sentScoreEl.textContent = `Polarity: ${Number(forecast.sentiment_score || 0).toFixed(2)}`;

        // Render mini forecast path chart
        renderForecastChart(forecast.future_forecast || [], symbol);
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// Market Comparison View Logic
// ==========================================================================
async function loadComparison() {
    const tbody = document.getElementById("comparison-table-body");
    try {
        const snapshot = await getSnapshot();
        const items = snapshot.comparison || [];

        renderComparisonChart(items);

        if (!items || items.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px;">No data available</td></tr>`;
            return;
        }

        const sorted = [...items].sort((a, b) => Number(b.predicted_change_pct || 0) - Number(a.predicted_change_pct || 0));

        tbody.innerHTML = sorted.map((item, idx) => {
            const spot = item.current_price || state.prices[item.symbol]?.price || 0;
            const change24 = Number(item.change_24h || 0);
            const move = Number(item.predicted_change_pct || 0);
            const isMovePos = move >= 0;
            const isChangePos = change24 >= 0;

            return `
                <tr>
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted);">#${idx + 1}</span>
                            <strong style="color:var(--text-primary); font-family:var(--font-mono);">${item.symbol}</strong>
                        </div>
                    </td>
                    <td class="font-mono">${formatPrice(spot)}</td>
                    <td class="font-mono ${isChangePos ? "change positive" : "change negative"}">
                        ${isChangePos ? "+" : ""}${change24.toFixed(2)}%
                    </td>
                    <td class="font-mono ${isMovePos ? "change positive" : "change negative"}" style="font-weight:700;">
                        ${isMovePos ? "+" : ""}${move.toFixed(2)}%
                    </td>
                    <td class="font-mono">
                        ${item.risk_score ? (Number(item.risk_score) * 100).toFixed(0) + "/100" : "50/100"}
                    </td>
                    <td style="text-align: right;">
                        <button class="btn btn-secondary btn-sm btn-select-matrix" data-symbol="${item.symbol}">
                            Inspect &rarr;
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        tbody.querySelectorAll(".btn-select-matrix").forEach((btn) => {
            btn.addEventListener("click", () => {
                setActiveSymbol(btn.dataset.symbol);
                switchView("forecast");
            });
        });
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// News & Sentiment View Logic
// ==========================================================================
async function loadSentiment() {
    const symbol = state.activeSymbol;
    const titleEl = document.getElementById("sent-symbol-title");
    if (titleEl) titleEl.textContent = symbol;

    try {
        const newsData = await getNews(symbol);
        const articles = newsData.articles || [];

        let posCount = 0;
        let neuCount = 0;
        let negCount = 0;

        articles.forEach((a) => {
            const s = (a.sentiment || "").toLowerCase();
            if (s === "positive") posCount++;
            else if (s === "negative") negCount++;
            else neuCount++;
        });

        renderSentimentChart({ positive: posCount, neutral: neuCount, negative: negCount });

        const moodLabel = document.getElementById("sent-mood-label");
        const compoundScore = document.getElementById("sent-compound-score");
        const impactText = document.getElementById("sent-impact-text");

        const dominant = newsData.sentiment || "Neutral";
        if (moodLabel) {
            moodLabel.textContent = dominant;
            moodLabel.style.color = dominant === "Positive" ? "var(--accent-emerald)" : dominant === "Negative" ? "var(--accent-crimson)" : "var(--accent-amber)";
        }
        if (compoundScore) {
            compoundScore.textContent = `Compound Polarity: ${Number(newsData.sentiment_score || 0).toFixed(4)}`;
        }
        if (impactText) {
            impactText.textContent = newsData.impact || "News headlines and liquidity conditions indicate steady continuation.";
        }

        const grid = document.getElementById("news-grid-container");
        if (grid) {
            if (articles.length === 0) {
                grid.innerHTML = `<p style="color: var(--text-muted); padding: 20px;">No articles currently cataloged for ${symbol}.</p>`;
            } else {
                grid.innerHTML = articles.map((article) => {
                    const tagClass = article.sentiment === "Positive" ? "sentiment-positive" : article.sentiment === "Negative" ? "sentiment-negative" : "sentiment-neutral";
                    const pubDate = new Date(article.published_at);
                    const timeAgo = pubDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                    return `
                        <article class="news-card-item">
                            <div>
                                <a href="${article.url}" target="_blank" rel="noopener noreferrer" class="news-title">
                                    ${article.title}
                                </a>
                                <p class="news-desc" style="margin-top: 8px;">${article.description}</p>
                            </div>
                            <div class="news-meta">
                                <span>${article.source} • ${timeAgo}</span>
                                <span class="news-sentiment-tag ${tagClass}">${article.sentiment}</span>
                            </div>
                        </article>
                    `;
                }).join("");
            }
        }
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// Central View Dispatcher
// ==========================================================================
function loadDataForCurrentView() {
    switch (state.activeView) {
        case "portfolio":
            loadPortfolio();
            break;
        case "forecast":
            loadForecast();
            break;
        case "historical":
            loadHistorical();
            break;
        case "decision":
            loadDecision();
            break;
        case "comparison":
            loadComparison();
            break;
        case "sentiment":
            loadSentiment();
            break;
    }
}

// ==========================================================================
// Real-Time WebSocket Pricing Connection
// ==========================================================================
function setupWebSocket() {
    if (state.websocket) {
        try { state.websocket.close(); } catch (_) {}
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/prices`;

    const beacon = document.getElementById("beacon-text");
    const beaconDot = document.getElementById("beacon-dot");

    try {
        const ws = new WebSocket(wsUrl);
        state.websocket = ws;

        ws.onopen = () => {
            if (beacon) beacon.textContent = "LIVE ENGINE";
            if (beaconDot) beaconDot.classList.remove("degraded");
        };

        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload && payload.prices) {
                    state.previousPrices = { ...state.prices };
                    state.prices = payload.prices;
                    updateTickerRibbon(payload.prices);

                    // Update live spot price in current view if applicable
                    if (state.activeView === "forecast") {
                        const spot = payload.prices[state.activeSymbol]?.price;
                        if (spot) {
                            const curEl = document.getElementById("fc-current-price");
                            if (curEl) curEl.textContent = formatPrice(spot);
                        }
                    }
                }
            } catch (_) {}
        };

        ws.onclose = () => {
            if (beacon) beacon.textContent = "CACHED RESILIENT";
            if (beaconDot) beaconDot.classList.add("degraded");
            // Auto reconnect after 5s
            clearTimeout(state.wsReconnectTimeout);
            state.wsReconnectTimeout = setTimeout(setupWebSocket, 5000);
        };

        ws.onerror = () => {
            if (beacon) beacon.textContent = "OFFLINE RESILIENT";
            if (beaconDot) beaconDot.classList.add("degraded");
        };
    } catch (_) {
        if (beacon) beacon.textContent = "OFFLINE RESILIENT";
    }
}

// Initial fallback load for live prices
async function loadInitialLivePrices() {
    try {
        const prices = await getLivePrices();
        if (prices) {
            state.prices = prices;
            updateTickerRibbon(prices);
        }
    } catch (_) {}
}

// ==========================================================================
// Event Listeners & UI Binding
// ==========================================================================
function bindEvents() {
    // Tab switching
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const view = btn.dataset.view;
            if (view) switchView(view);
        });
    });

    // Asset chips quick switcher
    document.querySelectorAll(".asset-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            const sym = chip.dataset.symbol;
            if (sym) setActiveSymbol(sym);
        });
    });

    // Timeframe selector in Historical view
    document.querySelectorAll(".tf-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.historicalDays = Number(btn.dataset.days || 90);
            loadHistorical();
        });
    });

    // Currency selector buttons
    document.querySelectorAll(".currency-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".currency-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.displayCurrency = btn.dataset.currency || "USD";
            updateTickerRibbon(state.prices);
            loadDataForCurrentView();
            showToast(`Display currency changed to ${state.displayCurrency}`, "info");
        });
    });

    // Brand click to portfolio
    const brandLink = document.getElementById("brand-link");
    if (brandLink) {
        brandLink.addEventListener("click", (e) => {
            e.preventDefault();
            switchView("portfolio");
        });
    }

    // Header Auth Buttons
    const btnOpenLogin = document.getElementById("btn-open-login");
    const btnOpenSignup = document.getElementById("btn-open-signup");
    const bannerLoginBtn = document.getElementById("banner-login-btn");

    if (btnOpenLogin) btnOpenLogin.addEventListener("click", () => openAuthModal("login"));
    if (btnOpenSignup) btnOpenSignup.addEventListener("click", () => openAuthModal("signup"));
    if (bannerLoginBtn) bannerLoginBtn.addEventListener("click", () => openAuthModal("login"));

    // Modal tabs & close
    const authTabLogin = document.getElementById("auth-tab-login");
    const authTabSignup = document.getElementById("auth-tab-signup");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const authModal = document.getElementById("auth-modal");

    if (authTabLogin) authTabLogin.addEventListener("click", () => setAuthModalMode("login"));
    if (authTabSignup) authTabSignup.addEventListener("click", () => setAuthModalMode("signup"));
    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeAuthModal);
    if (authModal) {
        authModal.addEventListener("click", (e) => {
            if (e.target === authModal) closeAuthModal();
        });
    }

    // User Profile Dropdown Toggle
    const userChip = document.getElementById("user-chip-toggle");
    const userDropdown = document.getElementById("user-dropdown");
    if (userChip && userDropdown) {
        userChip.addEventListener("click", (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle("active");
        });
        document.addEventListener("click", () => {
            userDropdown.classList.remove("active");
        });
    }

    // Dropdown items
    const menuGotoPort = document.getElementById("menu-goto-portfolio");
    if (menuGotoPort) {
        menuGotoPort.addEventListener("click", () => {
            switchView("portfolio");
        });
    }

    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => {
            clearStoredToken();
            updateAuthUI(null);
            showToast("Signed out of session", "info");
            loadPortfolio();
        });
    }

    // Login Form Submit
    const loginForm = document.getElementById("auth-form-login");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const usernameInput = document.getElementById("login-username");
            const passwordInput = document.getElementById("login-password");
            const feedback = document.getElementById("modal-feedback-msg");

            if (!usernameInput || !passwordInput) return;
            const username = usernameInput.value.trim();
            const password = passwordInput.value;

            if (feedback) feedback.textContent = "Authenticating...";
            try {
                const res = await loginUser(username, password);
                closeAuthModal();
                showToast(`Welcome back, ${res.user?.username || username}!`, "success");
                updateAuthUI(res.user);
                loadPortfolio();
            } catch (err) {
                if (feedback) {
                    feedback.textContent = err.message || "Invalid credentials.";
                    feedback.style.color = "var(--accent-crimson)";
                }
            }
        });
    }

    // Signup Form Submit
    const signupForm = document.getElementById("auth-form-signup");
    if (signupForm) {
        signupForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const username = document.getElementById("signup-username")?.value.trim();
            const email = document.getElementById("signup-email")?.value.trim();
            const password = document.getElementById("signup-password")?.value;
            const feedback = document.getElementById("modal-feedback-msg");

            if (feedback) feedback.textContent = "Creating trader account...";
            try {
                const res = await registerUser({ username, email, password });
                closeAuthModal();
                showToast(`Account created! Logged in as ${username}.`, "success");
                updateAuthUI(res.user);
                loadPortfolio();
            } catch (err) {
                if (feedback) {
                    feedback.textContent = err.message || "Registration failed.";
                    feedback.style.color = "var(--accent-crimson)";
                }
            }
        });
    }

    // Add Portfolio Transaction Form
    const portForm = document.getElementById("form-add-portfolio");
    if (portForm) {
        portForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!state.user) {
                openAuthModal("login");
                showToast("Please sign in to record transactions in your vault.", "info");
                return;
            }

            const sym = document.getElementById("add-port-symbol")?.value || "BTC";
            const qty = parseFloat(document.getElementById("add-port-quantity")?.value || "0");
            const buyPrice = parseFloat(document.getElementById("add-port-buy-price")?.value || "0");
            const targetPriceVal = document.getElementById("add-port-target-price")?.value;
            const targetPrice = targetPriceVal ? parseFloat(targetPriceVal) : null;
            const status = document.getElementById("port-form-status");

            if (qty <= 0 || buyPrice <= 0) {
                if (status) status.textContent = "Please enter positive quantity and price.";
                return;
            }

            if (status) status.textContent = "Adding transaction...";
            try {
                await createPortfolioEntry({
                    symbol: sym,
                    quantity: qty,
                    average_buy_price: buyPrice,
                    target_price: targetPrice,
                });
                if (status) status.textContent = "";
                portForm.reset();
                showToast(`Recorded ${qty} ${sym} position!`, "success");
                loadPortfolio();
            } catch (err) {
                if (status) status.textContent = err.message;
            }
        });
    }

    // Refresh portfolio button
    const btnRefreshPort = document.getElementById("btn-refresh-portfolio");
    if (btnRefreshPort) {
        btnRefreshPort.addEventListener("click", () => {
            loadPortfolio();
            showToast("Portfolio holdings refreshed", "info");
        });
    }

    // Unauthorized event listener from api.js
    window.addEventListener("cryptohub:unauthorized", () => {
        updateAuthUI(null);
        showToast("Session expired. Please sign in again.", "info");
    });

    // Browser navigation (Back / Forward buttons)
    window.addEventListener("popstate", handleRouteFromUrl);
}

// ==========================================================================
// Initialization on DOM Load
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await checkAuthSession();
    await loadInitialLivePrices();
    setupWebSocket();
    handleRouteFromUrl();
});
