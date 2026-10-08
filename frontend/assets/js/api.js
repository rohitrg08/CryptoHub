const API_BASE = "/api";
const TOKEN_KEY = "cryptohub_token";
const USER_KEY = "cryptohub_user";

// Client-side in-memory & sessionStorage cache with Stale-While-Revalidate
const memoryCache = new Map();

function getCachedData(key, maxAgeMs) {
    const mem = memoryCache.get(key);
    const now = Date.now();
    if (mem && (now - mem.timestamp < maxAgeMs)) {
        return mem.data;
    }

    try {
        const stored = sessionStorage.getItem(`cache_${key}`);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (now - parsed.timestamp < maxAgeMs) {
                memoryCache.set(key, parsed);
                return parsed.data;
            }
        }
    } catch (_) {
        // Ignore session storage errors
    }
    return null;
}

function setCachedData(key, data) {
    const entry = { data, timestamp: Date.now() };
    memoryCache.set(key, entry);
    try {
        sessionStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch (_) {
        // Storage quota or disabled
    }
}

export function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token) {
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }
}

export function clearStoredToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

export function getStoredUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

export function storeUser(user) {
    if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
        localStorage.removeItem(USER_KEY);
    }
}

async function apiRequest(path, options = {}, requiresAuth = false) {
    const headers = new Headers(options.headers || {});
    const token = getStoredToken();

    if (requiresAuth && token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    let body = options.body;
    if (body && !(body instanceof FormData) && !(body instanceof URLSearchParams) && typeof body !== "string") {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
            body,
        });

        if (response.status === 204) {
            return null;
        }

        const isJson = response.headers.get("content-type")?.includes("application/json");
        const responseText = await response.text();
        const payload = isJson && responseText ? JSON.parse(responseText) : responseText;

        if (!response.ok) {
            if (response.status === 401 && requiresAuth) {
                clearStoredToken();
                window.dispatchEvent(new CustomEvent("cryptohub:unauthorized"));
            }
            const message = typeof payload === "object" ? payload.detail || JSON.stringify(payload) : payload;
            throw new Error(message || "API request failed.");
        }

        return payload;
    } catch (err) {
        throw err;
    }
}

export async function loginUser(username, password) {
    const formBody = new URLSearchParams({ username, password });
    const result = await apiRequest("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
    });
    if (result?.access_token) {
        storeToken(result.access_token);
        if (result.user) storeUser(result.user);
    }
    return result;
}

export async function registerUser(payload) {
    const result = await apiRequest("/auth/signup", {
        method: "POST",
        body: payload,
    });
    if (result?.access_token) {
        storeToken(result.access_token);
        if (result.user) storeUser(result.user);
    }
    return result;
}

export async function getCurrentUser() {
    const user = await apiRequest("/auth/me", {}, true);
    if (user) storeUser(user);
    return user;
}

export async function getLivePrices(forceRefresh = false) {
    const cacheKey = "live_prices";
    if (!forceRefresh) {
        const cached = getCachedData(cacheKey, 15000); // 15s TTL
        if (cached) return cached;
    }

    try {
        const data = await apiRequest("/crypto/prices/live");
        if (data && Object.keys(data).length > 0) {
            setCachedData(cacheKey, data);
        }
        return data;
    } catch (error) {
        // Return stale cache if available to prevent UI breakage
        const stale = memoryCache.get(cacheKey)?.data;
        if (stale) return stale;
        throw error;
    }
}

export async function getHistory(symbol, days = 90, forceRefresh = false) {
    const cacheKey = `history_${symbol}_${days}`;
    if (!forceRefresh) {
        const cached = getCachedData(cacheKey, 300000); // 5 min TTL
        if (cached) return cached;
    }

    try {
        const data = await apiRequest(`/crypto/history/${symbol}?days=${days}`);
        setCachedData(cacheKey, data);
        return data;
    } catch (error) {
        const stale = memoryCache.get(cacheKey)?.data;
        if (stale) return stale;
        throw error;
    }
}

export async function getForecast(symbol, forceRefresh = false) {
    const cacheKey = `forecast_${symbol}`;
    if (!forceRefresh) {
        const cached = getCachedData(cacheKey, 120000); // 2 min TTL
        if (cached) return cached;
    }

    try {
        const data = await apiRequest(`/analytics/forecast/${symbol}`);
        setCachedData(cacheKey, data);
        return data;
    } catch (error) {
        const stale = memoryCache.get(cacheKey)?.data;
        if (stale) return stale;
        throw error;
    }
}

export async function getNews(symbol, forceRefresh = false) {
    const cacheKey = `news_${symbol}`;
    if (!forceRefresh) {
        const cached = getCachedData(cacheKey, 300000); // 5 min TTL
        if (cached) return cached;
    }

    try {
        const data = await apiRequest(`/analytics/news/${symbol}`);
        setCachedData(cacheKey, data);
        return data;
    } catch (error) {
        const stale = memoryCache.get(cacheKey)?.data;
        if (stale) return stale;
        throw error;
    }
}

export async function getSnapshot(forceRefresh = false) {
    const cacheKey = "snapshot";
    if (!forceRefresh) {
        const cached = getCachedData(cacheKey, 30000); // 30s TTL
        if (cached) return cached;
    }

    try {
        const data = await apiRequest("/analytics/snapshot");
        setCachedData(cacheKey, data);
        return data;
    } catch (error) {
        const stale = memoryCache.get(cacheKey)?.data;
        if (stale) return stale;
        throw error;
    }
}

export async function getPortfolio() {
    return apiRequest("/portfolio/", {}, true);
}

export async function getSupportedCryptocurrencies() {
    const cacheKey = "supported_cryptos";
    const cached = getCachedData(cacheKey, 3600000); // 1 hr TTL
    if (cached) return cached;

    try {
        const data = await apiRequest("/crypto/supported");
        setCachedData(cacheKey, data);
        return data;
    } catch (error) {
        const stale = memoryCache.get(cacheKey)?.data;
        if (stale) return stale;
        throw error;
    }
}

export async function convertCurrency(fromCurrency, toCurrency, amount) {
    return apiRequest(`/converter/convert?from_currency=${encodeURIComponent(fromCurrency)}&to_currency=${encodeURIComponent(toCurrency)}&amount=${amount}`);
}

export async function createPortfolioEntry(payload) {
    return apiRequest("/portfolio/", {
        method: "POST",
        body: payload,
    }, true);
}

export async function deletePortfolioEntry(entryId) {
    return apiRequest(`/portfolio/${entryId}`, {
        method: "DELETE",
    }, true);
}
