const chartRegistry = {};

const palette = {
    emerald: "#10b981",
    emeraldSoft: "rgba(16, 185, 129, 0.12)",
    indigo: "#6366f1",
    indigoSoft: "rgba(99, 102, 241, 0.15)",
    amber: "#f59e0b",
    amberSoft: "rgba(245, 158, 11, 0.15)",
    crimson: "#ef4444",
    crimsonSoft: "rgba(239, 68, 68, 0.15)",
    cyan: "#06b6d4",
    cyanSoft: "rgba(6, 182, 212, 0.14)",
    text: "#f8fafc",
    textMuted: "#94a3b8",
    borderMuted: "rgba(148, 163, 184, 0.1)",
};

function baseChartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 100,
        animation: {
            duration: 350,
            easing: "easeOutQuart",
        },
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: {
                labels: {
                    color: palette.text,
                    font: { family: "'IBM Plex Sans', sans-serif", size: 12, weight: "500" },
                    boxWidth: 12,
                    boxHeight: 12,
                    usePointStyle: true,
                },
            },
            tooltip: {
                enabled: true,
                backgroundColor: "rgba(15, 23, 42, 0.94)",
                borderColor: "rgba(255, 255, 255, 0.12)",
                borderWidth: 1,
                padding: 12,
                titleColor: palette.text,
                titleFont: { family: "'IBM Plex Sans', sans-serif", size: 13, weight: "600" },
                bodyColor: "#cbd5e1",
                bodyFont: { family: "'IBM Plex Mono', 'JetBrains Mono', monospace", size: 12 },
                boxPadding: 4,
                cornerRadius: 8,
            },
        },
        scales: {
            x: {
                ticks: {
                    color: palette.textMuted,
                    font: { size: 11 },
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: 8,
                },
                grid: { color: palette.borderMuted, drawBorder: false },
            },
            y: {
                grace: "5%",
                ticks: {
                    color: palette.textMuted,
                    font: { size: 11 },
                    callback: (value) => {
                        if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
                        if (value < 1) return `$${Number(value).toFixed(4)}`;
                        return `$${Number(value).toFixed(2)}`;
                    },
                },
                grid: { color: palette.borderMuted, drawBorder: false },
            },
        },
        elements: {
            point: {
                radius: 0,
                hoverRadius: 5,
                hitRadius: 10,
                hoverBorderWidth: 2,
            },
            line: { borderJoinStyle: "round" },
        },
    };
}

export function destroyChart(name, canvas = null) {
    if (chartRegistry[name]) {
        try {
            chartRegistry[name].destroy();
        } catch (_) {}
        delete chartRegistry[name];
    }
    if (canvas && typeof Chart !== "undefined" && typeof Chart.getChart === "function") {
        try {
            const chart = Chart.getChart(canvas);
            if (chart) chart.destroy();
        } catch (_) {}
    }
}

export function resizeAllCharts() {
    Object.values(chartRegistry).forEach((chart) => {
        try {
            if (chart && typeof chart.resize === "function") {
                const canvas = chart.canvas;
                if (canvas && canvas.offsetParent !== null && canvas.clientHeight > 0) {
                    chart.resize();
                }
            }
        } catch (_) {}
    });
}

function buildLabels(points) {
    return points.map((point) => {
        const d = new Date(point.timestamp);
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
    });
}

