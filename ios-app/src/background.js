import { useEffect, useState } from "react";

// Time-of-day background selection. The day is split into 5 zones, each with a
// solar/renewable-energy photo that matches the light at that hour.
//
//   night    20:00 – 05:00   starry sky
//   dawn     05:00 – 08:00   low sun over panels
//   morning  08:00 – 12:00   soft blue sky
//   midday   12:00 – 17:00   bright blue sky
//   evening  17:00 – 20:00   golden sunset

export const ZONES = {
  dawn: {
    key: "dawn",
    label: "Dawn",
    source: require("../assets/bg_dawn.jpg"),
    gradient: ["#E8C5B5", "#E8DDD1", "#C9D7D9"],
  },
  morning: {
    key: "morning",
    label: "Morning",
    source: require("../assets/bg_morning.jpg"),
    gradient: ["#BFD8E2", "#D9E3DF", "#EEE7D9"],
  },
  midday: {
    key: "midday",
    label: "Midday",
    source: require("../assets/bg_midday.jpg"),
    gradient: ["#AFCFDD", "#D2E0DE", "#EEE8D9"],
  },
  evening: {
    key: "evening",
    label: "Evening",
    source: require("../assets/bg_evening.jpg"),
    gradient: ["#D4A27F", "#E5C3A4", "#D9D4C8"],
  },
  night: {
    key: "night",
    label: "Night",
    source: require("../assets/bg_night.jpg"),
    gradient: ["#8D91A7", "#B5B2BD", "#D8D2CC"],
  },
};

export function backgroundForHour(h) {
  if (h >= 5 && h < 8) return ZONES.dawn;
  if (h >= 8 && h < 12) return ZONES.morning;
  if (h >= 12 && h < 17) return ZONES.midday;
  if (h >= 17 && h < 20) return ZONES.evening;
  return ZONES.night;
}

export function currentBackground(date = new Date()) {
  return backgroundForHour(date.getHours());
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
