import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type OpenMeteo = {
  timezone: string;
  latitude: number;
  longitude: number;
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    surface_pressure: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: Array<number | null>;
    relative_humidity_2m: Array<number | null>;
    surface_pressure: Array<number | null>;
  };
  daily: {
    time: string[];
    weather_code: Array<number | null>;
    sunrise: string[];
    sunset: string[];
    wind_speed_10m_max: Array<number | null>;
  };
};

function numeric(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function averageForDate(times: string[], values: Array<number | null>, date: string) {
  const valid = values.filter((value, index): value is number => times[index]?.startsWith(date) && typeof value === "number");
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

function daylightMinutes(sunrise: string | undefined, sunset: string | undefined) {
  if (!sunrise || !sunset) return null;
  const duration = new Date(sunset).getTime() - new Date(sunrise).getTime();
  return Number.isFinite(duration) ? Math.round(duration / 60_000) : null;
}

async function getGeomagneticKp() {
  try {
    const response = await fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", {
      next: { revalidate: 900 },
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload) || !payload.length) return null;

    // NOAA currently returns objects; the older product shape used a header row plus arrays.
    if (typeof payload[0] === "object" && payload[0] !== null && !Array.isArray(payload[0])) {
      const last = [...payload].reverse().find((row) => {
        const item = row as Record<string, unknown>;
        return Number.isFinite(Number(item.Kp ?? item.kp));
      }) as Record<string, unknown> | undefined;
      if (!last) return null;
      return { kp: Number(last.Kp ?? last.kp), observedAt: String(last.time_tag ?? last.time ?? new Date().toISOString()) };
    }

    const rows = payload as string[][];
    const header = rows[0] ?? [];
    const kpIndex = header.findIndex((item) => item.toLowerCase() === "kp");
    const timeIndex = header.findIndex((item) => item.toLowerCase().includes("time"));
    const last = rows.slice(1).reverse().find((row) => Number.isFinite(Number(row[kpIndex])));
    if (!last || kpIndex < 0) return null;
    return { kp: Number(last[kpIndex]), observedAt: last[timeIndex] ?? new Date().toISOString() };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const latitude = numeric(request.nextUrl.searchParams.get("lat"), 51.4855, -90, 90);
  const longitude = numeric(request.nextUrl.searchParams.get("lon"), 46.1268, -180, 180);
  const locationName = (request.nextUrl.searchParams.get("name") ?? "Энгельс").trim().slice(0, 60) || "Выбранная точка";

  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", latitude.toString());
  weatherUrl.searchParams.set("longitude", longitude.toString());
  weatherUrl.searchParams.set("current", "temperature_2m,relative_humidity_2m,surface_pressure,weather_code,wind_speed_10m");
  weatherUrl.searchParams.set("hourly", "temperature_2m,relative_humidity_2m,surface_pressure");
  weatherUrl.searchParams.set("daily", "weather_code,sunrise,sunset,wind_speed_10m_max");
  weatherUrl.searchParams.set("past_days", "14");
  weatherUrl.searchParams.set("forecast_days", "15");
  weatherUrl.searchParams.set("timezone", "auto");

  try {
    const [weatherResponse, geomagnetic] = await Promise.all([
      fetch(weatherUrl, { next: { revalidate: 900 }, headers: { accept: "application/json" } }),
      getGeomagneticKp(),
    ]);
    if (!weatherResponse.ok) {
      return NextResponse.json({ error: "Источник погоды временно недоступен" }, { status: 502 });
    }

    const weather = await weatherResponse.json() as OpenMeteo;
    const days = weather.daily.time.map((date, index) => ({
      date,
      temperatureC: averageForDate(weather.hourly.time, weather.hourly.temperature_2m, date),
      humidityPct: averageForDate(weather.hourly.time, weather.hourly.relative_humidity_2m, date),
      pressureHpa: averageForDate(weather.hourly.time, weather.hourly.surface_pressure, date),
      weatherCode: weather.daily.weather_code[index] ?? null,
      windKph: weather.daily.wind_speed_10m_max[index] ?? null,
      daylightMinutes: daylightMinutes(weather.daily.sunrise[index], weather.daily.sunset[index]),
    }));
    const currentDate = weather.current.time.slice(0, 10);
    const currentDay = days.find((day) => day.date === currentDate);

    const payload = {
      location: { name: locationName, latitude: weather.latitude, longitude: weather.longitude, timezone: weather.timezone },
      generatedAt: new Date().toISOString(),
      current: {
        date: currentDate,
        observedAt: weather.current.time,
        temperatureC: weather.current.temperature_2m,
        humidityPct: weather.current.relative_humidity_2m,
        pressureHpa: weather.current.surface_pressure,
        weatherCode: weather.current.weather_code,
        windKph: weather.current.wind_speed_10m,
        daylightMinutes: currentDay?.daylightMinutes ?? null,
      },
      days,
      geomagnetic,
      sources: [
        { name: "Open-Meteo", url: "https://open-meteo.com/" },
        { name: "NOAA SWPC", url: "https://www.swpc.noaa.gov/" },
      ],
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось получить внешний фон" }, { status: 502 });
  }
}