export function renderHistoricalChart(points, symbol) {
    const canvas = document.getElementById("historicalPriceChart");
    destroyChart("historical", canvas);
    if (!canvas || !points?.length) return;

    const ctx = canvas.getContext("2d");
    const labels = buildLabels(points);

    const prices = points.map((p) => Number(p.price ?? p.close ?? 0));
    const startPrice = prices[0] || 0;
    const endPrice = prices[prices.length - 1] || 0;
    const isUp = endPrice >= startPrice;
    const primaryColor = isUp ? palette.emerald : palette.crimson;

    let gradient = isUp ? palette.emeraldSoft : palette.crimsonSoft;
    if (ctx) {
        try {
            const g = ctx.createLinearGradient(0, 0, 0, 380);
            if (isUp) {
                g.addColorStop(0, "rgba(16, 185, 129, 0.30)");
                g.addColorStop(0.55, "rgba(16, 185, 129, 0.05)");
                g.addColorStop(1, "rgba(16, 185, 129, 0.0)");
            } else {
                g.addColorStop(0, "rgba(239, 68, 68, 0.30)");
                g.addColorStop(0.55, "rgba(239, 68, 68, 0.05)");
                g.addColorStop(1, "rgba(239, 68, 68, 0.0)");
            }
            gradient = g;
        } catch (_) {}
    }

    const datasets = [
        {
            label: `${symbol} Spot Close`,
            data: prices,
            borderColor: primaryColor,
            backgroundColor: gradient,
            fill: true,
            borderWidth: 2.2,
            tension: 0.2,
            pointRadius: points.length <= 14 ? 3 : 0,
            pointHoverRadius: 6,
            pointBackgroundColor: primaryColor,
            pointBorderColor: "#0f172a",
            pointBorderWidth: 2,
        },
    ];

    if (points.length >= 20) {
        const period = points.length >= 60 ? 20 : 7;
        const sma = prices.map((_, idx) => {
            if (idx < period - 1) return null;
            const slice = prices.slice(idx - period + 1, idx + 1);
            const sum = slice.reduce((a, b) => a + b, 0);
            return Number((sum / period).toFixed(2));
        });

        datasets.push({
            label: `${period}D SMA`,
            data: sma,
            borderColor: palette.cyan,
            backgroundColor: "transparent",
            borderWidth: 1.5,
            borderDash: [5, 4],
            fill: false,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: palette.cyan,
        });
    }

    chartRegistry.historical = new Chart(canvas, {
        type: "line",
        data: { labels, datasets },
        options: {
            ...baseChartOptions(),
            plugins: {
                ...baseChartOptions().plugins,
                tooltip: {
                    ...baseChartOptions().plugins.tooltip,
                    callbacks: {
                        title: (items) => {
                            if (!items.length) return "";
                            const idx = items[0].dataIndex;
                            const pt = points[idx];
                            if (!pt) return items[0].label;
                            const d = new Date(pt.timestamp);
                            return d.toLocaleDateString([], {
                                weekday: "short",
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                            });
                        },
                        label: (context) => {
                            const val = Number(context.parsed.y);
                            const formattedVal = val.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: val < 1 ? 4 : 2,
                            });
                            if (context.datasetIndex === 0) {
                                const diff = startPrice > 0 ? (((val - startPrice) / startPrice) * 100).toFixed(2) : "0.00";
                                const sign = Number(diff) >= 0 ? "+" : "";
                                return ` ${symbol} Spot: $${formattedVal} (${sign}${diff}% vs period start)`;
                            }
                            return ` ${context.dataset.label}: $${formattedVal}`;
                        },
                        afterBody: (items) => {
                            if (!items.length) return [];
                            const idx = items[0].dataIndex;
                            const pt = points[idx];
                            if (!pt || pt.high == null || pt.low == null) return [];
                            return [
                                ` 24h High: $${Number(pt.high).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                                ` 24h Low:  $${Number(pt.low).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                            ];
                        },
                    },
                },
            },
        },
    });
}

export function renderPriceChart(points, symbol, forecastPoints = []) {
    const canvas = document.getElementById("priceChart");
    destroyChart("price", canvas);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const labels = buildLabels([...points, ...forecastPoints]);

    // Gradient fill for sleek institutional look
    let gradient = palette.emeraldSoft;
    if (ctx) {
        try {
            const g = ctx.createLinearGradient(0, 0, 0, 320);
            g.addColorStop(0, "rgba(16, 185, 129, 0.28)");
            g.addColorStop(1, "rgba(16, 185, 129, 0.0)");
            gradient = g;
        } catch (_) {}
    }

    const datasets = [
        {
            label: `${symbol} Spot Price`,
            data: [...points.map((p) => p.price), ...Array(forecastPoints.length).fill(null)],
            borderColor: palette.emerald,
            backgroundColor: gradient,
            fill: true,
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: palette.emerald,
        },
    ];

    if (forecastPoints.length && points.length) {
        datasets.push({
            label: `${symbol} ML Projection`,
            data: [
                ...Array(Math.max(points.length - 1, 0)).fill(null),
                points[points.length - 1].price,
                ...forecastPoints.map((p) => p.price),
            ],
            borderColor: palette.amber,
            backgroundColor: "transparent",
            borderDash: [5, 4],
            fill: false,
            borderWidth: 2.2,
            tension: 0.2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: palette.amber,
        });
    }

    chartRegistry.price = new Chart(canvas, {
        type: "line",
        data: { labels, datasets },
        options: {
            ...baseChartOptions(),
            plugins: {
                ...baseChartOptions().plugins,
                tooltip: {
                    ...baseChartOptions().plugins.tooltip,
                    callbacks: {
                        label: (context) => {
                            const val = Number(context.parsed.y);
                            return ` ${context.dataset.label}: $${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: val < 1 ? 4 : 2 })}`;
                        },
                    },
                },
            },
        },
    });
}

