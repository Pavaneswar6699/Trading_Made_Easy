// ==========================================================================
// NiftyRL Trading Studio — Firebase Connections & Scoreboard Database
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- Firebase Configuration Keys ---
// Customize with your own Firebase keys for cloud synchronisation.
const firebaseConfig = {
    apiKey: "PLACEHOLDER_API_KEY",
    authDomain: "PLACEHOLDER_AUTH_DOMAIN",
    projectId: "PLACEHOLDER_PROJECT_ID",
    storageBucket: "PLACEHOLDER_STORAGE_BUCKET",
    messagingSenderId: "PLACEHOLDER_MESSAGING_SENDER_ID",
    appId: "PLACEHOLDER_APP_ID"
};

let db = null;
let auth = null;
let useFirebase = false;

if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PLACEHOLDER")) {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        useFirebase = true;
        console.log("🔥 Firebase initialized on Trading Studio.");
    } catch (err) {
        console.warn("⚠️ Firebase failed. Using local mockup fallback:", err);
    }
} else {
    console.log("ℹ️ Operating in Local Mock Mode (no custom Firebase configuration found).");
}

export { db, auth, useFirebase };

// ==========================================================================
//  Leaderboard Operations Interface
// ==========================================================================

/**
 * Save a backtest performance score to the database
 */
export async function dbSaveScore(scoreData) {
    if (useFirebase && db) {
        try {
            await addDoc(collection(db, "leaderboard"), {
                ...scoreData,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (e) {
            console.error("Firebase save score error:", e);
        }
    }

    // LocalStorage Mock
    try {
        const scores = JSON.parse(localStorage.getItem("niftyrl_scores") || "[]");
        scores.push({
            ...scoreData,
            id: "score_" + Date.now(),
            timestamp: new Date().toISOString()
        });
        // Sort by return percentage descending
        scores.sort((a, b) => b.total_return_pct - a.total_return_pct);
        localStorage.setItem("niftyrl_scores", JSON.stringify(scores));
        return true;
    } catch (e) {
        console.error("LocalStorage save score failed:", e);
        return false;
    }
}

/**
 * Fetch top backtest scores
 */
export async function dbGetScores(limitCount = 10) {
    if (useFirebase && db) {
        try {
            const q = query(collection(db, "leaderboard"), orderBy("total_return_pct", "desc"), limit(limitCount));
            const querySnapshot = await getDocs(q);
            const items = [];
            querySnapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            return items;
        } catch (e) {
            console.error("Firebase fetch scores failed:", e);
        }
    }

    // LocalStorage Mock
    try {
        let scores = JSON.parse(localStorage.getItem("niftyrl_scores") || "[]");
        if (scores.length === 0) {
            scores = generateMockScores();
            localStorage.setItem("niftyrl_scores", JSON.stringify(scores));
        }
        return scores.slice(0, limitCount);
    } catch (e) {
        return [];
    }
}

/**
 * Seed initial mockup leaderboard entries
 */
function generateMockScores() {
    return [
        {
            ticker: "RELIANCE.NS",
            creator: "AlphaQuant",
            total_return_pct: 22.84,
            sharpe_ratio: 1.8492,
            max_drawdown_pct: 4.85,
            total_friction: 1205.40,
            timestamp: new Date(Date.now() - 3600000).toISOString()
        },
        {
            ticker: "TCS.NS",
            creator: "HedgeByte",
            total_return_pct: 18.15,
            sharpe_ratio: 1.5421,
            max_drawdown_pct: 5.12,
            total_friction: 840.10,
            timestamp: new Date(Date.now() - 7200000).toISOString()
        },
        {
            ticker: "INFY.NS",
            creator: "RiskAverse",
            total_return_pct: 12.05,
            sharpe_ratio: 1.2840,
            max_drawdown_pct: 3.42,
            total_friction: 512.60,
            timestamp: new Date(Date.now() - 14400000).toISOString()
        }
    ];
}
