const state = {
    units: localStorage.getItem("atmos.units") || "metric",
    timeFormat: localStorage.getItem("atmos.timeFormat") || "24",
    theme: localStorage.getItem("atmos.theme") || "system",
    weather: null,
    location: null,
    controller: null,
    searchController: null,
    searchTimer: null,
    requestId: 0,
};

const $ = (selector) => document.querySelector(selector);
const hasValue = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const OPENWEATHER_API = "https://api.openweathermap.org";
const OPENWEATHER_API_KEY = "60a0c7e584eb6742cdd95cb487fa6226";

function iconUrl(icon) {
    return icon ? `https://openweathermap.org/img/wn/${icon}@4x.png` : "";
}

function temperature(value) {
    if (!hasValue(value)) return null;
    return `${Math.round(value)}°${state.units === "imperial" ? "F" : "C"}`;
}

function wind(value) {
    if (!hasValue(value)) return null;
    return `${Math.round(value * 10) / 10} ${state.units === "imperial" ? "mph" : "m/s"}`;
}

function windDirection(degrees) {
    if (!hasValue(degrees)) return null;
    const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return `${names[Math.round(degrees / 45) % 8]} (${Math.round(degrees)}°)`;
}

function formatTime(unix, timezoneOffset = 0) {
    if (!hasValue(unix)) return null;
    const date = new Date((unix + timezoneOffset) * 1000);
    const options = { hour: "2-digit", minute: "2-digit", hour12: state.timeFormat === "12", timeZone: "UTC" };
    return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatDate(unix, timezoneOffset = 0, options = {}) {
    if (!hasValue(unix)) return null;
    const date = new Date((unix + timezoneOffset) * 1000);
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...options }).format(date);
}

function elapsedLabel(unix) {
    if (!hasValue(unix)) return "Updated unavailable";
    const minutes = Math.max(0, Math.round((Date.now() / 1000 - unix) / 60));
    return minutes < 1 ? "Updated now" : `Updated ${minutes} min ago`;
}

function setStatus(message, type = "") {
    const banner = $("#statusBanner");
    banner.textContent = message;
    banner.className = `status-banner ${type}`.trim();
    banner.hidden = !message;
}

function cacheKey(location) {
    return `atmos.weather.${location.lat.toFixed(3)}.${location.lon.toFixed(3)}.${state.units}`;
}

function saveResponse(location, payload) {
    try { localStorage.setItem(cacheKey(location), JSON.stringify(payload)); } catch (_) {}
}

function readCached(location) {
    try {
        const value = localStorage.getItem(cacheKey(location));
        return value ? JSON.parse(value) : null;
    } catch (_) { return null; }
}

function openWeatherError(status, message = "") {
    if (status === 401) return "OpenWeather rejected this API key. Check the key in Settings; a new key may take time to activate.";
    if (status === 403) return "This OpenWeather service is not enabled for this API key.";
    if (status === 404) return "That location was not found. Check the city name and try again.";
    if (status === 429) return "OpenWeather's rate limit was reached. Wait a moment, then try again.";
    if (status >= 500) return "OpenWeather is temporarily unavailable. Try again shortly.";
    return message || `OpenWeather request failed (${status}).`;
}

