// ==========================================================================
// Whisk & Flow — Core Generative AI Application Engine
// ==========================================================================

import { dbSaveCreation, dbGetCreations, useFirebase, auth } from "./firebase-config.js";
import { signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // ==========================================================================
    // 1. BACKGROUND INTERACTIVE PARTICLE ENGINE
    // ==========================================================================
    const bgCanvas = document.getElementById("bg-particle-canvas");
    const bgCtx = bgCanvas.getContext("2d");
    
    let particles = [];
    const particleCount = 65;
    const mouse = { x: null, y: null, radius: 150 };

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
            this.vx = (Math.random() - 0.5) * 0.8;
            this.vy = (Math.random() - 0.5) * 0.8;
            this.size = Math.random() * 2 + 1;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;

            // Boundary collision
            if (this.x < 0 || this.x > bgCanvas.width) this.vx *= -1;
            if (this.y < 0 || this.y > bgCanvas.height) this.vy *= -1;

            // Cursor attraction/repulsion
            if (mouse.x !== null) {
                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let dist = Math.hypot(dx, dy);
                if (dist < mouse.radius) {
                    // Pull particles gently
                    let force = (mouse.radius - dist) / mouse.radius;
                    this.x += (dx / dist) * force * 1.5;
                    this.y += (dy / dist) * force * 1.5;
                }
            }
        }
        draw() {
            bgCtx.beginPath();
            bgCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            bgCtx.fillStyle = "rgba(255, 255, 255, 0.2)";
            bgCtx.fill();
        }
    }

    // Init background particles
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    function animateBackground() {
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        
        // Draw lines connecting close particles
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();

            for (let j = i + 1; j < particles.length; j++) {
                let dx = particles[i].x - particles[j].x;
                let dy = particles[i].y - particles[j].y;
                let dist = Math.hypot(dx, dy);
                if (dist < 100) {
                    bgCtx.beginPath();
                    bgCtx.moveTo(particles[i].x, particles[i].y);
                    bgCtx.lineTo(particles[j].x, particles[j].y);
                    bgCtx.strokeStyle = `rgba(0, 240, 255, ${0.1 * (1 - dist/100)})`;
                    bgCtx.lineWidth = 0.5;
                    bgCtx.stroke();
                }
            }
        }
        requestAnimationFrame(animateBackground);
    }
    animateBackground();


    // ==========================================================================
    // 2. WHISK REMIX BOARD (Drawing Canvas & Image-Pixel-Shaders)
    // ==========================================================================
    const whiskCanvas = document.getElementById("whisk-canvas");
    const wCtx = whiskCanvas.getContext("2d");
    
    let isDrawing = false;
    const brushSizeInput = document.getElementById("brush-size");
    const remixStyleSelect = document.getElementById("remix-style");
    const btnClearWhisk = document.getElementById("btn-clear-whisk");
    const btnRemix = document.getElementById("btn-remix");

    // Configure size
    function initWhiskCanvas() {
        whiskCanvas.width = whiskCanvas.parentElement.clientWidth - 48; // accounting for padding
        whiskCanvas.height = 300;
        clearWhiskCanvas();
    }

    function clearWhiskCanvas() {
        wCtx.fillStyle = "#020204";
        wCtx.fillRect(0, 0, whiskCanvas.width, whiskCanvas.height);
        
        // Draw helpful visual guidelines
        wCtx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        wCtx.lineWidth = 1;
        wCtx.strokeRect(20, 20, whiskCanvas.width - 40, whiskCanvas.height - 40);
        wCtx.font = "12px Outfit";
        wCtx.fillStyle = "rgba(255, 255, 255, 0.2)";
        wCtx.textAlign = "center";
        wCtx.fillText("DRAW SOMETHING HERE", whiskCanvas.width/2, whiskCanvas.height/2);
    }

    // Mouse painting events
    whiskCanvas.addEventListener("mousedown", (e) => {
        isDrawing = true;
        wCtx.beginPath();
        wCtx.moveTo(e.offsetX, e.offsetY);
    });

    whiskCanvas.addEventListener("mousemove", (e) => {
        if (!isDrawing) return;
        wCtx.lineTo(e.offsetX, e.offsetY);
        wCtx.strokeStyle = "#ffffff";
        wCtx.lineWidth = brushSizeInput.value;
        wCtx.lineCap = "round";
        wCtx.lineJoin = "round";
        wCtx.stroke();
    });

    whiskCanvas.addEventListener("mouseup", () => isDrawing = false);
    whiskCanvas.addEventListener("mouseleave", () => isDrawing = false);
    btnClearWhisk.addEventListener("click", clearWhiskCanvas);

    // Apply Generative Shaders
    btnRemix.addEventListener("click", () => {
        const style = remixStyleSelect.value;
        const imgData = wCtx.getImageData(0, 0, whiskCanvas.width, whiskCanvas.height);
        const data = imgData.data;

        // Visual Filter processing logic
        if (style === "cyber") {
            // Neon Cyberpunk Shader (Cyan/Purple edge highlights)
            for (let i = 0; i < data.length; i += 4) {
                let r = data[i], g = data[i+1], b = data[i+2];
                let brightness = (r + g + b) / 3;
                if (brightness > 30) {
                    // Turn strokes neon cyan & magenta
                    if (Math.random() > 0.5) {
                        data[i] = 0; data[i+1] = 240; data[i+2] = 255; // Cyan
                    } else {
                        data[i] = 189; data[i+1] = 0; data[i+2] = 255; // Purple
                    }
                } else {
                    // Convert dark background to midnight grid
                    data[i] = 5; data[i+1] = 5; data[i+2] = 18;
                }
            }
        } 
        else if (style === "pixel") {
            // Saturated Retro Pixel shader
            const size = 6;
            for (let y = 0; y < whiskCanvas.height; y += size) {
                for (let x = 0; x < whiskCanvas.width; x += size) {
                    // Get average color of block
                    let sumR = 0, sumG = 0, sumB = 0, count = 0;
                    for (let dy = 0; dy < size; dy++) {
                        for (let dx = 0; dx < size; dx++) {
                            let pxY = y + dy;
                            let pxX = x + dx;
                            if (pxX < whiskCanvas.width && pxY < whiskCanvas.height) {
                                let idx = (pxY * whiskCanvas.width + pxX) * 4;
                                sumR += data[idx]; sumG += data[idx+1]; sumB += data[idx+2];
                                count++;
                            }
                        }
                    }
                    let avgR = sumR / count;
                    let avgG = sumG / count;
                    let avgB = sumB / count;
                    let brightness = (avgR + avgG + avgB) / 3;

                    // Boost saturation and quantize
                    for (let dy = 0; dy < size; dy++) {
                        for (let dx = 0; dx < size; dx++) {
                            let pxY = y + dy;
                            let pxX = x + dx;
                            if (pxX < whiskCanvas.width && pxY < whiskCanvas.height) {
                                let idx = (pxY * whiskCanvas.width + pxX) * 4;
                                if (brightness > 40) {
                                    data[idx] = 255; data[idx+1] = avgG > avgB ? 170 : 0; data[idx+2] = avgB > avgR ? 255 : 0;
                                } else {
                                    data[idx] = 3; data[idx+1] = 3; data[idx+2] = 8;
                                }
                            }
                        }
                    }
                }
            }
        } 
        else if (style === "vapor") {
            // Dreamy Vaporwave Shader (Soft glowing gradient blends)
            for (let y = 0; y < whiskCanvas.height; y++) {
                for (let x = 0; x < whiskCanvas.width; x++) {
                    let idx = (y * whiskCanvas.width + x) * 4;
                    let r = data[idx], g = data[idx+1], b = data[idx+2];
                    let brightness = (r + g + b) / 3;
                    
                    // Create horizontal purple-to-pink gradient
                    let pct = x / whiskCanvas.width;
                    let gradR = Math.round(189 + (66 * pct));
                    let gradG = Math.round(0 + (100 * pct));
                    let gradB = Math.round(255);

                    if (brightness > 30) {
                        data[idx] = gradR; data[idx+1] = gradG; data[idx+2] = gradB;
                    } else {
                        // Scanlines on background
                        let scanline = (y % 4 === 0) ? 15 : 5;
                        data[idx] = scanline; data[idx+1] = scanline - 3; data[idx+2] = scanline + 10;
                    }
                }
            }
        } 
        else if (style === "midnight") {
            // Blue grid blueprint shader
            for (let y = 0; y < whiskCanvas.height; y++) {
                for (let x = 0; x < whiskCanvas.width; x++) {
                    let idx = (y * whiskCanvas.width + x) * 4;
                    let r = data[idx], g = data[idx+1], b = data[idx+2];
                    let brightness = (r + g + b) / 3;

                    if (brightness > 30) {
                        data[idx] = 255; data[idx+1] = 0; data[idx+2] = 85; // Neon Red strokes
                    } else {
                        // Grid lines
                        if (x % 30 === 0 || y % 30 === 0) {
                            data[idx] = 12; data[idx+1] = 30; data[idx+2] = 75;
                        } else {
                            data[idx] = 2; data[idx+1] = 5; data[idx+2] = 20;
                        }
                    }
                }
            }
        }

        wCtx.putImageData(imgData, 0, 0);
        
        // Add decorative overlay tag
        wCtx.font = "bold 9px Syncopate";
        wCtx.fillStyle = "rgba(255, 255, 255, 0.4)";
        wCtx.textAlign = "right";
        wCtx.fillText(`WHISK // SHADER_${style.toUpperCase()}`, whiskCanvas.width - 15, whiskCanvas.height - 15);
    });


    // ==========================================================================
    // 3. FLOW MOTION ENGINE (Vector path plotting & particle simulator)
    // ==========================================================================
    const flowCanvas = document.getElementById("flow-canvas");
    const fCtx = flowCanvas.getContext("2d");
    
    let pathPoints = [];
    let flowParticles = [];
    let flowAnimationActive = false;
    
    const flowParticleStyle = document.getElementById("flow-particle-style");
    const flowSpeedInput = document.getElementById("flow-speed");
    const btnClearFlow = document.getElementById("btn-clear-flow");
    const btnFlow = document.getElementById("btn-flow");

    function initFlowCanvas() {
        flowCanvas.width = flowCanvas.parentElement.clientWidth - 48;
        flowCanvas.height = 300;
        resetFlowCanvas();
    }

    function resetFlowCanvas() {
        pathPoints = [];
        flowParticles = [];
        flowAnimationActive = false;
        fCtx.fillStyle = "#020204";
        fCtx.fillRect(0, 0, flowCanvas.width, flowCanvas.height);
        
        // Grid blueprint guidelines
        fCtx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        fCtx.lineWidth = 1;
        fCtx.strokeRect(20, 20, flowCanvas.width - 40, flowCanvas.height - 40);
        fCtx.font = "12px Outfit";
        fCtx.fillStyle = "rgba(255, 255, 255, 0.2)";
        fCtx.textAlign = "center";
        fCtx.fillText("CLICK ON CANVAS TO DRAW MOTION PATHS", flowCanvas.width/2, flowCanvas.height/2);
    }

    // Add path node points on click
    flowCanvas.addEventListener("click", (e) => {
        if (flowAnimationActive) {
            resetFlowCanvas();
        }
        
        const rect = flowCanvas.getBoundingClientRect();
        const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        pathPoints.push(pt);
        
        // Redraw path
        drawFlowPath();
    });

    function drawFlowPath() {
        fCtx.fillStyle = "#020204";
        fCtx.fillRect(0, 0, flowCanvas.width, flowCanvas.height);
        
        if (pathPoints.length === 0) return;

        // Draw connecting path line
        fCtx.beginPath();
        fCtx.moveTo(pathPoints[0].x, pathPoints[0].y);
        for (let i = 1; i < pathPoints.length; i++) {
            fCtx.lineTo(pathPoints[i].x, pathPoints[i].y);
        }
        fCtx.strokeStyle = "rgba(189, 0, 255, 0.4)";
        fCtx.lineWidth = 2.5;
        fCtx.stroke();

        // Draw nodes
        pathPoints.forEach((pt, idx) => {
            fCtx.beginPath();
            fCtx.arc(pt.x, pt.y, idx === 0 ? 6 : 4, 0, Math.PI * 2);
            fCtx.fillStyle = idx === 0 ? "#00f0ff" : "#bd00ff";
            fCtx.fill();
        });
    }

    btnClearFlow.addEventListener("click", resetFlowCanvas);

    class FlowParticle {
        constructor(path) {
            this.path = path;
            this.currentSegment = 0;
            this.t = 0; // parameter along current segment [0, 1]
            this.speed = parseFloat(flowSpeedInput.value) * 0.005;
            
            // Set starting coords
            this.x = path[0].x;
            this.y = path[0].y;
            this.size = Math.random() * 5 + 3;
            
            // Style-dependent details
            this.color = "";
            const style = flowParticleStyle.value;
            if (style === "comet") {
                this.color = "rgba(0, 240, 255, 0.9)";
            } else if (style === "spark") {
                this.color = "rgba(255, 230, 0, 0.9)";
            } else if (style === "firefly") {
                this.color = "rgba(16, 185, 129, 0.8)";
            }
            this.life = 1.0;
            this.decay = Math.random() * 0.02 + 0.005;
        }

        update() {
            if (this.currentSegment >= this.path.length - 1) {
                return false; // completed path
            }

            const p0 = this.path[this.currentSegment];
            const p1 = this.path[this.currentSegment + 1];

            // Linear interpolation between path points
            this.x = p0.x + (p1.x - p0.x) * this.t;
            this.y = p0.y + (p1.y - p0.y) * this.t;

            this.t += this.speed;
            if (this.t >= 1.0) {
                this.t = 0;
                this.currentSegment++;
            }
            this.life -= this.decay;
            return true;
        }

        draw() {
            fCtx.beginPath();
            const style = flowParticleStyle.value;
            if (style === "spark") {
                // Draw jagged lightning-spark lines
                fCtx.moveTo(this.x, this.y);
                fCtx.lineTo(this.x + (Math.random() - 0.5) * 8, this.y + (Math.random() - 0.5) * 8);
                fCtx.strokeStyle = this.color;
                fCtx.lineWidth = 1.5;
                fCtx.stroke();
            } else {
                fCtx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
                fCtx.fillStyle = this.color;
                fCtx.shadowColor = this.color;
                fCtx.shadowBlur = 10;
                fCtx.fill();
                fCtx.shadowBlur = 0; // reset
            }
        }
    }

    btnFlow.addEventListener("click", () => {
        if (pathPoints.length < 2) {
            alert("Please draw a path with at least 2 control points before animating.");
            return;
        }
        flowAnimationActive = true;
        runFlowSimulationLoop();
    });

    function runFlowSimulationLoop() {
        if (!flowAnimationActive) return;

        // Semi-clear canvas to create organic motion trailing blurs
        fCtx.fillStyle = "rgba(2, 2, 4, 0.12)";
        fCtx.fillRect(0, 0, flowCanvas.width, flowCanvas.height);

        // Periodically spawn new particles at path node 0
        if (Math.random() < 0.35 && flowParticles.length < 80) {
            flowParticles.push(new FlowParticle(pathPoints));
        }

        // Draw structural background path faintly
        fCtx.beginPath();
        fCtx.moveTo(pathPoints[0].x, pathPoints[0].y);
        for (let i = 1; i < pathPoints.length; i++) {
            fCtx.lineTo(pathPoints[i].x, pathPoints[i].y);
        }
        fCtx.strokeStyle = "rgba(255, 255, 255, 0.02)";
        fCtx.lineWidth = 2;
        fCtx.stroke();

        // Update and draw live flow particles
        flowParticles = flowParticles.filter(p => {
            const active = p.update();
            if (active && p.life > 0) {
                p.draw();
                return true;
            }
            return false;
        });

        // Overlay flow label tag
        fCtx.font = "bold 9px Syncopate";
        fCtx.fillStyle = "rgba(255, 255, 255, 0.4)";
        fCtx.textAlign = "right";
        fCtx.fillText(`FLOW // EMITTER_${flowParticleStyle.value.toUpperCase()}`, flowCanvas.width - 15, flowCanvas.height - 15);

        requestAnimationFrame(runFlowSimulationLoop);
    }


    // ==========================================================================
    // 4. DATABASE & GALLERY SHOWCASE PIPELINE (Firestore / Local fallback)
    // ==========================================================================
    const galleryGrid = document.getElementById("gallery-grid");
    const inputTitle = document.getElementById("creation-title");
    const btnPublish = document.getElementById("btn-publish");

    // Fetch and populate gallery feed
    async function loadGalleryFeed() {
        galleryGrid.innerHTML = `
            <div class="gallery-placeholder">
                <i class="fa-solid fa-arrows-spin fa-spin"></i>
                <p>Syncing gallery with Firestore database...</p>
            </div>`;
            
        try {
            const items = await dbGetCreations(12);
            galleryGrid.innerHTML = "";
            
            if (items.length === 0) {
                galleryGrid.innerHTML = `
                    <div class="gallery-placeholder">
                        <i class="fa-solid fa-images"></i>
                        <p>No creations found. Be the first to publish one!</p>
                    </div>`;
                return;
            }

            items.forEach(item => {
                const card = document.createElement("div");
                card.className = "gallery-card glass-element";
                
                // Construct clean dates
                const dateStr = new Date(item.timestamp).toLocaleDateString('en-IN', {
                    hour: '2-digit', minute: '2-digit'
                });

                card.innerHTML = `
                    <div class="gallery-preview">
                        <img src="${item.preview}" alt="${item.title}">
                    </div>
                    <div class="gallery-info">
                        <h3>${escapeHtml(item.title)}</h3>
                        <span>By ${escapeHtml(item.creator)} — ${dateStr}</span>
                        <div>
                            <span class="badge-style ${item.style}">${item.style}</span>
                        </div>
                    </div>
                `;
                galleryGrid.appendChild(card);
            });
        } catch (e) {
            console.error("Gallery render failed:", e);
            galleryGrid.innerHTML = `<p class="text-center text-muted">Failed to load feed entries.</p>`;
        }
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // Publish Creation handler
    btnPublish.addEventListener("click", async () => {
        const title = inputTitle.value.trim();
        if (!title) {
            alert("Please enter a name for your masterpiece before publishing.");
            return;
        }

        // Get currently active canvas preview
        // We will combine the Whisk drawing or take a snapshot of it
        const previewUrl = whiskCanvas.toDataURL("image/png");
        const style = remixStyleSelect.value;
        
        let creatorName = "Anonymous Creator";
        if (currentUser) {
            creatorName = currentUser.email ? currentUser.email.split("@")[0] : "Logged Creator";
        }

        btnPublish.disabled = true;
        btnPublish.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading to Firebase...`;

        const creation = {
            title: title,
            style: style,
            creator: creatorName,
            preview: previewUrl
        };

        const success = await dbSaveCreation(creation);
        
        btnPublish.disabled = false;
        btnPublish.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Publish to Community Gallery`;

        if (success) {
            inputTitle.value = "";
            // Reload feed
            loadGalleryFeed();
        } else {
            alert("Failed to publish masterpiece to database. Check network console.");
        }
    });


    // ==========================================================================
    // 5. FIREBASE AUTH & MODAL SYSTEM
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

    // Show/Hide Modal
    btnLoginTrigger.addEventListener("click", () => authModal.classList.remove("hidden"));
    btnCloseAuth.addEventListener("click", () => authModal.classList.add("hidden"));
    
    // Auto-detect authentication state
    if (useFirebase && auth) {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                updateUserUI(user);
            } else {
                updateUserUI(null);
            }
        });
    } else {
        // Local sessionStorage check for mock auth
        const localUser = sessionStorage.getItem("whisk_mock_user");
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

    // Sign in email/password handler
    authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = authEmail.value.trim();
        const password = authPassword.value;

        if (useFirebase && auth) {
            try {
                // Try log in
                const cred = await signInWithEmailAndPassword(auth, email, password);
                updateUserUI(cred.user);
            } catch (err) {
                // If user doesn't exist, automatically sign them up!
                if (err.code === "auth/user-not-found") {
                    try {
                        const cred = await createUserWithEmailAndPassword(auth, email, password);
                        updateUserUI(cred.user);
                    } catch (signUpErr) {
                        alert("Sign Up Error: " + signUpErr.message);
                    }
                } else {
                    alert("Auth Error: " + err.message);
                }
            }
        } else {
            // Local storage session mock
            sessionStorage.setItem("whisk_mock_user", email);
            updateUserUI({ email: email });
        }
    });

    // Anonymous enter
    btnAnonymous.addEventListener("click", async () => {
        if (useFirebase && auth) {
            try {
                const cred = await signInAnonymously(auth);
                updateUserUI(cred.user);
            } catch (err) {
                alert("Anonymous Login Error: " + err.message);
            }
        } else {
            sessionStorage.setItem("whisk_mock_user", "anonymous@whiskflow.dev");
            updateUserUI({ email: "anonymous@whiskflow.dev" });
        }
    });

    // Logout
    btnLogout.addEventListener("click", async () => {
        if (useFirebase && auth) {
            await signOut(auth);
        } else {
            sessionStorage.removeItem("whisk_mock_user");
            updateUserUI(null);
        }
    });


    // --- Init ---
    initWhiskCanvas();
    initFlowCanvas();
    loadGalleryFeed();
    
    // Auto-adjust layout on container resizing
    window.addEventListener("resize", () => {
        // Redraw templates on size change
        whiskCanvas.width = whiskCanvas.parentElement.clientWidth - 48;
        flowCanvas.width = flowCanvas.parentElement.clientWidth - 48;
        clearWhiskCanvas();
        resetFlowCanvas();
    });
});
