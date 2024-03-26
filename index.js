const apiKey = "60a0c7e584eb6742cdd95cb487fa6226";
const apiUrl = "https://api.openweathermap.org/data/2.5/weather?units=metric&q=";

const searchCity = document.getElementById("input");
const searchBtn = document.getElementById("searchBtn");

async function checkWeather(city) {
    try {
        const response = await fetch(`${apiUrl}${city}&appid=${apiKey}`);
        const data = await response.json();
        updateWeatherData(data);
    } catch (error) {
        console.error("Error fetching weather data:", error);
    }
}

function updateWeatherData(data) {
    document.querySelector(".city-name").innerHTML = data.name;
    document.querySelector(".temp").innerHTML = `${Math.round(data.main.temp)}°C`;
    document.querySelector(".humid-value").innerHTML = `${data.main.humidity}%`;
    document.querySelector(".wind-num").innerHTML = data.wind.speed;
}

searchBtn.addEventListener('click', () => {
    checkWeather(searchCity.value);
});

searchCity.addEventListener('keyup', (e) => {
    if (e.keyCode === 13) {
        checkWeather(searchCity.value);
    }
});

// Initial weather check with default city
checkWeather("YourDefaultCityNameHere");
