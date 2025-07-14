const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));

// --- CONFIGURATION ---
const REAL_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SECRET_HEADER = process.env.SECRET_HEADER_KEY;
const jobRateLimiter = new Map();


const secureEndpoint = (req, res, next) => {
    if (req.header('x-secret-header') !== SECRET_HEADER) {
        return res.status(401).send('Unauthorized');
    }

    const { jobId } = req.body;
    if (!jobId) {
        return res.status(400).send('Bad Request: Missing JobId.');
    }

    const currentTime = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 10;
    
    if (!jobRateLimiter.has(jobId)) {
        jobRateLimiter.set(jobId, { count: 1, timestamp: currentTime });
    } else {
        const jobData = jobRateLimiter.get(jobId);
        if (currentTime - jobData.timestamp > windowMs) {
            jobData.count = 1;
            jobData.timestamp = currentTime;
        } else {
            jobData.count++;
        }
    }

    if (jobRateLimiter.get(jobId).count > maxRequests) {
        console.log(`Rate limit exceeded for JobId: ${jobId}`);
        return res.status(429).send('Too Many Requests');
    }
    
    next();
};

// --- ENDPOINTS ---
app.post('/', secureEndpoint, async (req, res) => {
    const { payload } = req.body;
    try {
        console.log("--> PROXY IS SENDING THIS PAYLOAD TO DISCORD:", JSON.stringify(payload, null, 2));
        const response = await fetch(REAL_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
                     'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.0'
                     },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Discord API Error: ${response.status}`);
        const responseData = await response.json();
        res.status(200).json({ messageId: responseData.id });
    } catch (error) {
        console.error("Error creating webhook:", error);
        res.status(500).send('Error creating webhook.');
    }
});

app.patch('/edit', secureEndpoint, async (req, res) => {
    const { messageId, payload } = req.body;
    if (!messageId) {
        return res.status(400).send('Bad Request: Missing messageId.');
    }
    const editUrl = `${REAL_WEBHOOK_URL}/messages/${messageId}`;
    try {
        console.log("--> PROXY IS EDITING WITH THIS PAYLOAD:", JSON.stringify(payload, null, 2));
        const response = await fetch(editUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json',
                     'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.0'
                     },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Discord API Error: ${response.status}`);
        res.status(200).send('OK');
    } catch (error) {
        console.error("Error editing webhook:", error);
        res.status(500).send('Error editing webhook.');
    }
});

setInterval(() => {
    const currentTime = Date.now();
    for (const [jobId, jobData] of jobRateLimiter.entries()) {
        if (currentTime - (jobData.timestamp || 0) > 60 * 1000) {
            jobRateLimiter.delete(jobId);
        }
    }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Live webhook proxy is running on port ${PORT}`));
