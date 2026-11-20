# Atmos Weather

A responsive weather app that fetches OpenWeather data directly from the browser. It is a static site and can be hosted on GitHub Pages; no backend or build step is required.

## API key

The frontend makes direct requests to OpenWeather using one application-level key constant in `index.js`. Any configured value is public in the deployed JavaScript and browser network requests. Rotate any key that was previously committed.

## GitHub Pages

Publish the repository root as the Pages site. The app uses relative asset and service-worker paths, so it works both at a domain root and under a project path such as `/Weather-app/`. There is no server-side runtime or compilation step.

## API capabilities

- Current conditions: OpenWeather Current Weather 2.5 API.
- Hourly and 5-day outlook: 5-day/3-hour Forecast 2.5 API; the daily summary is derived from these intervals.
- Air quality and pollutant concentrations: Air Pollution 2.5 API.
- Search suggestions and location names: Geocoding API.
- Sunrise, sunset, daylight, and other supported metrics are shown when returned.
- UV index, One Call alerts, and moon phase data are not included because they require other endpoints or plans.

The browser requires network access to OpenWeather for live weather. Cached weather may be shown when available.
