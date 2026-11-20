# Atmos Weather

A dependency-light, responsive weather platform built on OpenWeather's 2.5 APIs.

## Run locally

Requirements: Node.js 20.6 or newer.

1. Copy `.env.example` to `.env`.
2. Set `OPENWEATHER_API_KEY` to an OpenWeather API key with access to Current Weather, 5-day Forecast, Geocoding, and Air Pollution.
3. Run `npm start`.
4. Open `http://localhost:4173`.

The API key is kept on the Node server and never sent to browser source code.

## API capability audit

| Capability | Supported by existing free key | App behavior |
|---|---|---|
| Current temperature, feels-like, min/max, humidity | Yes | Implemented |
| 5-day/3-hour forecast | Yes | Implemented; 24-hour view shows 8 supported points |
| Daily 5-day summary | Derived from 3-hour forecast | Implemented |
| Air quality and pollutant concentrations | Yes | Implemented |
| Geocoding and autocomplete | Yes | Implemented |
| Sunrise and sunset | Yes | Implemented |
| Daylight duration | Derived locally | Implemented |
| Visibility, pressure, clouds, wind, gust, direction | Yes | Implemented where returned |
| Hourly rain/snow amounts | Yes where returned | Implemented |
| Precipitation probability | Yes | Implemented |
| Air pollution forecast | Yes | API available; current view implemented |
| UV index | Not by the 2.5 current/forecast endpoints | Hidden |
| Weather alerts | No on this key tier | Hidden; One Call 3.0 required |
| Moonrise, moonset, moon phase, illumination | No on this key tier | Clearly marked unavailable |
| One Call 48-hour hourly and 8-day daily data | No: One Call 3.0 returned 401 | Uses supported 2.5 endpoints |

## Architecture

- `server.js`: server-side API proxy, retries, timeout, 10-minute response cache, and static server.
- `index.js`: centralized weather state, data validation, rendering, local cache, units, favorites, recent locations, geolocation, and search.
- `index.css`: responsive design system and weather themes.
- `sw.js`: static offline shell caching. Live weather remains unavailable without network or cache.

## Security

The API key previously appeared directly in `index.js` and repository history. Rotate that key in the OpenWeather dashboard and replace `.env` with the new value. `.env` is excluded by `.gitignore`.
