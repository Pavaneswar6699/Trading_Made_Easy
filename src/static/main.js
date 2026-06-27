// ==========================================================================
// NiftyRL Dashboard — Interactive Client Logic
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    // --- Elements ---
    const tickerSelect = document.getElementById("ticker-select");
    const brokerageInput = document.getElementById("brokerage-input");
    const slippageInput = document.getElementById("slippage-input");
    const riskAversionInput = document.getElementById("risk-aversion-input");
    const drawdownCoeffInput = document.getElementById("drawdown-coeff-input");
    
    const timestepsInput = document.getElementById("timesteps-input");
    const timestepsVal = document.getElementById("timesteps-val");
    const btnTrain = document.getElementById("btn-train");
    const btnBacktest = document.getElementById("btn-backtest");
    
    const progressCard = document.getElementById("progress-card");
    const progressBarFill = document.getElementById("progress-bar-fill");
    const progressPercentage = document.getElementById("progress-percentage");
    const statusStep = document.getElementById("status-step");
    const statusWorth = document.getElementById("status-worth");
    const statusMessage = document.getElementById("status-message");
    
    const metricFinalWorth = document.getElementById("metric-final-worth");
    const metricAgentReturn = document.getElementById("metric-agent-return");
    const metricSharpe = document.getElementById("metric-sharpe");
    const metricDrawdown = document.getElementById("metric-drawdown");
    
    const statWinRate = document.getElementById("stat-win-rate");
    const statTrades = document.getElementById("stat-trades");
    const statFriction = document.getElementById("stat-friction");
    const statBenchmarkReturn = document.getElementById("stat-benchmark-return");
    
    const tradeLogBody = document.getElementById("trade-log-body");
    
    // --- Global Chart Instance ---
    let equityChartInstance = null;
    let progressInterval = null;

    // --- Format Helpers ---
    const formatCurrency = (val) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 2
        }).format(val);
    };

    const formatPercent = (val) => {
        const sign = val >= 0 ? "+" : "";
        return `${sign}${val.toFixed(2)}%`;
    };

    // --- Slider Value Change ---
    timestepsInput.addEventListener("input", (e) => {
        timestepsVal.textContent = parseInt(e.target.value).toLocaleString();
    });

    // --- Fetch Stock Tickers ---
    const loadTickers = async () => {
        try {
            const res = await fetch("/api/tickers");
            const data = await res.json();
            tickerSelect.innerHTML = "";
            data.forEach(item => {
                const opt = document.createElement("option");
                opt.value = item.symbol;
                opt.textContent = `${item.symbol} (${item.name})`;
                tickerSelect.appendChild(opt);
            });
        } catch (err) {
            console.error("Failed to load tickers:", err);
            statusMessage.textContent = "Error: Could not connect to backend.";
        }
    };

    // --- Start Training Pipeline ---
    btnTrain.addEventListener("click", async () => {
        const params = {
            ticker: tickerSelect.value,
            timesteps: parseInt(timestepsInput.value),
            brokerage: parseFloat(brokerageInput.value) / 100, // convert from %
            slippage: parseFloat(slippageInput.value) / 100,
            risk_aversion: parseFloat(riskAversionInput.value),
            drawdown_coeff: parseFloat(drawdownCoeffInput.value)
        };

        btnTrain.disabled = true;
        btnBacktest.disabled = true;
        progressCard.classList.remove("hidden");
        progressBarFill.style.width = "0%";
        progressPercentage.textContent = "0%";
        statusStep.textContent = "0";
        statusWorth.textContent = formatCurrency(100000);
        statusMessage.textContent = "Initialising PPO Agent training...";

        try {
            const res = await fetch("/api/train", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params)
            });
            const data = await res.json();

            if (data.status === "ok") {
                // Poll status every second
                progressInterval = setInterval(pollTrainingProgress, 1000);
            } else {
                statusMessage.textContent = `Error: ${data.message}`;
                btnTrain.disabled = false;
                btnBacktest.disabled = false;
            }
        } catch (err) {
            console.error(err);
            statusMessage.textContent = "Error: Network connection failed.";
            btnTrain.disabled = false;
            btnBacktest.disabled = false;
        }
    });

    // --- Poll Progress Endpoint ---
    const pollTrainingProgress = async () => {
        try {
            const res = await fetch("/api/train/status");
            const data = await res.json();

            progressBarFill.style.width = `${data.progress_pct}%`;
            progressPercentage.textContent = `${Math.round(data.progress_pct)}%`;
            statusStep.textContent = data.current_step.toLocaleString();
            statusWorth.textContent = formatCurrency(data.net_worth);
            statusMessage.textContent = data.message;

            if (!data.is_training) {
                clearInterval(progressInterval);
                btnTrain.disabled = false;
                btnBacktest.disabled = false;
                
                if (data.progress_pct >= 100) {
                    statusMessage.textContent = "Agent successfully trained! Ready to backtest.";
                    // Automatically run a backtest on completion
                    runBacktestSimulation();
                } else {
                    statusMessage.textContent = `Training stopped: ${data.message}`;
                }
            }
        } catch (err) {
            console.error("Progress polling error:", err);
        }
    };

    // --- Run Backtest Simulation ---
    btnBacktest.addEventListener("click", () => {
        runBacktestSimulation();
    });

    const runBacktestSimulation = async () => {
        const params = {
            ticker: tickerSelect.value,
            years: 2, // 2 years backtest
            brokerage: parseFloat(brokerageInput.value) / 100,
            slippage: parseFloat(slippageInput.value) / 100,
            risk_aversion: parseFloat(riskAversionInput.value),
            drawdown_coeff: parseFloat(drawdownCoeffInput.value)
        };

        btnBacktest.disabled = true;
        btnTrain.disabled = true;
        
        // Show loading state in metrics
        metricFinalWorth.textContent = "Running...";
        metricAgentReturn.textContent = "Calculating...";
        metricAgentReturn.className = "metric-value";
        
        try {
            const res = await fetch("/api/backtest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params)
            });
            const data = await res.json();

            if (data.error) {
                alert(data.error);
                metricFinalWorth.textContent = formatCurrency(100000);
                metricAgentReturn.textContent = "+0.00%";
                btnBacktest.disabled = false;
                btnTrain.disabled = false;
                return;
            }

            // --- Update Top Metrics ---
            metricFinalWorth.textContent = formatCurrency(data.metrics.final_net_worth);
            metricAgentReturn.textContent = formatPercent(data.metrics.total_return_pct);
            if (data.metrics.total_return_pct >= 0) {
                metricAgentReturn.className = "metric-value positive";
            } else {
                metricAgentReturn.className = "metric-value negative";
            }
            metricSharpe.textContent = data.metrics.sharpe_ratio.toFixed(4);
            metricDrawdown.textContent = `${data.metrics.max_drawdown_pct.toFixed(2)}%`;

            // --- Update Footer Stats Row ---
            statWinRate.textContent = `${data.metrics.win_rate_pct.toFixed(1)}%`;
            statTrades.textContent = data.metrics.total_trades;
            statFriction.textContent = formatCurrency(data.metrics.total_friction);
            statBenchmarkReturn.textContent = formatPercent(data.metrics.buy_hold_return_pct);

            // --- Render Chart ---
            renderCharts(data);

            // --- Render Trade Table Logs ---
            renderTradeTable(data.trades);

        } catch (err) {
            console.error(err);
            alert("Failed to fetch backtest results from backend server.");
        } finally {
            btnBacktest.disabled = false;
            btnTrain.disabled = false;
        }
    };

    // --- Chart Rendering Function ---
    const renderCharts = (data) => {
        const ctx = document.getElementById("equity-chart").getContext("2d");
        
        if (equityChartInstance) {
            equityChartInstance.destroy();
        }

        // Setup dual-axis Chart.js representation
        equityChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.dates,
                datasets: [
                    {
                        label: 'RL Agent Equity Curve',
                        data: data.agent_net_worth,
                        borderColor: '#06b6d4',
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Buy-and-Hold Benchmark',
                        data: data.benchmark_net_worth,
                        borderColor: 'rgba(148, 163, 184, 0.45)',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Target Asset Exposure',
                        data: data.exposures.map(e => e * 100), // convert to %
                        backgroundColor: 'rgba(6, 182, 212, 0.05)',
                        borderColor: 'rgba(6, 182, 212, 0.15)',
                        borderWidth: 1,
                        type: 'bar',
                        yAxisID: 'y1',
                        barPercentage: 1.0,
                        categoryPercentage: 1.0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Outfit', size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.datasetIndex === 2) {
                                    label += `${context.raw.toFixed(0)}%`;
                                } else {
                                    label += formatCurrency(context.raw);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.02)' },
                        ticks: { color: '#64748b', maxTicksLimit: 12 }
                    },
                    y: {
                        position: 'left',
                        grid: { color: 'rgba(255, 255, 255, 0.04)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: function(value) {
                                return '₹' + value.toLocaleString();
                            }
                        },
                        title: {
                            display: true,
                            text: 'Portfolio Value (₹)',
                            color: '#94a3b8'
                        }
                    },
                    y1: {
                        position: 'right',
                        min: 0,
                        max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#64748b',
                            callback: function(value) { return value + '%'; }
                        },
                        title: {
                            display: true,
                            text: 'Exposure (%)',
                            color: '#64748b'
                        }
                    }
                }
            }
        });
    };

    // --- Table Renderer ---
    const renderTradeTable = (trades) => {
        tradeLogBody.innerHTML = "";
        
        if (!trades || trades.length === 0) {
            tradeLogBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted">No trades executed during this testing period.</td>
                </tr>`;
            return;
        }

        trades.forEach(trade => {
            const tr = document.createElement("tr");
            
            // Format PnL cell
            let pnlHtml = "-";
            if (trade.pnl !== undefined && trade.pnl !== null) {
                const pnlClass = trade.pnl >= 0 ? "text-positive" : "text-negative";
                const pnlSign = trade.pnl >= 0 ? "+" : "";
                pnlHtml = `<span class="${pnlClass}">${pnlSign}${formatCurrency(trade.pnl)}</span>`;
            }

            // Style Action Label
            let actionBadge = "hold";
            if (trade.action.includes("BUY")) actionBadge = "buy";
            if (trade.action.includes("SELL")) actionBadge = "sell";

            tr.innerHTML = `
                <td><strong>#${trade.step}</strong></td>
                <td><span class="tbl-badge ${actionBadge}">${trade.action}</span></td>
                <td>${formatCurrency(trade.price)}</td>
                <td>${trade.shares} shares</td>
                <td>${formatCurrency(trade.commission)}</td>
                <td>${pnlHtml}</td>
                <td>${formatCurrency(trade.capital_after)}</td>
            `;
            tradeLogBody.appendChild(tr);
        });
    };

    // --- Initialise Dashboard ---
    loadTickers();
});
