// ==========================================================================
// NiftyRL Trading Studio — Interactive Wizard Client Logic
// ==========================================================================

import { dbSaveScore, dbGetScores, useFirebase, auth } from "./firebase-config.js";
import { signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // ==========================================================================
    // 1. BACKGROUND SWARMING PARTICLE BACKDROP
    // ==========================================================================
    const bgCanvas = document.getElementById("bg-particle-canvas");
    const bgCtx = bgCanvas.getContext("2d");
    
    let particles = [];
    const particleCount = 60;
    const mouse = { x: null, y: null, radius: 140 };

    function resizeBgCanvas() {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resizeBgCanvas);
    resizeBgCanvas();

    window.addEventListener("mousemove", (e) => {
        mouse.x = e.x;
        mouse.y = e.y;
    });

    window.addEventListener("mouseout", () => {
        mouse.x = null;
        mouse.y = null;
    });

    class Particle {
        constructor() {
            this.x = Math.random() * bgCanvas.width;
            this.y = Math.random() * bgCanvas.height;
            this.vx = (Math.random() - 0.5) * 0.7;
            this.vy = (Math.random() - 0.5) * 0.7;
            this.size = Math.random() * 2 + 1;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;

            if (this.x < 0 || this.x > bgCanvas.width) this.vx *= -1;
            if (this.y < 0 || this.y > bgCanvas.height) this.vy *= -1;

            if (mouse.x !== null) {
                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let dist = Math.hypot(dx, dy);
                if (dist < mouse.radius) {
                    let force = (mouse.radius - dist) / mouse.radius;
                    this.x += (dx / dist) * force * 1.2;
                    this.y += (dy / dist) * force * 1.2;
                }
            }
        }
        draw() {
            bgCtx.beginPath();
            bgCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            bgCtx.fillStyle = "rgba(255, 255, 255, 0.15)";
            bgCtx.fill();
        }
    }

    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    function animateBackground() {
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();

            for (let j = i + 1; j < particles.length; j++) {
                let dx = particles[i].x - particles[j].x;
                let dy = particles[i].y - particles[j].y;
                let dist = Math.hypot(dx, dy);
                if (dist < 110) {
                    bgCtx.beginPath();
                    bgCtx.moveTo(particles[i].x, particles[i].y);
                    bgCtx.lineTo(particles[j].x, particles[j].y);
                    bgCtx.strokeStyle = `rgba(0, 240, 255, ${0.08 * (1 - dist/110)})`;
                    bgCtx.lineWidth = 0.5;
                    bgCtx.stroke();
                }
            }
        }
        requestAnimationFrame(animateBackground);
    }
    animateBackground();


    // ==========================================================================
    // 2. ELEMENT SELECTIONS & WIZARD UI EVENT LISTENERS
    // ==========================================================================
    const varsityToggle = document.getElementById("varsity-toggle");
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
    
    const resultsSection = document.getElementById("results-section");
    const btnPublish = document.getElementById("btn-publish");
    const metricFinalWorth = document.getElementById("metric-final-worth");
    const metricAgentReturn = document.getElementById("metric-agent-return");
    const metricSharpe = document.getElementById("metric-sharpe");
    const metricDrawdown = document.getElementById("metric-drawdown");
    const aiAdvisorText = document.getElementById("ai-advisor-text");
    
    const statWinRate = document.getElementById("stat-win-rate");
    const statTrades = document.getElementById("stat-trades");
    const statFriction = document.getElementById("stat-friction");
    const statBenchmarkReturn = document.getElementById("stat-benchmark-return");
    
    const tradeLogBody = document.getElementById("trade-log-body");
    const scoreboardBody = document.getElementById("scoreboard-body");

    let equityChartInstance = null;
    let progressInterval = null;
    let lastBacktestResult = null; 

    // Format utility helpers
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

    // Range slider tracking
    timestepsInput.addEventListener("input", (e) => {
        timestepsVal.textContent = parseInt(e.target.value).toLocaleString();
    });


    // ==========================================================================
    // 3. VARSITY MODE EXPLANATIONS CONTROLLER
    // ==========================================================================
    varsityToggle.addEventListener("change", () => {
        const explainers = document.querySelectorAll(".varsity-explain");
        explainers.forEach(el => {
            if (varsityToggle.checked) {
                el.classList.remove("hidden");
            } else {
                el.classList.add("hidden");
            }
        });
    });


    // ==========================================================================
    // 4. STOCK CHOICE API LOADERS
    // ==========================================================================
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
        }
    };


    // ==========================================================================
    // 5. TRAINING LOGIC
    // ==========================================================================
    btnTrain.addEventListener("click", async () => {
        const params = {
            ticker: tickerSelect.value,
            timesteps: parseInt(timestepsInput.value),
            brokerage: parseFloat(brokerageInput.value) / 100,
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
        statusMessage.textContent = "Spawning environments...";

        try {
            const res = await fetch("/api/train", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params)
            });
            const data = await res.json();

            if (data.status === "ok") {
                progressInterval = setInterval(pollProgress, 1000);
            } else {
                statusMessage.textContent = `Error: ${data.message}`;
                btnTrain.disabled = false;
                btnBacktest.disabled = false;
            }
        } catch (err) {
            console.error(err);
            statusMessage.textContent = "Connection to training runner failed.";
            btnTrain.disabled = false;
            btnBacktest.disabled = false;
        }
    });

    const pollProgress = async () => {
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
                    statusMessage.textContent = "AI Model trained! Proceed to Step 3.";
                } else {
                    statusMessage.textContent = `Stopped: ${data.message}`;
                }
            }
        } catch (err) {
            console.error(err);
        }
    };


    // ==========================================================================
    // 6. SIMULATION BACKTEST & AI DIAGNOSTICS ADVISOR
    // ==========================================================================
    btnBacktest.addEventListener("click", async () => {
        const params = {
            ticker: tickerSelect.value,
            years: 2,
            brokerage: parseFloat(brokerageInput.value) / 100,
            slippage: parseFloat(slippageInput.value) / 100,
            risk_aversion: parseFloat(riskAversionInput.value),
            drawdown_coeff: parseFloat(drawdownCoeffInput.value)
        };

        btnBacktest.disabled = true;
        btnTrain.disabled = true;
        resultsSection.classList.remove("hidden");
        metricFinalWorth.textContent = "Processing...";
        metricAgentReturn.textContent = "Calculating...";
        metricAgentReturn.className = "value";

        try {
            const res = await fetch("/api/backtest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params)
            });
            const data = await res.json();

            if (data.error) {
                alert(data.error);
                resultsSection.classList.add("hidden");
                return;
            }

            lastBacktestResult = data; 

            // Update top cards
            metricFinalWorth.textContent = formatCurrency(data.metrics.final_net_worth);
            metricAgentReturn.textContent = formatPercent(data.metrics.total_return_pct);
            
            // Neon status highlights
            if (data.metrics.total_return_pct >= 0) {
                metricAgentReturn.className = "value positive";
                resultsSection.style.borderColor = "var(--neon-green)";
                resultsSection.style.boxShadow = "var(--glow-green)";
            } else {
                metricAgentReturn.className = "value negative";
                resultsSection.style.borderColor = "var(--neon-red)";
                resultsSection.style.boxShadow = "0 0 15px rgba(244, 63, 94, 0.35)";
            }

            metricSharpe.textContent = data.metrics.sharpe_ratio.toFixed(4);
            metricDrawdown.textContent = `${data.metrics.max_drawdown_pct.toFixed(2)}%`;

            // Update footer row
            statWinRate.textContent = `${data.metrics.win_rate_pct.toFixed(1)}%`;
            statTrades.textContent = data.metrics.total_trades;
            statFriction.textContent = formatCurrency(data.metrics.total_friction);
            statBenchmarkReturn.textContent = formatPercent(data.metrics.buy_hold_return_pct);

            // Run automated AI Advisor Diagnostics
            runAIDiagnostics(data.metrics);

            // Render chart and tables
            renderChart(data);
            renderTradeTable(data.trades);
            
            resultsSection.scrollIntoView({ behavior: 'smooth' });

        } catch (err) {
            console.error(err);
            alert("Error: Backtest request timed out or server crashed.");
            resultsSection.classList.add("hidden");
        } finally {
            btnBacktest.disabled = false;
            btnTrain.disabled = false;
        }
    });

    // AI Performance Diagnostics Reviewer
    function runAIDiagnostics(metrics) {
        let text = "";
        const ticker = tickerSelect.value;
        const returnDiff = metrics.total_return_pct - metrics.buy_hold_return_pct;

        text += `Your agent finished with a final return of <strong>${formatPercent(metrics.total_return_pct)}</strong> on ${ticker}, compared to the benchmark's return of <strong>${formatPercent(metrics.buy_hold_return_pct)}</strong>. `;

        if (returnDiff > 5) {
            text += `Outstanding! The AI agent outperformed standard Buy-and-Hold by <strong>${returnDiff.toFixed(2)}%</strong>. `;
        } else if (returnDiff > 0) {
            text += `Good. The agent successfully beat the benchmark, showing positive risk-adjusted metrics. `;
        } else {
            text += `The agent underperformed the benchmark by <strong>${Math.abs(returnDiff).toFixed(2)}%</strong>. `;
        }

        // Sharpe analysis (Varsity Module 9)
        if (metrics.sharpe_ratio > 1.5) {
            text += `The Sharpe ratio is excellent at <strong>${metrics.sharpe_ratio.toFixed(2)}</strong>. This indicates highly efficient risk-adjusted performance. `;
        } else if (metrics.sharpe_ratio > 0.8) {
            text += `The Sharpe ratio of <strong>${metrics.sharpe_ratio.toFixed(2)}</strong> is decent, meaning rewards are balanced relative to volatility. `;
        } else {
            text += `The Sharpe ratio is weak (<strong>${metrics.sharpe_ratio.toFixed(2)}</strong>). According to <em>Varsity Module 10 (Trading Systems)</em>, you should consider increasing <strong>Training Steps</strong> to 100,000+ so the agent is exposed to more volatility cycles. `;
        }

        // Drawdown analysis (Varsity Module 9)
        if (metrics.max_drawdown_pct > 7.0) {
            text += `However, the maximum drawdown reached <strong>${metrics.max_drawdown_pct.toFixed(2)}%</strong>, which exposes your capital to high risk. Under <em>Varsity Module 9 (Risk Management)</em> guidelines, you should increase the <strong>Risk Aversion</strong> and <strong>Drawdown Coeff</strong> settings in Step 1 to make the reward penalty stronger. `;
        } else {
            text += `Importantly, the maximum drawdown was kept tight at <strong>${metrics.max_drawdown_pct.toFixed(2)}%</strong>, demonstrating excellent defensive risk management. `;
        }

        // Friction charges (Varsity Module 7)
        const avgFrictionPerTrade = metrics.total_friction / (metrics.total_trades || 1);
        if (metrics.total_friction > 1500) {
            text += `Total frictions paid were high at <strong>${formatCurrency(metrics.total_friction)}</strong>. Under <em>Varsity Module 7 (Taxation & Charges)</em> principles, high transaction frequencies can erode profits. Try widening your brokerage settings or training the policy with higher transaction penalties to discourage excessive trading.`;
        }

        aiAdvisorText.innerHTML = text;
    }

    const renderChart = (data) => {
        const ctx = document.getElementById("equity-chart").getContext("2d");
        if (equityChartInstance) {
            equityChartInstance.destroy();
        }

        equityChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.dates,
                datasets: [
                    {
                        label: 'My AI Agent (RL)',
                        data: data.agent_net_worth,
                        borderColor: '#00f0ff',
                        borderWidth: 2.5,
                        pointRadius: 0,
                        fill: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Buy-and-Hold Benchmark',
                        data: data.benchmark_net_worth,
                        borderColor: 'rgba(189, 0, 255, 0.45)',
                        borderWidth: 1.5,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Market Position Exposure',
                        data: data.exposures.map(e => e * 100),
                        backgroundColor: 'rgba(0, 240, 255, 0.04)',
                        borderColor: 'rgba(0, 240, 255, 0.12)',
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
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(13, 20, 38, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
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
                        ticks: { color: '#475569', maxTicksLimit: 10 }
                    },
                    y: {
                        position: 'left',
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: (val) => '₹' + val.toLocaleString()
                        },
                        title: { display: true, text: 'Portfolio Worth (₹)', color: '#94a3b8' }
                    },
                    y1: {
                        position: 'right',
                        min: 0,
                        max: 100,
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#475569',
                            callback: (val) => val + '%'
                        },
                        title: { display: true, text: 'Exposure (%)', color: '#475569' }
                    }
                }
            }
        });
    };

    const renderTradeTable = (trades) => {
        tradeLogBody.innerHTML = "";
        if (!trades || trades.length === 0) {
            tradeLogBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No trades recorded during simulation.</td></tr>`;
            return;
        }

        trades.forEach(trade => {
            const tr = document.createElement("tr");
            let pnlHtml = "-";
            if (trade.pnl !== undefined && trade.pnl !== null) {
                const pnlClass = trade.pnl >= 0 ? "text-positive" : "text-negative";
                const pnlSign = trade.pnl >= 0 ? "+" : "";
                pnlHtml = `<span class="${pnlClass}">${pnlSign}${formatCurrency(trade.pnl)}</span>`;
            }

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


    // ==========================================================================
    // 7. SCOREBOARD / LEADERBOARD OPERATIONS
    // ==========================================================================
    async function loadScoreboard() {
        scoreboardBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Syncing leaderboard database...</td></tr>`;
        try {
            const scores = await dbGetScores(10);
            scoreboardBody.innerHTML = "";
            if (scores.length === 0) {
                scoreboardBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No high scores published yet.</td></tr>`;
                return;
            }

            scores.forEach((sc, index) => {
                const tr = document.createElement("tr");
                if (index === 0) tr.className = "top-rank-1";
                
                const dateStr = new Date(sc.timestamp).toLocaleDateString('en-IN', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                tr.innerHTML = `
                    <td><strong>#${index + 1}</strong></td>
                    <td><span class="text-positive">${sc.ticker}</span></td>
                    <td>${escapeHtml(sc.creator)}</td>
                    <td><strong>${formatPercent(sc.total_return_pct)}</strong></td>
                    <td>${sc.sharpe_ratio.toFixed(4)}</td>
                    <td>${sc.max_drawdown_pct.toFixed(2)}%</td>
                    <td>${formatCurrency(sc.total_friction)}</td>
                    <td><small class="text-muted">${dateStr}</small></td>
                `;
                scoreboardBody.appendChild(tr);
            });
        } catch (e) {
            console.error("Scoreboard fetch failed:", e);
            scoreboardBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Failed to sync scoreboard database.</td></tr>`;
        }
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    btnPublish.addEventListener("click", async () => {
        if (!lastBacktestResult) {
            alert("Please run a backtest simulation before publishing your results.");
            return;
        }

        let creatorName = "Anonymous Creator";
        if (currentUser) {
            creatorName = currentUser.email ? currentUser.email.split("@")[0] : "QuantUser";
        }

        btnPublish.disabled = true;
        btnPublish.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

        const scoreObj = {
            ticker: tickerSelect.value,
            creator: creatorName,
            total_return_pct: lastBacktestResult.metrics.total_return_pct,
            sharpe_ratio: lastBacktestResult.metrics.sharpe_ratio,
            max_drawdown_pct: lastBacktestResult.metrics.max_drawdown_pct,
            total_friction: lastBacktestResult.metrics.total_friction
        };

        const success = await dbSaveScore(scoreObj);
        
        btnPublish.disabled = false;
        btnPublish.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Publish to Scoreboard`;

        if (success) {
            loadScoreboard();
        } else {
            alert("Scoreboard publish failed. Check developer console.");
        }
    });


    // ==========================================================================
    // 7. LIVE QUANT TRADING DESK SIMULATOR
    // ==========================================================================
    const obAsks = document.getElementById("ob-asks");
    const obBids = document.getElementById("ob-bids");
    const obSpread = document.getElementById("ob-spread");
    const liveLedgerFeed = document.getElementById("live-ledger-feed");
    const newsTicker = document.getElementById("news-ticker");

    // Baseline prices mapping
    const getBasePrice = () => {
        const symbol = tickerSelect.value || "RELIANCE.NS";
        if (symbol.includes("RELIANCE")) return 2420.50;
        if (symbol.includes("TCS")) return 3852.10;
        if (symbol.includes("INFY")) return 1552.40;
        if (symbol.includes("HDFCBANK")) return 1654.80;
        if (symbol.includes("NIFTY")) return 23415.50;
        return 1000.00;
    };

    // Update order book display
    const updateOrderBook = () => {
        if (!obAsks || !obBids) return;

        const base = getBasePrice();
        const randOffset = (Math.random() - 0.5) * 0.5; // slight random drift
        const currentPrice = base + randOffset;

        // Generate 4 levels of asks (descending order for correct visual layout)
        let asksHtml = "";
        for (let i = 4; i >= 1; i--) {
            const price = (currentPrice + i * 0.15).toFixed(2);
            const size = Math.floor(Math.random() * 800 + 100);
            asksHtml += `
                <div class="ob-row ask">
                    <span class="ob-price ask">₹${price}</span>
                    <span class="ob-size">${size}</span>
                </div>
            `;
        }
        obAsks.innerHTML = asksHtml;

        // Generate 4 levels of bids (descending order)
        let bidsHtml = "";
        for (let i = 1; i <= 4; i++) {
            const price = (currentPrice - i * 0.15).toFixed(2);
            const size = Math.floor(Math.random() * 800 + 100);
            bidsHtml += `
                <div class="ob-row bid">
                    <span class="ob-price bid">₹${price}</span>
                    <span class="ob-size">${size}</span>
                </div>
            `;
        }
        obBids.innerHTML = bidsHtml;

        // Spread calculation
        const spreadAmt = 0.30;
        const spreadPercent = ((spreadAmt / currentPrice) * 100).toFixed(3);
        obSpread.textContent = `Spread: ₹${spreadAmt.toFixed(2)} (${spreadPercent}%)`;
    };

    // Initial fill for order book
    updateOrderBook();
    setInterval(updateOrderBook, 1500);

    // Simulated execution ledger
    const addSimulatedOrderFill = () => {
        if (!liveLedgerFeed) return;

        const symbol = tickerSelect.value || "RELIANCE.NS";
        const base = getBasePrice();
        const price = (base + (Math.random() - 0.5) * 2).toFixed(2);
        const shares = Math.floor(Math.random() * 15 + 1) * 10;
        const action = Math.random() > 0.55 ? "BUY" : "SELL";
        const fillType = Math.random() > 0.3 ? "Limit Fill" : "Market Fill";
        const itemClass = action === "BUY" ? "buy-item" : "sell-item";
        
        const now = new Date();
        const timeStr = `[${now.toTimeString().split(' ')[0]}]`;

        const row = document.createElement("div");
        row.className = `ledger-item ${itemClass} fade-in`;
        row.innerHTML = `
            <span class="time">${timeStr}</span>
            <span class="action ${action.toLowerCase()}">${action}</span>
            ${shares} ${symbol.split('.')[0]} @ ₹${price}
            <span class="tag">${fillType}</span>
        `;

        liveLedgerFeed.insertBefore(row, liveLedgerFeed.firstChild);

        // Keep maximum 6 items
        while (liveLedgerFeed.children.length > 6) {
            liveLedgerFeed.lastChild.remove();
        }
    };

    // Populate initial ledger fills
    for (let i = 0; i < 4; i++) addSimulatedOrderFill();
    setInterval(addSimulatedOrderFill, 4500);

    // Simulated News Ticker
    const newsTemplates = [
        { text: "NSE Nifty-50 gains positive momentum after inflation data prints below central bank projections.", tag: "bullish" },
        { text: "Reliance Industries reports strong crude imports, retail expansion plans spark massive volume.", tag: "bullish" },
        { text: "Global tech sector correction triggers foreign portfolio investors to pare holdings in Indian IT heavyweights.", tag: "bearish" },
        { text: "TCS secure large-scale banking contract with European financial consortium.", tag: "bullish" },
        { text: "HDFC Bank deposit growth exceeds estimates in quarterly audit report.", tag: "bullish" },
        { text: "Crude oil inventory climbs globally, putting pressure on petrochemical raw material costs.", tag: "bearish" },
        { text: "US Federal Reserve signals benchmark rate pause, emerging market currencies show volatility.", tag: "macro" },
        { text: "Monsoon forecasts point to normal rainfall, easing agricultural commodity inflation pressure.", tag: "bullish" }
    ];

    const addSimulatedNews = () => {
        if (!newsTicker) return;

        const template = newsTemplates[Math.floor(Math.random() * newsTemplates.length)];
        const row = document.createElement("div");
        row.className = "news-item fade-in";
        row.innerHTML = `
            <span class="tag ${template.tag}">${template.tag}</span>
            ${template.text}
        `;

        newsTicker.insertBefore(row, newsTicker.firstChild);

        // Keep maximum 4 items
        while (newsTicker.children.length > 4) {
            newsTicker.lastChild.remove();
        }
    };

    // Populate initial news items
    for (let i = 0; i < 3; i++) addSimulatedNews();
    setInterval(addSimulatedNews, 12000);


    // ==========================================================================
    // 8. FLOATING AI QUANT TUTOR CHATBOT ENGINE (Q&A Parse Rules)
    // ==========================================================================
    const aiTutorWidget = document.getElementById("ai-tutor-widget");
    const chatHeader = document.getElementById("chat-header");
    const btnToggleChat = document.getElementById("btn-toggle-chat");
    const btnMaximizeChat = document.getElementById("btn-maximize-chat");
    const btnVoiceChat = document.getElementById("btn-voice-chat");
    const pasteZone = document.getElementById("paste-zone");
    const pastePreviewContainer = document.getElementById("paste-preview-container");
    const pastePreviewImg = document.getElementById("paste-preview-img");
    const btnClearPreview = document.getElementById("btn-clear-preview");
    const chatMessages = document.getElementById("chat-messages");
    const chatInput = document.getElementById("chat-input");
    const btnSendChat = document.getElementById("btn-send-chat");
    const chatFileInput = document.getElementById("chat-file-input");

    // Toggle Chat visibility
    const toggleChat = () => {
        aiTutorWidget.classList.toggle("minimized");
        const icon = btnToggleChat.querySelector("i");
        if (aiTutorWidget.classList.contains("minimized")) {
            icon.className = "fa-solid fa-chevron-up";
            aiTutorWidget.classList.remove("immersive");
            const maxIcon = btnMaximizeChat.querySelector("i");
            if (maxIcon) maxIcon.className = "fa-solid fa-expand";
        } else {
            icon.className = "fa-solid fa-chevron-down";
            // Scroll messages
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    };
    chatHeader.addEventListener("click", toggleChat);
    btnToggleChat.addEventListener("click", (e) => {
        e.stopPropagation(); // prevent header click duplicate firing
        toggleChat();
    });

    // Maximize/Immersive Chat workspace toggle
    const toggleImmersive = (e) => {
        e.stopPropagation();
        if (aiTutorWidget.classList.contains("minimized")) {
            aiTutorWidget.classList.remove("minimized");
            const icon = btnToggleChat.querySelector("i");
            if (icon) icon.className = "fa-solid fa-chevron-down";
        }
        aiTutorWidget.classList.toggle("immersive");
        const maxIcon = btnMaximizeChat.querySelector("i");
        if (maxIcon) {
            if (aiTutorWidget.classList.contains("immersive")) {
                maxIcon.className = "fa-solid fa-compress";
            } else {
                maxIcon.className = "fa-solid fa-expand";
            }
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    btnMaximizeChat.addEventListener("click", toggleImmersive);

    // Speech Recognition (Voice Transcriber)
    let recognition = null;
    let isRecording = false;

    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onstart = () => {
            isRecording = true;
            btnVoiceChat.classList.add("recording");
            btnVoiceChat.querySelector("i").className = "fa-solid fa-microphone-lines animate-pulse";
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            chatInput.value = (chatInput.value + " " + transcript).trim();
        };

        recognition.onerror = (e) => {
            console.error("Speech recognition error", e);
            stopRecording();
        };

        recognition.onend = () => {
            stopRecording();
        };
    }

    const stopRecording = () => {
        isRecording = false;
        btnVoiceChat.classList.remove("recording");
        btnVoiceChat.querySelector("i").className = "fa-solid fa-microphone";
        if (recognition) recognition.stop();
    };

    const startRecording = () => {
        if (!recognition) {
            alert("Voice transcription is not supported in this browser. Please use Chrome, Safari or Brave.");
            return;
        }
        try {
            recognition.start();
        } catch (e) {
            console.error(e);
        }
    };

    btnVoiceChat.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    // Send chat message
    const sendChatMessage = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        appendMessage("user", text);
        chatInput.value = "";

        // Show typing indicator
        appendMessage("tutor", `<i class="fa-solid fa-spinner fa-spin"></i> Thinking...`);

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: text })
            });
            const data = await res.json();
            
            // Remove typing indicator
            const msgList = chatMessages.querySelectorAll(".message");
            if (msgList.length > 0) {
                msgList[msgList.length - 1].remove();
            }

            // Convert newlines to breaks or markdown
            const formattedAnswer = data.answer.replace(/\n/g, "<br>");
            appendMessage("tutor", formattedAnswer);
        } catch (err) {
            console.error(err);
            const msgList = chatMessages.querySelectorAll(".message");
            if (msgList.length > 0) {
                msgList[msgList.length - 1].remove();
            }
            
            // Fallback to local response if backend fails
            const tutorResponse = getTutorResponse(text);
            appendMessage("tutor", tutorResponse);
        }
    };

    btnSendChat.addEventListener("click", sendChatMessage);
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendChatMessage();
    });

    // Share visual chart uploads from file, drag & drop, or clipboard paste
    const handleVisualChartUpload = async (file) => {
        if (!file) return;

        // Auto-expand visual workspace
        if (aiTutorWidget.classList.contains("minimized")) {
            toggleChat();
        }
        aiTutorWidget.classList.add("immersive");
        const maxIcon = btnMaximizeChat.querySelector("i");
        if (maxIcon) maxIcon.className = "fa-solid fa-compress";

        // Render preview image
        const previewReader = new FileReader();
        previewReader.onload = () => {
            pastePreviewImg.src = previewReader.result;
            pastePreviewContainer.classList.remove("hidden");
        };
        previewReader.readAsDataURL(file);

        appendMessage("user", `📷 Sent image: <strong>${escapeHtml(file.name || "Clipboard Screenshot")}</strong>`);
        
        // Show loader message
        appendMessage("tutor", `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing chart details...`);

        const reader = new FileReader();
        reader.onload = async () => {
            const base64Data = reader.result;
            try {
                const res = await fetch("/api/analyze-chart", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image_data: base64Data })
                });
                const data = await res.json();
                
                // Remove loader message
                const msgList = chatMessages.querySelectorAll(".message");
                if (msgList.length > 0) {
                    msgList[msgList.length - 1].remove();
                }

                if (data.status === "success") {
                    const adviceHtml = `
                        <div class="ai-visual-report" style="margin-top: 5px;">
                            <p style="color: var(--neon-cyan); font-weight: 700; margin-bottom: 6px;">
                                <i class="fa-solid fa-circle-check"></i> Analysis: ${data.asset}
                            </p>
                            <p style="margin-bottom: 8px;"><strong>Signal:</strong> <span style="color: var(--neon-red); font-weight: 700;">${data.action}</span> (${data.confidence} confidence)</p>
                            <p style="margin-bottom: 8px; color: var(--text-secondary);">${data.plain_explanation}</p>
                            <div style="background: rgba(255,255,255,0.03); border: 1px dashed rgba(255,255,255,0.1); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                                <p style="font-size: 0.78rem; font-weight: 600; text-transform: uppercase; color: var(--neon-cyan); margin-bottom: 4px;"><i class="fa-solid fa-calculator"></i> Beginner Guide (₹1,000 Wallet)</p>
                                <p style="font-size: 0.78rem; line-height: 1.35; color: var(--text-secondary);">${data.leverage_guide}</p>
                            </div>
                            <p style="font-size: 0.75rem; color: var(--neon-red); font-style: italic;"><i class="fa-solid fa-triangle-exclamation"></i> ${data.danger_warning}</p>
                        </div>
                    `;
                    appendMessage("tutor", adviceHtml);
                } else {
                    appendMessage("tutor", "Sorry, chart analysis failed. Please verify the image file is valid.");
                }
            } catch (err) {
                console.error(err);
                const msgList = chatMessages.querySelectorAll(".message");
                if (msgList.length > 0) {
                    msgList[msgList.length - 1].remove();
                }
                appendMessage("tutor", "Unable to establish connection to the AI analysis runner.");
            }
        };
        reader.readAsDataURL(file);
    };

    // File change handler
    chatFileInput.addEventListener("change", (e) => {
        handleVisualChartUpload(e.target.files[0]);
        chatFileInput.value = "";
    });

    // Paste handler for document
    document.addEventListener("paste", (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf("image") === 0) {
                const file = item.getAsFile();
                handleVisualChartUpload(file);
            }
        }
    });

    // Clear preview image button
    btnClearPreview.addEventListener("click", (e) => {
        e.stopPropagation();
        pastePreviewContainer.classList.add("hidden");
        pastePreviewImg.src = "";
    });

    // Drag and drop event handling
    pasteZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        pasteZone.classList.add("dragover");
    });
    pasteZone.addEventListener("dragleave", () => {
        pasteZone.classList.remove("dragover");
    });
    pasteZone.addEventListener("drop", (e) => {
        e.preventDefault();
        pasteZone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleVisualChartUpload(e.dataTransfer.files[0]);
        }
    });
    pasteZone.addEventListener("click", () => {
        chatFileInput.click();
    });


    function appendMessage(sender, msgText) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${sender}`;
        msgDiv.innerHTML = msgText.startsWith("<") ? msgText : `<p>${msgText}</p>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Varsity Q&A Database Router
    function getTutorResponse(query) {
        const cleanQuery = query.toLowerCase();

        if (cleanQuery.includes("intraday") || cleanQuery.includes("help") || cleanQuery.includes("trade") || cleanQuery.includes("trading")) {
            return "Yes, absolutely! I am a **fully automated, powerful Quant Advisor** built to guide your intraday trading decisions. Here is how I can directly help you:\n\n1. **Analyze Charts**: Click the paperclip icon below to attach any chart screenshot (like BTC/USDT or stocks). I will immediately scan it, tell you whether to **Buy** or **Sell**, and calculate your entry/exit targets.\n2. **Portfolio Leverage**: Tell me your capital size (e.g. ₹1,000) and target returns, and I will calculate the exact leverage settings and safety exits (Stop-Loss) to protect your money.\n3. **Optimal Parameters**: Ask me how to configure the Step 1 and Step 2 settings for your chosen asset to maximize Sharpe ratios.";
        }
        if (cleanQuery.includes("website") || cleanQuery.includes("understand") || cleanQuery.includes("explain") || cleanQuery.includes("how") || cleanQuery.includes("operate") || cleanQuery.includes("use")) {
            return "This website is an **AI Trading Laboratory** designed to train and test intelligent agents on Indian stocks. Here is how to use it in 3 steps:\n\n1. **Step 1 (Settings)**: Select an asset and transaction cost values. Transaction cost values act as a friction fee on trades.\n2. **Step 2 (Train)**: Adjust training steps and click 'Start Agent Training'. The AI runs simulations to find the best rules.\n3. **Step 3 (Test)**: Click 'Run Backtest Simulation' to see the AI's performance vs. holding the asset.\n\n*Tip: Turn on 'Learn Varsity Mode' in the header to show tips on each step, or upload a chart screenshot using the paperclip clip icon!*";
        }
        if (cleanQuery.includes("sharpe")) {
            return "The **Sharpe Ratio** (Varsity Module 9) measures risk-adjusted return. A Sharpe ratio above 1.0 means the agent earns enough return to justify the stock's volatility. In Step 1, adjusting settings affects your agent's Sharpe outcome.";
        }
        if (cleanQuery.includes("drawdown")) {
            return "**Maximum Drawdown** (Varsity Module 9) is the largest peak-to-trough drop in capital. Maintaining a low drawdown is critical for long-term survival. You can penalize drawdowns using the 'Drawdown Coeff' parameter in Step 1.";
        }
        if (cleanQuery.includes("friction") || cleanQuery.includes("brokerage") || cleanQuery.includes("slippage")) {
            return "**Market Frictions** (Varsity Module 9 & 7) include brokerage commissions and order execution slippages. If frictions are too high, the agent will learn to trade less frequently, looking only for strong entry setups.";
        }
        if (cleanQuery.includes("regime") || cleanQuery.includes("volatility")) {
            return "**Volatility Regimes** represent changing market behaviors (bull, bear, volatile, quiet). Our agent reads these states via technical indicators (standard deviation, trend flags) to adjust asset exposure dynamically.";
        }
        if (cleanQuery.includes("ppo") || cleanQuery.includes("learning") || cleanQuery.includes("reinforcement")) {
            return "**Reinforcement Learning (PPO)** (Varsity Module 10) trains the policy. The policy is rewarded for trading profits and penalized for drawdowns, iteratively updating parameters to find the best rules.";
        }
        if (cleanQuery.includes("varsity") || cleanQuery.includes("zerodha")) {
            return "Zerodha Varsity has excellent modules! For NiftyRL, the key modules are **Module 9 (Risk Management & Psychology)**, **Module 10 (Trading Systems)**, and **Module 2 (Technical Analysis)**.";
        }
        if (cleanQuery.includes("hello") || cleanQuery.includes("hi") || cleanQuery.includes("hey")) {
            return "Hello! I'm your Varsity AI Quant Tutor. Ask me about the Sharpe ratio, drawdowns, market frictions, volatility regimes, or training policies!";
        }

        return "I'm not fully sure about that term. It sounds related to **Technical Analysis** (Varsity Module 2) or **Risk Management** (Varsity Module 9). Try asking about: 'Sharpe ratio', 'Max drawdown', 'Market frictions', or 'Volatility regimes'.";
    }


    // ==========================================================================
    // 9. FIREBASE AUTH & GLASS MODAL MANAGEMENT
    // ==========================================================================
    const authModal = document.getElementById("auth-modal");
    const btnLoginTrigger = document.getElementById("btn-login-trigger");
    const btnCloseAuth = document.getElementById("btn-close-auth");
    const authForm = document.getElementById("auth-form");
    const authEmail = document.getElementById("auth-email");
    const authPassword = document.getElementById("auth-password");
    const btnAnonymous = document.getElementById("btn-anonymous");
    const userProfileDiv = document.getElementById("user-profile");
    const userDisplayNameSpan = document.getElementById("user-display-name");
    const btnLogout = document.getElementById("btn-logout");

    let currentUser = null;

    btnLoginTrigger.addEventListener("click", () => authModal.classList.remove("hidden"));
    btnCloseAuth.addEventListener("click", () => authModal.classList.add("hidden"));

    if (useFirebase && auth) {
        onAuthStateChanged(auth, (user) => {
            updateUserUI(user);
        });
    } else {
        const localUser = sessionStorage.getItem("niftyrl_mock_user");
        if (localUser) {
            updateUserUI({ email: localUser });
        }
    }

    function updateUserUI(user) {
        currentUser = user;
        if (user) {
            userDisplayNameSpan.textContent = user.email ? user.email.split("@")[0].toUpperCase() : "CREATOR";
            userProfileDiv.classList.remove("hidden");
            btnLoginTrigger.classList.add("hidden");
            authModal.classList.add("hidden");
        } else {
            userProfileDiv.classList.add("hidden");
            btnLoginTrigger.classList.remove("hidden");
        }
    }

    authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (useFirebase && auth) {
            try {
                const cred = await signInWithEmailAndPassword(auth, email, password);
                updateUserUI(cred.user);
            } catch (err) {
                if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
                    try {
                        const cred = await createUserWithEmailAndPassword(auth, email, password);
                        updateUserUI(cred.user);
                    } catch (signUpErr) {
                        alert("Sign Up Error: " + signUpErr.message);
                    }
                } else {
                    alert("Authentication Error: " + err.message);
                }
            }
        } else {
            sessionStorage.setItem("niftyrl_mock_user", email);
            updateUserUI({ email: email });
        }
    });

    btnAnonymous.addEventListener("click", async () => {
        if (useFirebase && auth) {
            try {
                const cred = await signInAnonymously(auth);
                updateUserUI(cred.user);
            } catch (err) {
                alert("Anonymous entry error: " + err.message);
            }
        } else {
            sessionStorage.setItem("niftyrl_mock_user", "anonymous@niftyrl.dev");
            updateUserUI({ email: "anonymous@niftyrl.dev" });
        }
    });

    btnLogout.addEventListener("click", async () => {
        if (useFirebase && auth) {
            await signOut(auth);
        } else {
            sessionStorage.removeItem("niftyrl_mock_user");
            updateUserUI(null);
        }
    });


    // --- Initialise Operations ---
    loadTickers();
    loadScoreboard();
});