export function renderForecastChart(points, symbol) {
    destroyChart("forecast");
    const canvas = document.getElementById("forecastChart");
    if (!canvas || !points?.length) return;

    chartRegistry.forecast = new Chart(canvas, {
        type: "line",
        data: {
            labels: points.map((p, i) => `T+${i + 1} (${new Date(p.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })})`),
            datasets: [
                {
                    label: `${symbol} Predicted Horizon`,
                    data: points.map((p) => p.price),
                    borderColor: palette.amber,
                    backgroundColor: palette.amberSoft,
                    borderWidth: 2.2,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBackgroundColor: palette.amber,
                    pointBorderColor: "#0f172a",
                    pointBorderWidth: 2,
                    tension: 0.3,
                    fill: true,
                },
            ],
        },
        options: {
            ...baseChartOptions(),
            plugins: {
                ...baseChartOptions().plugins,
                tooltip: {
                    ...baseChartOptions().plugins.tooltip,
                    callbacks: {
                        label: (context) => ` Projected: $${Number(context.parsed.y).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    },
                },
            },
        },
    });
}

export function renderModelChart(metrics) {
    destroyChart("model");
    const canvas = document.getElementById("modelChart");
    if (!canvas || !metrics?.length) return;

    chartRegistry.model = new Chart(canvas, {
        type: "bar",
        data: {
            labels: metrics.map((m) => m.model_name || "Random Forest"),
            datasets: [
                {
                    label: "RMSE ($)",
                    data: metrics.map((m) => m.rmse),
                    backgroundColor: palette.indigoSoft,
                    borderColor: palette.indigo,
                    borderWidth: 1.5,
                    borderRadius: 6,
                },
                {
                    label: "MAE ($)",
                    data: metrics.map((m) => m.mae),
                    backgroundColor: palette.emeraldSoft,
                    borderColor: palette.emerald,
                    borderWidth: 1.5,
                    borderRadius: 6,
                },
                {
                    label: "MAPE (%)",
                    data: metrics.map((m) => m.mape),
                    backgroundColor: palette.amberSoft,
                    borderColor: palette.amber,
                    borderWidth: 1.5,
                    borderRadius: 6,
                },
            ],
        },
        options: {
            ...baseChartOptions(),
            scales: {
                ...baseChartOptions().scales,
                y: {
                    ...baseChartOptions().scales.y,
                    ticks: {
                        color: palette.textMuted,
                        callback: (v) => v,
                    },
                },
            },
        },
    });
}

export function renderBacktestChart(points, symbol) {
    destroyChart("backtest");
    const canvas = document.getElementById("backtestChart");
    if (!canvas || !points?.length) return;

    chartRegistry.backtest = new Chart(canvas, {
        type: "line",
        data: {
            labels: points.map((p) => new Date(p.date || p.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })),
            datasets: [
                {
                    label: `${symbol} Actual Historical`,
                    data: points.map((p) => p.actual_close || p.actual),
                    borderColor: palette.emerald,
                    borderWidth: 1.8,
                    pointRadius: 0,
                    tension: 0.2,
                },
                {
                    label: "Model Backtest Estimate",
                    data: points.map((p) => p.predicted_close || p.predicted),
                    borderColor: palette.indigo,
                    borderWidth: 1.8,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    tension: 0.2,
                },
            ],
        },
        options: {
            ...baseChartOptions(),
            plugins: {
                ...baseChartOptions().plugins,
                tooltip: {
                    ...baseChartOptions().plugins.tooltip,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    },
                },
            },
        },
    });
}

export function renderComparisonChart(items) {
    destroyChart("comparison");
    const canvas = document.getElementById("comparisonChart");
    if (!canvas || !items?.length) return;

    const labels = items.map((item) => item.symbol);
    const predictedMoves = items.map((item) => Number(item.predicted_change_pct || 0));
    const colors = predictedMoves.map((v) => (v >= 0 ? palette.emerald : palette.crimson));
    const borderColors = predictedMoves.map((v) => (v >= 0 ? "#10b981" : "#ef4444"));

    chartRegistry.comparison = new Chart(canvas, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Expected Move (%)",
                    data: predictedMoves,
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1.5,
                    borderRadius: 6,
                },
            ],
        },
        options: {
            ...baseChartOptions(),
            scales: {
                x: {
                    ticks: { color: palette.text, font: { weight: "600" } },
                    grid: { display: false },
                },
                y: {
                    ticks: {
                        color: palette.textMuted,
                        callback: (v) => `${v > 0 ? "+" : ""}${v}%`,
                    },
                    grid: { color: palette.borderMuted },
                },
            },
            plugins: {
                ...baseChartOptions().plugins,
                tooltip: {
                    ...baseChartOptions().plugins.tooltip,
                    callbacks: {
                        label: (ctx) => ` Projected Move: ${ctx.parsed.y > 0 ? "+" : ""}${Number(ctx.parsed.y).toFixed(2)}%`,
                    },
                },
            },
        },
    });
}

export function renderSentimentChart(counts) {
    destroyChart("sentiment");
    const canvas = document.getElementById("sentimentChart");
    if (!canvas) return;

    const total = (counts.positive || 0) + (counts.neutral || 0) + (counts.negative || 0) || 1;
    const posPct = Math.round(((counts.positive || 0) / total) * 100);
    const neuPct = Math.round(((counts.neutral || 0) / total) * 100);
    const negPct = 100 - posPct - neuPct;

    chartRegistry.sentiment = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: [`Positive (${posPct}%)`, `Neutral (${neuPct}%)`, `Negative (${negPct}%)`],
            datasets: [
                {
                    data: [counts.positive || 0, counts.neutral || 0, counts.negative || 0],
                    backgroundColor: [palette.emerald, palette.amber, palette.crimson],
                    borderColor: "#0f172a",
                    borderWidth: 3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "74%",
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: palette.text,
                        boxWidth: 10,
                        usePointStyle: true,
                        font: { size: 11 },
                    },
                },
            },
        },
    });
}