async function fetchOpenWeather(path, params, signal) {
    if (!OPENWEATHER_API_KEY.trim()) throw new Error("The shared OpenWeather API key is not configured in index.js.");
    const url = new URL(`${OPENWEATHER_API}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("appid", OPENWEATHER_API_KEY.trim());

    let response;
    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error("Could not reach OpenWeather. Check your internet connection and try again.");
    }

    let payload;
    try {
        payload = await response.json();
    } catch (_) {
        throw new Error("OpenWeather returned an invalid response. Please try again later.");
    }
    if (!response.ok) throw new Error(openWeatherError(response.status, payload?.message));
    return payload;
}

async function fetchWeather(params, signal) {
    const locationParams = params.city
        ? { q: params.city }
        : { lat: params.lat, lon: params.lon };
    const current = await fetchOpenWeather("/data/2.5/weather", { ...locationParams, units: state.units }, signal);
    const lat = current.coord?.lat;
    const lon = current.coord?.lon;
    if (!hasValue(lat) || !hasValue(lon) || !current.main) {
        throw new Error("OpenWeather returned incomplete current conditions for this location.");
    }

    const results = await Promise.allSettled([
        fetchOpenWeather("/data/2.5/forecast", { lat, lon, units: state.units }, signal),
        fetchOpenWeather("/data/2.5/air_pollution", { lat, lon }, signal),
        fetchOpenWeather("/geo/1.0/reverse", { lat, lon, limit: 1 }, signal)
    ]);
    const failed = [];
    if (results[0].status === "rejected") failed.push("forecast");
    if (results[1].status === "rejected") failed.push("air quality");

    return {
        current,
        forecast: results[0].status === "fulfilled" ? results[0].value : null,
        air: results[1].status === "fulfilled" ? results[1].value : null,
        location: results[2].status === "fulfilled" && Array.isArray(results[2].value)
            ? results[2].value[0] || null
            : null,
        partialFailure: failed.length ? `Current weather loaded, but ${failed.join(" and ")} data is unavailable.` : ""
    };
}

async function loadWeather(params, label = "") {
    if (!OPENWEATHER_API_KEY.trim()) {
        state.requestId += 1;
        if (state.controller) state.controller.abort();
        state.controller = null;
        setStatus("The shared OpenWeather API key is not configured in index.js.", "error");
        return;
    }
    const requestId = ++state.requestId;
    setStatus(label ? `Loading ${label}…` : "Loading latest weather…");

    const tentative = params.lat !== undefined
        ? { lat: Number(params.lat), lon: Number(params.lon), name: label || "Saved location" }
        : null;

    if (tentative) {
        const cached = readCached(tentative);
        if (cached) renderWeather(cached, { cached: true });
    }

    try {
        if (state.controller) state.controller.abort();
        const controller = new AbortController();
        state.controller = controller;
        const timeout = setTimeout(() => controller.abort(), 20000);
        let payload;
        try {
            payload = await fetchWeather(params, controller.signal);
        } finally {
            clearTimeout(timeout);
            if (state.controller === controller) state.controller = null;
        }
        if (requestId !== state.requestId) return;
        const current = payload.current;
        const location = payload.location;
        state.location = {
            lat: current.coord.lat,
            lon: current.coord.lon,
            name: location?.name || current.name || label || "Selected location",
            country: location?.country || current.sys?.country || ""
        };
        saveResponse(state.location, payload);
        addRecent(state.location);
        renderWeather(payload);
        setStatus(payload.partialFailure, payload.partialFailure ? "error" : "");
    } catch (error) {
        if (requestId !== state.requestId) return;
        if (error.name === "AbortError") {
            setStatus("The weather request was cancelled or timed out. Showing saved data where available.", "error");
        } else {
            setStatus(error.message, "error");
        }
    }
}

function renderWeather(payload, options = {}) {
    state.weather = payload;
    const current = payload.current;
    if (!current || !current.main) {
        setStatus("The weather response did not contain valid current conditions.", "error");
        return;
    }

    const timezone = current.timezone || 0;
    const location = state.location || {
        lat: current.coord?.lat,
        lon: current.coord?.lon,
        name: payload.location?.name || current.name || "Selected location",
        country: payload.location?.country || current.sys?.country || ""
    };
    state.location = location;

    $("#locationName").textContent = `${location.name}${location.country ? `, ${location.country}` : ""}`;
    $("#currentDate").textContent = formatDate(current.dt, timezone, { weekday: "long", month: "long", day: "numeric" }) || "Local weather";
    $("#temperature").textContent = temperature(current.main.temp) || "Unavailable";
    $("#unitButton").textContent = state.units === "imperial" ? "°F" : "°C";

    const weather = current.weather?.[0];
    $("#condition").textContent = weather?.main || "Unavailable";
    $("#description").textContent = weather?.description || "Weather description unavailable";
    const icon = $("#weatherIcon");
    if (weather?.icon) {
        icon.src = iconUrl(weather.icon);
        icon.alt = weather.description || weather.main;
    } else {
        icon.removeAttribute("src");
        icon.alt = "";
    }

    $("#updateTime").textContent = options.cached ? "Saved result" : elapsedLabel(current.dt);

    const daylight = current.sys?.sunrise && current.sys?.sunset
        ? formatDaylight(current.dt, current.sys.sunrise, current.sys.sunset)
        : null;
    $("#sunrise").textContent = formatTime(current.sys?.sunrise, timezone) || "Unavailable";
    $("#sunset").textContent = formatTime(current.sys?.sunset, timezone) || "Unavailable";
    $("#sunProgress").style.width = `${daylight?.progress ?? 0}%`;

    applyWeatherTheme(weather?.id, weather?.icon);
    renderMetrics(current, timezone);
    renderForecast(payload);
    renderAir(payload.air);
    renderAstronomy(current, timezone);
    renderAlerts(payload.current, timezone);
    updateFavoriteButton();
}

function formatDaylight(now, sunrise, sunset) {
    const total = sunset - sunrise;
    const progress = total > 0 ? Math.min(100, Math.max(0, ((now - sunrise) / total) * 100)) : 0;
    const duration = total > 0 ? total / 3600 : null;
    return { progress, duration };
}

function renderMetrics(current, timezone) {
    const metrics = [
        ["Feels like", temperature(current.main.feels_like)],
        ["Humidity", hasValue(current.main.humidity) ? `${Math.round(current.main.humidity)}%` : null],
        ["Wind", wind(current.wind?.speed)],
        ["Pressure", hasValue(current.main.pressure) ? `${Math.round(current.main.pressure)} hPa` : null],
        ["Visibility", hasValue(current.visibility) ? `${(current.visibility / 1000).toFixed(1)} km` : null],
        ["Cloud cover", hasValue(current.clouds?.all) ? `${Math.round(current.clouds.all)}%` : null],
        ["Wind gust", hasValue(current.wind?.gust) ? wind(current.wind.gust) : null],
        ["Direction", windDirection(current.wind?.deg)],
        ["Precipitation", precipitationValue(current.rain, current.snow)]
    ];

    $("#metricsGrid").replaceChildren(...metrics.map(([label, value]) => {
        const item = document.createElement("div");
        item.className = "metric";
        const name = document.createElement("span");
        name.textContent = label;
        const result = document.createElement("strong");
        result.textContent = value || "Unavailable";
        item.append(name, result);
        return item;
    }));
}

function precipitationValue(rain, snow) {
    const values = [];
    if (hasValue(rain?.["1h"])) values.push(`${rain["1h"]} mm rain`);
    if (hasValue(snow?.["1h"])) values.push(`${snow["1h"]} mm snow`);
    return values.length ? values.join(" · ") : null;
}

function renderForecast(payload) {
    const timezone = payload.current.timezone || 0;
    const list = payload.forecast?.list;
    if (!Array.isArray(list) || list.length === 0) {
        $("#hourlyList").textContent = "Forecast data unavailable.";
        $("#hourlyChart").textContent = "Forecast data unavailable.";
        $("#dailyList").textContent = "Forecast data unavailable.";
        $("#precipChart").textContent = "Forecast data unavailable.";
        $("#humidityChart").textContent = "Forecast data unavailable.";
        return;
    }

    const hourly = list.slice(0, 8);
    $("#hourlyList").replaceChildren(...hourly.map((item, index) => {
        const card = document.createElement("article");
        card.className = `hour-item${index === 0 ? " now" : ""}`;
        const time = document.createElement("time");
        time.textContent = index === 0 ? "Now" : formatTime(item.dt, timezone);
        const img = document.createElement("img");
        img.src = iconUrl(item.weather?.[0]?.icon);
        img.alt = item.weather?.[0]?.description || "";
        const temp = document.createElement("strong");
        temp.textContent = temperature(item.main.temp) || "--";
        const pop = document.createElement("small");
        pop.textContent = hasValue(item.pop) ? `${Math.round(item.pop * 100)}% rain` : "Rain unavailable";
        card.append(time, img, temp, pop);
        return card;
    }));

    renderLineChart("#hourlyChart", hourly.map(item => item.main.temp), hourly.map(item => formatTime(item.dt, timezone)), "temp");

    const groups = new Map();
    list.forEach(item => {
        const dateKey = formatDate(item.dt, timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
        if (!groups.has(dateKey)) groups.set(dateKey, []);
        groups.get(dateKey).push(item);
    });

    const days = [...groups.entries()].slice(0, 5).map(([, items]) => {
        const temps = items.map(item => item.main.temp).filter(hasValue);
        if (temps.length === 0) return null;
        const rainValues = items.map(item => item.pop).filter(hasValue);
        const weatherCounts = items.map(item => item.weather?.[0]);
        const representative = weatherCounts[Math.floor(weatherCounts.length / 2)] || weatherCounts[0];
        return {
            dt: items[0].dt,
            min: Math.min(...temps),
            max: Math.max(...temps),
            pop: rainValues.length ? Math.max(...rainValues) : null,
            rain: items.reduce((sum, item) => sum + (hasValue(item.rain?.["3h"]) ? item.rain["3h"] : 0), 0),
            weather: representative
        };
    }).filter(Boolean);

    const dayCards = days.map((day, index) => {
        const card = document.createElement("article");
        card.className = "day-card";
        const name = document.createElement("span");
        name.className = "day-name";
        name.textContent = index === 0 ? "Today" : formatDate(day.dt, timezone, { weekday: "short" });
        const date = document.createElement("span");
        date.className = "day-date";
        date.textContent = formatDate(day.dt, timezone, { month: "short", day: "numeric" });
        const img = document.createElement("img");
        img.src = iconUrl(day.weather?.icon);
        img.alt = day.weather?.description || "";
        const temps = document.createElement("div");
        temps.className = "day-temps";
        const high = document.createElement("strong");
        high.textContent = temperature(day.max);
        const low = document.createElement("span");
        low.textContent = ` / ${temperature(day.min)}`;
        temps.append(high, low);
        const detail = document.createElement("small");
        detail.textContent = hasValue(day.pop) ? `${Math.round(day.pop * 100)}% rain` : "Rain unavailable";
        card.append(name, date, img, temps, detail);
        return card;
    });
    if (dayCards.length) $("#dailyList").replaceChildren(...dayCards);
    else $("#dailyList").textContent = "Daily forecast data unavailable.";

    renderLineChart("#precipChart", list.slice(0, 16).map(item => hasValue(item.pop) ? item.pop * 100 : null), list.slice(0, 16).map(item => formatTime(item.dt, timezone)), "percent");
    renderLineChart("#humidityChart", list.slice(0, 16).map(item => item.main.humidity), list.slice(0, 16).map(item => formatTime(item.dt, timezone)), "percent");
}

function renderLineChart(selector, values, labels, mode) {
    const container = $(selector);
    const valid = values.map((value, index) => ({ value, label: labels[index] })).filter(item => hasValue(item.value));
    if (!valid.length) { container.textContent = "Chart data unavailable"; return; }

    const width = 600;
    const height = 150;
    const pad = 18;
    const nums = valid.map(item => Number(item.value));
    const min = mode === "percent" ? 0 : Math.min(...nums) - 1;
    const max = mode === "percent" ? 100 : Math.max(...nums) + 1;
    const span = max - min || 1;
    const points = valid.map((item, index) => {
        const x = pad + (index / Math.max(1, valid.length - 1)) * (width - pad * 2);
        const y = height - pad - ((Number(item.value) - min) / span) * (height - pad * 2);
        return { x, y, value: item.value, label: item.label };
    });
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const area = `${path} L${points.at(-1).x},${height - pad} L${points[0].x},${height - pad} Z`;
    const dots = points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="3.5"><title>${point.label}: ${Math.round(point.value)}${mode === "percent" ? "%" : "°"}</title></circle>`).join("");

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${selector === "#hourlyChart" ? "Temperature" : mode === "percent" ? "Percent" : "Trend"} chart">
        <path d="${area}" fill="rgba(45,107,122,.10)"></path>
        <path d="${path}" fill="none" stroke="#c99143" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        ${dots}
    </svg>`;
}

function aqiDetails(aqi) {
    const levels = {
        1: ["Good", "#70a365"],
        2: ["Fair", "#b9ad57"],
        3: ["Moderate", "#d5a54a"],
        4: ["Poor", "#c56d54"],
        5: ["Very poor", "#9d4f70"]
    };
    return levels[aqi] || ["Unavailable", "#999"];
}

function renderAir(airPayload) {
    const container = $("#airQuality");
    const entry = airPayload?.list?.[0];
    if (!entry) {
        container.innerHTML = '<p class="data-note">Air quality data is unavailable for this location.</p>';
        return;
    }
    const [label, color] = aqiDetails(entry.main?.aqi);
    const components = ["pm2_5", "pm10", "co", "no2", "so2", "o3"];
    const names = { pm2_5: "PM2.5", pm10: "PM10", co: "CO", no2: "NO2", so2: "SO2", o3: "O3" };
    container.innerHTML = `<div class="air-overview"><div class="aqi-score" style="border-color:${color}"><div><strong>${entry.main?.aqi ?? "--"}</strong><span>${label}</span></div></div><div class="aqi-components">${components.map(key => {
        const value = entry.components?.[key];
        return `<div><span>${names[key]}</span><strong>${hasValue(value) ? `${Math.round(value)} µg/m³` : "Unavailable"}</strong></div>`;
    }).join("")}</div></div>`;
}

function renderAstronomy(current, timezone) {
    const sunrise = formatTime(current.sys?.sunrise, timezone);
    const sunset = formatTime(current.sys?.sunset, timezone);
    const daylight = formatDaylight(current.dt, current.sys?.sunrise, current.sys?.sunset);
    $("#astronomy").innerHTML = `<div class="astronomy-grid">
        <div><span>Sunrise</span><strong>${sunrise || "Unavailable"}</strong></div>
        <div><span>Sunset</span><strong>${sunset || "Unavailable"}</strong></div>
        <div><span>Daylight</span><strong>${hasValue(daylight?.duration) ? `${Math.floor(daylight.duration)}h ${Math.round((daylight.duration % 1) * 60)}m` : "Unavailable"}</strong></div>
    </div>`;
}

function renderAlerts(current, timezone) {
    const panel = $("#alertsSection");
    panel.hidden = true;
    $("#alertsList").replaceChildren();
}

function applyWeatherTheme(weatherId, icon) {
    document.body.classList.remove("weather-rain", "weather-snow", "weather-night");
    if (icon?.endsWith("n") || (document.body.classList.contains("dark") && !weatherId)) document.body.classList.add("weather-night");
    if (weatherId >= 200 && weatherId < 600) document.body.classList.add("weather-rain");
    if (weatherId >= 600 && weatherId < 700) document.body.classList.add("weather-snow");
}

function getFavorites() {
    try { return JSON.parse(localStorage.getItem("atmos.favorites") || "[]"); } catch (_) { return []; }
}

function getRecent() {
    try { return JSON.parse(localStorage.getItem("atmos.recent") || "[]"); } catch (_) { return []; }
}

function addRecent(location) {
    const recent = getRecent().filter(item => item.lat.toFixed(3) !== location.lat.toFixed(3) || item.lon.toFixed(3) !== location.lon.toFixed(3));
    recent.unshift(location);
    localStorage.setItem("atmos.recent", JSON.stringify(recent.slice(0, 8)));
}

function isFavorite(location) {
    return getFavorites().some(item => item.lat.toFixed(3) === location.lat.toFixed(3) && item.lon.toFixed(3) === location.lon.toFixed(3));
}

function updateFavoriteButton() {
    const button = $("#favoriteButton");
    if (!state.location) return;
    const favorite = isFavorite(state.location);
    button.textContent = favorite ? "★" : "☆";
    button.classList.toggle("active", favorite);
}

$("#searchForm").addEventListener("submit", async event => {
    event.preventDefault();
    const query = $("#input").value.trim();
    if (query.length < 2) {
        setStatus("Enter at least two characters to search for a location.", "error");
        return;
    }
    if (state.searchController) state.searchController.abort();
    clearTimeout(state.searchTimer);
    $("#suggestions").hidden = true;
    await loadWeather({ city: query }, query);
});

$("#input").addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    if (state.searchController) state.searchController.abort();
    const query = $("#input").value.trim();
    if (query.length < 2) {
        if (state.searchController) state.searchController.abort();
        $("#suggestions").hidden = true;
        return;
    }
    if (!OPENWEATHER_API_KEY.trim()) {
        $("#suggestions").hidden = true;
        return;
    }
    state.searchTimer = setTimeout(async () => {
        if (state.searchController) state.searchController.abort();
        const controller = new AbortController();
        state.searchController = controller;
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const suggestions = await fetchOpenWeather("/geo/1.0/direct", { q: query, limit: 5 }, controller.signal);
            if (state.searchController !== controller) return;
            const box = $("#suggestions");
            box.replaceChildren();
            if (!Array.isArray(suggestions) || suggestions.length === 0) { box.hidden = true; return; }
            suggestions.forEach(item => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "suggestion";
                button.setAttribute("role", "option");
                button.textContent = `${item.name}${item.state ? `, ${item.state}` : ""}, ${item.country}`;
                button.addEventListener("click", () => {
                    $("#input").value = "";
                    box.hidden = true;
                    loadWeather({ lat: item.lat, lon: item.lon }, item.name);
                });
                box.append(button);
            });
            box.hidden = false;
        } catch (error) {
            if (error.name !== "AbortError") setStatus(error.message, "error");
            $("#suggestions").hidden = true;
        } finally {
            clearTimeout(timeout);
            if (state.searchController === controller) state.searchController = null;
        }
    }, 300);
});

$("#locateButton").addEventListener("click", () => {
    if (!navigator.geolocation) {
        setStatus("Geolocation is not supported by this browser.", "error");
        return;
    }
    setStatus("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(position => {
        loadWeather({ lat: position.coords.latitude, lon: position.coords.longitude }, "your location");
    }, error => {
        const messages = { 1: "Location permission was denied.", 2: "Your location is currently unavailable.", 3: "Location detection timed out." };
        setStatus(messages[error.code] || "Could not determine your location.", "error");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
});

$("#favoriteButton").addEventListener("click", () => {
    if (!state.location) return;
    const favorites = getFavorites();
    const index = favorites.findIndex(item => item.lat.toFixed(3) === state.location.lat.toFixed(3) && item.lon.toFixed(3) === state.location.lon.toFixed(3));
    if (index >= 0) favorites.splice(index, 1);
    else favorites.push(state.location);
    localStorage.setItem("atmos.favorites", JSON.stringify(favorites));
    updateFavoriteButton();
});

$("#shareButton").addEventListener("click", async () => {
    if (!state.weather) return;
    const current = state.weather.current;
    const text = `${state.location.name}: ${temperature(current.main.temp)}, ${current.weather?.[0]?.description || "weather unavailable"}`;
    try {
        if (navigator.share) await navigator.share({ title: "Atmos weather", text });
        else await navigator.clipboard.writeText(text);
    } catch (_) {}
});

$("#unitButton").addEventListener("click", () => {
    state.units = state.units === "metric" ? "imperial" : "metric";
    localStorage.setItem("atmos.units", state.units);
    $("#temperatureUnit").value = state.units;
    if (state.location) loadWeather({ lat: state.location.lat, lon: state.location.lon }, state.location.name);
});

function applyTheme() {
    const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.body.classList.toggle("dark", dark);
}

$("#themeButton").addEventListener("click", () => {
    state.theme = document.body.classList.contains("dark") ? "light" : "dark";
    localStorage.setItem("atmos.theme", state.theme);
    $("#themeSelect").value = state.theme;
    applyTheme();
});

$("#settingsButton").addEventListener("click", () => {
    $("#temperatureUnit").value = state.units;
    $("#timeFormat").value = state.timeFormat;
    $("#themeSelect").value = state.theme;
    $("#settingsDialog").showModal();
});

$("#saveSettings").addEventListener("click", event => {
    event.preventDefault();
    const oldUnits = state.units;
    state.units = $("#temperatureUnit").value;
    state.timeFormat = $("#timeFormat").value;
    state.theme = $("#themeSelect").value;
    localStorage.setItem("atmos.units", state.units);
    localStorage.setItem("atmos.timeFormat", state.timeFormat);
    localStorage.setItem("atmos.theme", state.theme);
    applyTheme();
    $("#settingsDialog").close();
    if (state.location && oldUnits !== state.units) loadWeather({ lat: state.location.lat, lon: state.location.lon }, state.location.name);
    else if (state.location) renderWeather(state.weather);
});

$("#temperatureUnit").value = state.units;
$("#timeFormat").value = state.timeFormat;
$("#themeSelect").value = state.theme;
applyTheme();

const lastLocation = getRecent()[0];
if (OPENWEATHER_API_KEY.trim()) {
    if (lastLocation) loadWeather({ lat: lastLocation.lat, lon: lastLocation.lon }, lastLocation.name);
    else loadWeather({ city: "London" }, "London");
} else {
    setStatus("The shared OpenWeather API key is not configured in index.js.", "error");
}

document.querySelectorAll(".nav-item[data-view]").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        const targets = { today: "#todaySection", forecast: "#forecastSection", air: "#airSection" };
        document.querySelector(targets[button.dataset.view])?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
