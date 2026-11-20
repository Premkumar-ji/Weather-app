const http = require("http");
const fs = require("fs");
const path = require("path");

// Set your own key in OPENWEATHER_API_KEY; never use or publish someone else's key.
const API_KEY = process.env.OPENWEATHER_API_KEY;
const BASE_URL = "https://api.openweathermap.org";
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = __dirname;
const cache = new Map();

function sendJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(payload));
}

async function upstream(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
            const error = new Error(payload.message || `OpenWeather request failed (${response.status})`);
            error.status = response.status;
            error.upstream = payload;
            throw error;
        }
        return payload;
    } finally {
        clearTimeout(timer);
    }
}

async function withRetry(task, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            lastError = error;
            if (error.status === 429 || error.status >= 500) {
                if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}

async function weatherByQuery(query, units = "metric") {
    const current = await withRetry(() => upstream(`${BASE_URL}/data/2.5/weather?q=${encodeURIComponent(query)}&units=${units}&appid=${API_KEY}`));
    const lat = current.coord.lat;
    const lon = current.coord.lon;
    return combineWeather(current, lat, lon, units);
}

async function weatherByCoords(lat, lon, units = "metric") {
    const current = await withRetry(() => upstream(`${BASE_URL}/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${API_KEY}`));
    return combineWeather(current, lat, lon, units);
}

async function combineWeather(current, lat, lon, units = "metric") {
    const cacheKey = `weather:${units}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.data;

    const [forecast, air, location] = await Promise.allSettled([
        withRetry(() => upstream(`${BASE_URL}/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${API_KEY}`)),
        withRetry(() => upstream(`${BASE_URL}/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`)),
        withRetry(() => upstream(`${BASE_URL}/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${API_KEY}`))
    ]);

    const payload = {
        current,
        forecast: forecast.status === "fulfilled" ? forecast.value : null,
        air: air.status === "fulfilled" ? air.value : null,
        location: location.status === "fulfilled" && Array.isArray(location.value) ? location.value[0] || null : null,
        unsupported: {
            oneCall: "One Call 3.0 requires a separate subscription for this API key.",
            moon: "Moonrise, moonset, phase, and illumination are only available from unsupported One Call 3.0.",
            alerts: "Use an activated One Call 3.0 plan to receive government weather alerts.",
            uvMax: "UV forecast data is only available from unsupported One Call 3.0."
        },
        fetchedAt: Date.now()
    };
    cache.set(cacheKey, { time: Date.now(), data: payload });
    return payload;
}

function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const filePath = path.resolve(PUBLIC_DIR, relative);
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { message: "Forbidden" });

    fs.readFile(filePath, (error, content) => {
        if (error) return sendJson(res, 404, { message: "Not found" });
        const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
        res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
        res.end(content);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (!url.pathname.startsWith("/api/")) {
        serveStatic(req, res);
        return;
    }

    if (!API_KEY) {
        sendJson(res, 503, { message: "OPENWEATHER_API_KEY is not configured on the server." });
        return;
    }

    try {
        if (url.pathname === "/api/weather") {
            const lat = url.searchParams.get("lat");
            const lon = url.searchParams.get("lon");
            const city = url.searchParams.get("city");
            const units = url.searchParams.get("units") === "imperial" ? "imperial" : "metric";
            let payload;
            if (lat !== null && lon !== null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
                payload = await weatherByCoords(Number(lat), Number(lon), units);
            } else if (city) {
                payload = await weatherByQuery(city, units);
            } else {
                sendJson(res, 400, { message: "Provide a city or latitude and longitude." });
                return;
            }
            sendJson(res, 200, payload);
            return;
        }

        if (url.pathname === "/api/geocode") {
            const query = url.searchParams.get("q");
            if (!query || query.trim().length < 2) {
                sendJson(res, 200, []);
                return;
            }
            const data = await withRetry(() => upstream(`${BASE_URL}/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${API_KEY}`));
            sendJson(res, 200, data);
            return;
        }

        sendJson(res, 404, { message: "Not found" });
    } catch (error) {
        const status = error.status >= 400 && error.status < 600 ? error.status : 502;
        sendJson(res, status, { message: error.message || "Weather service unavailable." });
    }
});

server.listen(PORT, () => console.log(`Weather platform running at http://localhost:${PORT}`));
