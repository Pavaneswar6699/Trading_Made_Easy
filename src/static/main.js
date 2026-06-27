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
    
    const statWinRate = document.getElementById("stat-win-rate");
    const statTrades = document.getElementById("stat-trades");
    const statFriction = document.getElementById("stat-friction");
    const statBenchmarkReturn = document.getElementById("stat-benchmark-return");
    
    const tradeLogBody = document.getElementById("trade-log-body");
    const scoreboardBody = document.getElementById("scoreboard-body");

    let equityChartInstance = null;
    let progressInterval = null;
    let lastBacktestResult = null; // Cache active result details

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
    // 3. stock choice api loaders
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
    // 4. TRAINING LOGIC & POLISHING
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
    // 5. SIMULATION BACKTEST ARENA
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

            lastBacktestResult = data; // Cache data for scoreboard upload

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

            // Render chart and tables
            renderChart(data);
            renderTradeTable(data.trades);
            
            // Scroll dynamically to results section
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
    // 6. SCOREBOARD / LEADERBOARD OPERATIONS
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
    // 7. FIREBASE AUTH & GLASS MODAL MANAGEMENT
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
