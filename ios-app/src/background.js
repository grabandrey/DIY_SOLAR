import { useEffect, useState } from "react";

// Time-of-day background selection. The images stay fixed, but their thresholds
// follow local sunrise/sunset instead of hard-coded clock hours.

const DEFAULT_LATITUDE = 44.4268;
const DEFAULT_LONGITUDE = 26.1025;
const DAY_MINUTES = 24 * 60;
const SOLAR_ZENITH = 90.833;

export const ZONES = {
  dawn: {
    key: "dawn",
    label: "Dawn",
    source: require("../assets/bg_dawn.jpeg"),
    gradient: ["#E8C5B5", "#E8DDD1", "#C9D7D9"],
  },
  morning: {
    key: "morning",
    label: "Morning",
    source: require("../assets/bg_morning.jpeg"),
    gradient: ["#BFD8E2", "#D9E3DF", "#EEE7D9"],
  },
  midday: {
    key: "midday",
    label: "Midday",
    source: require("../assets/bg_midday.jpeg"),
    gradient: ["#AFCFDD", "#D2E0DE", "#EEE8D9"],
  },
  evening: {
    key: "evening",
    label: "Evening",
    source: require("../assets/bg_evening.jpeg"),
    gradient: ["#D4A27F", "#E5C3A4", "#D9D4C8"],
  },
  night: {
    key: "night",
    label: "Night",
    source: require("../assets/bg_night.jpeg"),
    gradient: ["#8D91A7", "#B5B2BD", "#D8D2CC"],
  },
};

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function degrees(radians_) {
  return (radians_ * 180) / Math.PI;
}

function normalize(value, max) {
  return ((value % max) + max) % max;
}

function dayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((today - start) / 86400000);
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function solarEventMinutes(date, latitude, longitude, sunrise) {
  const n = dayOfYear(date);
  const longitudeHour = longitude / 15;
  const approximateTime = n + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalize(
    meanAnomaly +
      1.916 * Math.sin(radians(meanAnomaly)) +
      0.02 * Math.sin(radians(2 * meanAnomaly)) +
      282.634,
    360
  );
  let rightAscension = normalize(
    degrees(Math.atan(0.91764 * Math.tan(radians(trueLongitude)))),
    360
  );

  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(radians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour =
    (Math.cos(radians(SOLAR_ZENITH)) -
      sinDeclination * Math.sin(radians(latitude))) /
    (cosDeclination * Math.cos(radians(latitude)));

  if (cosHour > 1 || cosHour < -1) return null;

  const hourAngle = sunrise
    ? 360 - degrees(Math.acos(cosHour))
    : degrees(Math.acos(cosHour));
  const localMeanTime =
    hourAngle / 15 +
    rightAscension -
    0.06571 * approximateTime -
    6.622;
  const utcMinutes = normalize(localMeanTime - longitudeHour, 24) * 60;
  return Math.round(normalize(utcMinutes - date.getTimezoneOffset(), DAY_MINUTES));
}

export function sunTimesForDate(
  date = new Date(),
  latitude = DEFAULT_LATITUDE,
  longitude = DEFAULT_LONGITUDE
) {
  const sunrise = solarEventMinutes(date, latitude, longitude, true);
  const sunset = solarEventMinutes(date, latitude, longitude, false);

  if (sunrise == null || sunset == null) {
    return { sunrise: 6 * 60, sunset: 18 * 60 };
  }

  return { sunrise, sunset };
}

export function backgroundForDate(
  date = new Date(),
  latitude = DEFAULT_LATITUDE,
  longitude = DEFAULT_LONGITUDE
) {
  const { sunrise, sunset } = sunTimesForDate(date, latitude, longitude);
  const now = minutesSinceMidnight(date);
  const daylight = Math.max(0, sunset - sunrise);
  const twilightWindow = daylight >= 14 * 60 ? 90 : daylight <= 10 * 60 ? 60 : 75;
  const dawnEnd = sunrise + twilightWindow;
  const eveningStart = sunset - twilightWindow;
  const solarNoon = sunrise + daylight / 2;
  const morningEnd = solarNoon - Math.min(75, daylight * 0.18);

  if (now >= sunrise - twilightWindow && now < dawnEnd) return ZONES.dawn;
  if (now >= dawnEnd && now < morningEnd) return ZONES.morning;
  if (now >= morningEnd && now < eveningStart) return ZONES.midday;
  if (now >= eveningStart && now < sunset + twilightWindow) return ZONES.evening;
  return ZONES.night;
}

export function currentBackground(date = new Date()) {
  return backgroundForDate(date);
}

// Status-bar style for a zone: white icons (light) for the darker times of day
// (dawn / evening / night), black icons (dark) for the bright daytime.
export function statusBarStyleForKey(key) {
  return key === "morning" || key === "midday" ? "dark" : "light";
}

export function useCurrentBackground() {
  const [background, setBackground] = useState(() => currentBackground());

  useEffect(() => {
    const id = setInterval(() => {
      const next = currentBackground();
      setBackground((previous) => (previous.key === next.key ? previous : next));
    }, 60 * 1000);

    return () => clearInterval(id);
  }, []);

  return background;
}
