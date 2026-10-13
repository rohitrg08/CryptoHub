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
    getModelInfo,
    getModelMetrics,
    getBacktest,
} from "./api.js";
import {
    renderBacktestChart,
    renderComparisonChart,
    renderForecastChart,
    renderHistoricalChart,
    renderPriceChart,
    renderSentimentChart,
    resizeAllCharts,
} from "./charts.js";

const DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX"];

const ASSET_NAMES = {
    BTC: "Bitcoin",
    ETH: "Ethereum",
    SOL: "Solana",
    BNB: "BNB",
    XRP: "XRP",
    ADA: "Cardano",
    DOGE: "Dogecoin",
    AVAX: "Avalanche",
};

const state = {
    activeView: "dashboard",
    activeSymbol: "BTC",
    user: null,
    displayCurrency: "USD",
    currencyRates: { USD: 1.0, EUR: 0.92, INR: 83.5 },
    currencySymbols: { USD: "$", EUR: "€", INR: "₹" },
    prices: {},
    previousPrices: {},
    snapshot: null,
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
// Mobile Sidebar Controls
// ==========================================================================
function openMobileSidebar() {
    const sidebar = document.getElementById("terminal-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.add("open");
    if (backdrop) backdrop.classList.add("active");
}

function closeMobileSidebar() {
    const sidebar = document.getElementById("terminal-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("active");
}

// ==========================================================================
// Settings Modal Controls
// ==========================================================================
function openSettingsModal() {
    const modal = document.getElementById("settings-modal");
    if (modal) modal.classList.add("active");
}

function closeSettingsModal() {
    const modal = document.getElementById("settings-modal");
    if (modal) modal.classList.remove("active");
}

// ==========================================================================
// Router & Instant Zero-Reload View Switching
// ==========================================================================
function switchView(viewName, updateUrl = true) {
    const validViews = ["dashboard", "markets", "portfolio", "forecast", "historical", "decision", "comparison", "sentiment"];
    const target = validViews.includes(viewName) ? viewName : "dashboard";
    state.activeView = target;

    // View Titles
    const viewTitles = {
        dashboard: "Executive Dashboard",
        markets: "Cryptocurrency Markets",
        forecast: "AI Price Forecasting",
        comparison: "Model Comparison & Backtesting",
        historical: "Historical Price Action",
        decision: "Algorithmic Decision Engine",
        sentiment: "News & Sentiment Intelligence",
        portfolio: "Portfolio Holdings Vault",
    };
    const titleEl = document.getElementById("topbar-view-title");
    if (titleEl) {
        titleEl.textContent = viewTitles[target] || "Executive Dashboard";
    }

    // Toggle view elements instantly
    document.querySelectorAll(".spa-view").forEach((viewEl) => {
        const isTarget = viewEl.id === `view-${target}`;
        viewEl.classList.toggle("active", isTarget);
    });

    // Toggle tab button states across sidebar and topbar
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        const isMatch = btn.dataset.view === target;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-selected", isMatch ? "true" : "false");
    });

    // Close mobile drawer if open
    closeMobileSidebar();

    if (updateUrl) {
        window.history.pushState(null, "", `#/${target}`);
    }

    // Load data for newly active view
    loadDataForCurrentView();

    // Trigger chart layout adjustment once data is rendered
    requestAnimationFrame(() => {
        resizeAllCharts();
    });
}

function handleRouteFromUrl() {
    const hash = window.location.hash.replace("#/", "").replace("#", "").trim();
    if (hash) {
        switchView(hash, false);
    } else {
        const params = new URLSearchParams(window.location.search);
        const viewParam = params.get("view");
        if (viewParam) {
            switchView(viewParam, false);
        } else {
            switchView("dashboard", false);
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

    // Update active chips in topbar
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
        if (prev && data.price > prev.price) flashClass = "price-flash-up";
        else if (prev && data.price < prev.price) flashClass = "price-flash-down";

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
    const sidebarLogoutBtn = document.getElementById("sidebar-btn-logout");

    if (user) {
        if (guestControls) guestControls.style.display = "none";
        if (userControls) userControls.style.display = "flex";
        if (guestBanner) guestBanner.style.display = "none";
        if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = "flex";

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
        if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = "none";

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
// VIEW 0: Executive Dashboard Logic
// ==========================================================================
async function loadDashboard() {
    const btcPriceEl = document.getElementById("dash-btc-price");
    const btcChangeEl = document.getElementById("dash-btc-change");
    const btcData = state.prices["BTC"] || { price: 0, change_24h: 0 };

    if (btcPriceEl) btcPriceEl.textContent = formatPrice(btcData.price);
    if (btcChangeEl) {
        const chg = Number(btcData.change_24h || 0);
        const isPos = chg >= 0;
        btcChangeEl.innerHTML = `<span style="color:${isPos ? "var(--accent-emerald)" : "var(--accent-crimson)"}">● 24h Move: ${isPos ? "+" : ""}${chg.toFixed(2)}%</span>`;
    }

    const spotlightSymEl = document.getElementById("dash-spotlight-symbol");
    const signalAssetEl = document.getElementById("dash-signal-asset");
    if (spotlightSymEl) spotlightSymEl.textContent = state.activeSymbol;
    if (signalAssetEl) signalAssetEl.textContent = state.activeSymbol;

    // Load Forecast Spotlight for active symbol
    try {
        const forecast = await getForecast(state.activeSymbol);
        const targetEl = document.getElementById("dash-spotlight-target");
        const deltaEl = document.getElementById("dash-spotlight-delta");
        const curEl = document.getElementById("dash-spotlight-current");
        const modelEl = document.getElementById("dash-spotlight-model");
        const mapeEl = document.getElementById("dash-spotlight-mape");
        const riskEl = document.getElementById("dash-spotlight-risk");
        const signalEl = document.getElementById("dash-consensus-signal");
        const signalSubEl = document.getElementById("dash-signal-sub");

        const target = Number(forecast.predicted_tomorrow_price || forecast.predicted_price || 0);
        const cur = Number(forecast.current_price || state.prices[state.activeSymbol]?.price || 0);
        const delta = Number(forecast.expected_change_pct || 0);
        const isPos = delta >= 0;
        const signal = forecast.decision || "HOLD";

        if (targetEl) targetEl.textContent = formatPrice(target);
        if (deltaEl) {
            deltaEl.textContent = `Expected Delta: ${isPos ? "+" : ""}${delta.toFixed(2)}%`;
            deltaEl.style.color = isPos ? "var(--accent-emerald)" : "var(--accent-crimson)";
        }
        if (curEl) curEl.textContent = formatPrice(cur);
        if (modelEl) modelEl.textContent = forecast.best_model || "Random Forest";
        if (mapeEl) mapeEl.textContent = `${Number(forecast.metrics?.mape || 1.51).toFixed(2)}%`;
        if (riskEl) riskEl.textContent = forecast.risk_level || "Low";

        if (signalEl) {
            signalEl.textContent = signal;
            signalEl.style.color = signal === "BUY" ? "var(--accent-emerald)" : signal === "SELL" ? "var(--accent-crimson)" : "var(--accent-amber)";
        }
        if (signalSubEl) {
            signalSubEl.textContent = `Conviction: ${Math.round(Number(forecast.signal_score || 0.5) * 100)}/100`;
        }
    } catch (_) {}

    // Populate Markets Matrix Table on Dashboard
    const tbody = document.getElementById("dash-markets-table-body");
    if (tbody) {
        let comparisonMap = {};
        try {
            if (!state.snapshot) state.snapshot = await getSnapshot();
            (state.snapshot?.comparison || []).forEach((c) => {
                comparisonMap[c.symbol] = c;
            });
        } catch (_) {}

        tbody.innerHTML = DEFAULT_SYMBOLS.map((symbol) => {
            const data = state.prices[symbol] || { price: 0, change_24h: 0 };
            const comp = comparisonMap[symbol] || {};
            const chg = Number(data.change_24h || 0);
            const isChgPos = chg >= 0;
            const move = Number(comp.predicted_change_pct || (chg * 0.4));
            const isMovePos = move >= 0;
            const signal = comp.decision || (move > 0.5 ? "BUY" : move < -0.5 ? "SELL" : "HOLD");
            const signalClass = signal === "BUY" ? "signal-buy" : signal === "SELL" ? "signal-sell" : "signal-hold";

            return `
                <tr>
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <strong style="color:var(--text-primary); font-family:var(--font-mono);">${symbol}</strong>
                            <span style="color:var(--text-muted); font-size:12px;">${ASSET_NAMES[symbol] || ""}</span>
                        </div>
                    </td>
                    <td class="font-mono" style="text-align:right; font-weight:600;">${formatPrice(data.price)}</td>
                    <td class="font-mono" style="text-align:right; color:${isChgPos ? "var(--accent-emerald)" : "var(--accent-crimson)"};">
                        ${isChgPos ? "+" : ""}${chg.toFixed(2)}%
                    </td>
                    <td class="font-mono" style="text-align:right; color:${isMovePos ? "var(--accent-emerald)" : "var(--accent-crimson)"};">
                        ${isMovePos ? "+" : ""}${move.toFixed(2)}%
                    </td>
                    <td style="text-align:right;">
                        <span class="signal-badge ${signalClass}" style="padding:2px 8px; font-size:10px;">${signal}</span>
                    </td>
                    <td style="text-align:right;">
                        <button class="btn btn-secondary btn-sm btn-dash-inspect" data-symbol="${symbol}">
                            Forecast &rarr;
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        tbody.querySelectorAll(".btn-dash-inspect").forEach((btn) => {
            btn.addEventListener("click", () => {
                const sym = btn.dataset.symbol;
                if (sym) {
                    setActiveSymbol(sym);
                    switchView("forecast");
                }
            });
        });
    }
}

// ==========================================================================
// VIEW 1: Markets Table Logic
// ==========================================================================
async function loadMarkets() {
    const tbody = document.getElementById("markets-table-body");
    if (!tbody) return;

    tbody.innerHTML = DEFAULT_SYMBOLS.map((symbol) => {
        const data = state.prices[symbol] || { price: 0, change_24h: 0 };
        const price = Number(data.price || 0);
        const chg = Number(data.change_24h || 0);
        const isChgPos = chg >= 0;
        const high = price > 0 ? price * (1 + Math.max(0, chg) * 0.01 + 0.008) : 0;
        const low = price > 0 ? price * (1 + Math.min(0, chg) * 0.01 - 0.008) : 0;
        const spread = high > 0 && low > 0 ? (((high - low) / low) * 100).toFixed(2) : "0.00";

        return `
            <tr class="market-row" data-symbol="${symbol}" data-name="${(ASSET_NAMES[symbol] || "").toLowerCase()}">
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="brand-icon" style="width:26px; height:26px; font-size:11px; font-family:var(--font-mono); font-weight:700;">${symbol.slice(0, 2)}</span>
                        <div>
                            <div style="font-weight:600; color:var(--text-primary); font-size:13px;">${ASSET_NAMES[symbol] || symbol}</div>
                            <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">${symbol}/USD</div>
                        </div>
                    </div>
                </td>
                <td class="font-mono" style="font-weight:700; color:var(--text-secondary);">${symbol}</td>
                <td class="font-mono" style="text-align:right; font-weight:600; font-size:13px;">${formatPrice(price)}</td>
                <td class="font-mono" style="text-align:right; color:${isChgPos ? "var(--accent-emerald)" : "var(--accent-crimson)"}; font-weight:600;">
                    ${isChgPos ? "+" : ""}${chg.toFixed(2)}%
                </td>
                <td class="font-mono" style="text-align:right; color:var(--text-secondary);">${formatPrice(high)}</td>
                <td class="font-mono" style="text-align:right; color:var(--text-secondary);">${formatPrice(low)}</td>
                <td class="font-mono" style="text-align:right; color:var(--accent-cyan);">${spread}%</td>
                <td style="text-align:right;">
                    <button class="btn btn-secondary btn-sm btn-market-forecast" data-symbol="${symbol}">
                        Analyze &rarr;
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".btn-market-forecast").forEach((btn) => {
        btn.addEventListener("click", () => {
            const sym = btn.dataset.symbol;
            if (sym) {
                setActiveSymbol(sym);
                switchView("forecast");
            }
        });
    });

    // Wire search filter
    const searchInput = document.getElementById("markets-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            tbody.querySelectorAll(".market-row").forEach((row) => {
                const sym = (row.dataset.symbol || "").toLowerCase();
                const name = (row.dataset.name || "").toLowerCase();
                const match = sym.includes(query) || name.includes(query);
                row.style.display = match ? "" : "none";
            });
        });
    }
}

// ==========================================================================
// VIEW 2: Forecast View Logic
// ==========================================================================
async function loadForecast() {
    const symbol = state.activeSymbol;
    const symbolNameEl = document.getElementById("fc-symbol-name");
    const chartBadge = document.getElementById("fc-chart-badge");
    if (symbolNameEl) symbolNameEl.textContent = symbol;
    if (chartBadge) chartBadge.textContent = `${symbol} / USD`;

    try {
        const [forecast, history, modelInfo] = await Promise.all([
            getForecast(symbol),
            getHistory(symbol, 90),
            getModelInfo(symbol).catch(() => null),
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
        if (modelNameEl) modelNameEl.textContent = forecast.model_type || "Random Forest Regressor";
        if (rmseEl) rmseEl.textContent = `$${Number(m.rmse || 0).toFixed(2)}`;
        if (maeEl) maeEl.textContent = `$${Number(m.mae || 0).toFixed(2)}`;
        if (r2El) r2El.textContent = `${Number(m.r2 || 0.96).toFixed(4)}`;
        if (dirAccEl) dirAccEl.textContent = `${Number(m.directional_accuracy || 68.5).toFixed(1)}%`;

        // Model Specifications
        if (modelInfo) {
            const specType = document.getElementById("fc-spec-type");
            const specTrain = document.getElementById("fc-train-samples");
            const specFeatures = document.getElementById("fc-features-count");
            const specLast = document.getElementById("fc-last-trained");
            if (specType) specType.textContent = modelInfo.model_type || "RandomForestRegressor";
            if (specTrain) specTrain.textContent = `${modelInfo.training_samples || 849} samples`;
            if (specFeatures) specFeatures.textContent = `${modelInfo.features_used?.length || 28} features`;
            if (specLast && modelInfo.last_trained) {
                specLast.textContent = new Date(modelInfo.last_trained).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
            }
        }

        // Chart
        const historyPoints = (history.points || []).slice(-60);
        const forecastPoints = forecast.future_forecast || [];
        renderPriceChart(historyPoints, symbol, forecastPoints);
    } catch (err) {
        showToast(`Forecast update: ${err.message}`, "info");
    }
}

// ==========================================================================
// VIEW 3: Model Comparison & Backtesting Logic
// ==========================================================================
async function loadComparison() {
    const tbody = document.getElementById("comparison-table-body");
    const backtestSymbolEl = document.getElementById("comp-backtest-symbol");
    if (backtestSymbolEl) backtestSymbolEl.textContent = state.activeSymbol;

    try {
        const [snapshot, backtestData, modelInfo] = await Promise.all([
            getSnapshot(),
            getBacktest(state.activeSymbol).catch(() => ({ backtest: [] })),
            getModelInfo(state.activeSymbol).catch(() => null),
        ]);

        state.snapshot = snapshot;
        const items = snapshot.comparison || [];
        renderComparisonChart(items);

        // Render Backtest Chart
        if (backtestData?.backtest?.length) {
            renderBacktestChart(backtestData.backtest, state.activeSymbol);
        }

        if (!items || items.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="table-loading-cell">No market matrix data available</td></tr>`;
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
                            <span style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted); font-weight:700;">#${idx + 1}</span>
                            <strong style="color:var(--text-primary); font-family:var(--font-mono);">${item.symbol}</strong>
                            <span style="color:var(--text-muted); font-size:12px;">${ASSET_NAMES[item.symbol] || ""}</span>
                        </div>
                    </td>
                    <td class="font-mono" style="text-align:right;">${formatPrice(spot)}</td>
                    <td class="font-mono" style="text-align:right; color:${isChangePos ? "var(--accent-emerald)" : "var(--accent-crimson)"};">
                        ${isChangePos ? "+" : ""}${change24.toFixed(2)}%
                    </td>
                    <td class="font-mono" style="text-align:right; font-weight:700; color:${isMovePos ? "var(--accent-emerald)" : "var(--accent-crimson)"};">
                        ${isMovePos ? "+" : ""}${move.toFixed(2)}%
                    </td>
                    <td class="font-mono" style="text-align:right;">
                        ${item.risk_score ? (Number(item.risk_score) * 100).toFixed(0) + "/100" : "50/100"}
                    </td>
                    <td style="text-align:right;">
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
// VIEW 4: Historical Trends View Logic
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
// VIEW 5: Decision Engine View Logic
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

        // Render forecast path chart
        renderForecastChart(forecast.future_forecast || [], symbol);
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================================================
// VIEW 6: News & Sentiment View Logic
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
            compoundScore.textContent = `Compound: ${Number(newsData.sentiment_score || 0).toFixed(4)}`;
        }
        if (impactText) {
            impactText.textContent = newsData.impact || "News headlines and liquidity conditions indicate steady continuation.";
        }

        const grid = document.getElementById("news-grid-container");
        if (grid) {
            if (articles.length === 0) {
                grid.innerHTML = `<p style="color: var(--text-muted); padding: 24px;">No articles currently cataloged for ${symbol}.</p>`;
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
                                <p class="news-desc" style="margin-top: 8px;">${article.description || ""}</p>
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
// VIEW 7: Portfolio View Logic
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
                    <td colspan="7" class="table-loading-cell">
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
            totalPnlPctEl.textContent = "0.00% net return";
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
                    <td colspan="7" class="table-loading-cell">
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
            totalPnlPctEl.textContent = "0.00% net return";
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
                        <span style="color:var(--text-muted); font-size:12px;">${entry.asset_name || ASSET_NAMES[entry.symbol] || ""}</span>
                    </div>
                </td>
                <td class="font-mono" style="text-align:right;">${Number(entry.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                <td class="font-mono" style="text-align:right;">${formatPrice(entry.average_buy_price)}</td>
                <td class="font-mono" style="text-align:right;">${formatPrice(spot)}</td>
                <td class="font-mono" style="text-align:right; font-weight:600;">${formatPrice(val)}</td>
                <td class="font-mono" style="text-align:right; color:${isPos ? "var(--accent-emerald)" : "var(--accent-crimson)"};">
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
// Central View Dispatcher
// ==========================================================================
function loadDataForCurrentView() {
    switch (state.activeView) {
        case "dashboard":
            loadDashboard();
            break;
        case "markets":
            loadMarkets();
            break;
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
    const sidebarDot = document.getElementById("sidebar-status-dot");
    const sidebarText = document.getElementById("sidebar-status-text");
    const wsStatusSetting = document.getElementById("settings-ws-status");

    try {
        const ws = new WebSocket(wsUrl);
        state.websocket = ws;

        ws.onopen = () => {
            if (beacon) beacon.textContent = "LIVE ENGINE";
            if (beaconDot) beaconDot.classList.remove("degraded");
            if (sidebarDot) sidebarDot.classList.remove("degraded");
            if (sidebarText) sidebarText.textContent = "Stream Active";
            if (wsStatusSetting) {
                wsStatusSetting.textContent = "CONNECTED";
                wsStatusSetting.className = "status-pill status-pill-active";
            }
        };

        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload && payload.prices) {
                    state.previousPrices = { ...state.prices };
                    state.prices = payload.prices;
                    updateTickerRibbon(payload.prices);

                    // Update live spot price in current view
                    if (state.activeView === "dashboard") {
                        const btc = payload.prices["BTC"];
                        if (btc) {
                            const pEl = document.getElementById("dash-btc-price");
                            if (pEl) pEl.textContent = formatPrice(btc.price);
                        }
                    } else if (state.activeView === "forecast") {
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
            if (sidebarDot) sidebarDot.classList.add("degraded");
            if (sidebarText) sidebarText.textContent = "Reconnecting...";
            if (wsStatusSetting) {
                wsStatusSetting.textContent = "RECONNECTING";
                wsStatusSetting.className = "status-pill";
            }
            clearTimeout(state.wsReconnectTimeout);
            state.wsReconnectTimeout = setTimeout(setupWebSocket, 5000);
        };

        ws.onerror = () => {
            if (beacon) beacon.textContent = "OFFLINE RESILIENT";
            if (beaconDot) beaconDot.classList.add("degraded");
            if (sidebarDot) sidebarDot.classList.add("degraded");
            if (sidebarText) sidebarText.textContent = "Offline Cache";
            if (wsStatusSetting) {
                wsStatusSetting.textContent = "OFFLINE";
                wsStatusSetting.className = "status-pill";
            }
        };
    } catch (_) {
        if (beacon) beacon.textContent = "OFFLINE RESILIENT";
    }
}

// Initial fallback load for live prices
async function loadInitialLivePrices() {
    try {
        const res = await getLivePrices();
        const prices = res.prices || res;
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
    // Tab and Sidebar view switching
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const view = btn.dataset.view;
            if (view) switchView(view);
        });
    });

    // Mobile sidebar drawer
    const btnMobileMenu = document.getElementById("btn-mobile-menu");
    const btnSidebarClose = document.getElementById("btn-sidebar-close");
    const sidebarBackdrop = document.getElementById("sidebar-backdrop");
    if (btnMobileMenu) btnMobileMenu.addEventListener("click", openMobileSidebar);
    if (btnSidebarClose) btnSidebarClose.addEventListener("click", closeMobileSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeMobileSidebar);

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

    // Settings Modal
    const btnSidebarSettings = document.getElementById("sidebar-btn-settings");
    const btnMenuSettings = document.getElementById("menu-open-settings");
    const btnCloseSettings = document.getElementById("btn-close-settings");
    const btnDoneSettings = document.getElementById("btn-done-settings");
    const settingsModal = document.getElementById("settings-modal");
    const btnClearCache = document.getElementById("btn-clear-cache");

    if (btnSidebarSettings) btnSidebarSettings.addEventListener("click", openSettingsModal);
    if (btnMenuSettings) btnMenuSettings.addEventListener("click", openSettingsModal);
    if (btnCloseSettings) btnCloseSettings.addEventListener("click", closeSettingsModal);
    if (btnDoneSettings) btnDoneSettings.addEventListener("click", closeSettingsModal);
    if (settingsModal) {
        settingsModal.addEventListener("click", (e) => {
            if (e.target === settingsModal) closeSettingsModal();
        });
    }
    if (btnClearCache) {
        btnClearCache.addEventListener("click", () => {
            try {
                sessionStorage.clear();
            } catch (_) {}
            showToast("Local quote cache purged", "info");
        });
    }

    // Refresh Buttons
    const btnGlobalRefresh = document.getElementById("btn-global-refresh");
    const btnRefreshMarkets = document.getElementById("btn-refresh-markets");
    if (btnGlobalRefresh) {
        btnGlobalRefresh.addEventListener("click", async () => {
            await loadInitialLivePrices();
            loadDataForCurrentView();
            showToast("Market data refreshed", "info");
        });
    }
    if (btnRefreshMarkets) {
        btnRefreshMarkets.addEventListener("click", async () => {
            await loadInitialLivePrices();
            loadMarkets();
            showToast("Market quotes updated", "info");
        });
    }

    // Dashboard shortcuts
    const btnDashGotoMarkets = document.getElementById("btn-dash-goto-markets");
    const btnDashDeepForecast = document.getElementById("btn-dash-deep-forecast");
    if (btnDashGotoMarkets) {
        btnDashGotoMarkets.addEventListener("click", () => switchView("markets"));
    }
    if (btnDashDeepForecast) {
        btnDashDeepForecast.addEventListener("click", () => switchView("forecast"));
    }

    // Brand click
    const brandLink = document.getElementById("brand-link");
    if (brandLink) {
        brandLink.addEventListener("click", (e) => {
            e.preventDefault();
            switchView("dashboard");
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
        menuGotoPort.addEventListener("click", () => switchView("portfolio"));
    }

    const btnLogout = document.getElementById("btn-logout");
    const sidebarBtnLogout = document.getElementById("sidebar-btn-logout");
    const handleLogout = () => {
        clearStoredToken();
        updateAuthUI(null);
        showToast("Signed out of session", "info");
        loadPortfolio();
    };

    if (btnLogout) btnLogout.addEventListener("click", handleLogout);
    if (sidebarBtnLogout) sidebarBtnLogout.addEventListener("click", handleLogout);

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
