// ==========================================================================
// Whisk & Flow — Firebase Connection and DB Mock Failover
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// --- Firebase Project Configuration ---
// If you have a Firebase project, replace the placeholder strings below.
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

// Check if credentials are set (not placeholders)
if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PLACEHOLDER")) {
    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        useFirebase = true;
        console.log("🔥 Firebase initialized successfully.");
    } catch (err) {
        console.warn("⚠️ Firebase failed to initialize. Falling back to local storage:", err);
    }
} else {
    console.log("ℹ️ Operating in Local Mock Mode (no custom Firebase configuration found).");
}

export { db, auth, useFirebase };

// ==========================================================================
//  Database Operations Interface (Firestore vs LocalStorage)
// ==========================================================================

/**
 * Save a newly remixed visual asset to the database
 */
export async function dbSaveCreation(creation) {
    if (useFirebase && db) {
        try {
            await addDoc(collection(db, "creations"), {
                ...creation,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (e) {
            console.error("Firebase write error:", e);
        }
    }
    
    // LocalStorage Mock
    try {
        const creations = JSON.parse(localStorage.getItem("whisk_flow_creations") || "[]");
        creations.unshift({
            ...creation,
            id: "local_" + Date.now(),
            timestamp: new Date().toISOString()
        });
        localStorage.setItem("whisk_flow_creations", JSON.stringify(creations));
        return true;
    } catch (e) {
        console.error("LocalStorage mock write failed:", e);
        return false;
    }
}

/**
 * Retrieve the latest creations list
 */
export async function dbGetCreations(limitCount = 12) {
    if (useFirebase && db) {
        try {
            const q = query(collection(db, "creations"), orderBy("timestamp", "desc"), limit(limitCount));
            const querySnapshot = await getDocs(q);
            const items = [];
            querySnapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            return items;
        } catch (e) {
            console.error("Firebase query failed:", e);
        }
    }
    
    // LocalStorage Mock
    try {
        let creations = JSON.parse(localStorage.getItem("whisk_flow_creations") || "[]");
        
        // Populate defaults if local db is empty
        if (creations.length === 0) {
            creations = generateMockCreations();
            localStorage.setItem("whisk_flow_creations", JSON.stringify(creations));
        }
        
        return creations.slice(0, limitCount);
    } catch (e) {
        return [];
    }
}

/**
 * Generate initial visual entries for the mockup feed
 */
function generateMockCreations() {
    return [
        {
            id: "mock_1",
            title: "Neon Hyperkinetic Swarm",
            style: "cyber",
            creator: "GridRunner",
            preview: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='180' style='background:%2305050e'><circle cx='150' cy='90' r='50' fill='none' stroke='%2300f0ff' stroke-width='2' stroke-dasharray='10,5'/><path d='M10 90 Q 75 10, 150 90 T 290 90' fill='none' stroke='%23bd00ff' stroke-width='2'/><circle cx='150' cy='90' r='5' fill='%23ffaa00'/></svg>",
            timestamp: new Date(Date.now() - 3600000).toISOString()
        },
        {
            id: "mock_2",
            title: "Dreamy Vaporwave Flowline",
            style: "vapor",
            creator: "AestheticDreamer",
            preview: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='180' style='background:%2305050e'><rect x='50' y='40' width='200' height='100' fill='none' stroke='%23bd00ff' stroke-width='2'/><path d='M50 140 Q 150 40, 250 140' fill='none' stroke='%2300f0ff' stroke-width='3'/></svg>",
            timestamp: new Date(Date.now() - 7200000).toISOString()
        },
        {
            id: "mock_3",
            title: "Cybernetic Blueprint Node",
            style: "midnight",
            creator: "DraftArchitect",
            preview: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='180' style='background:%2305050e'><line x1='30' y1='30' x2='270' y2='150' stroke='rgba(255,255,255,0.08)'/><line x1='30' y1='150' x2='270' y2='30' stroke='rgba(255,255,255,0.08)'/><rect x='90' y='50' width='120' height='80' fill='none' stroke='%23ff0055' stroke-width='2'/></svg>",
            timestamp: new Date(Date.now() - 14400000).toISOString()
        }
    ];
}
