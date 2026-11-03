import { useColorScheme } from "react-native";

const light = {
  bg: "#eef1f8",
  card: "rgba(255,255,255,0.82)",
  cardBorder: "rgba(255,255,255,0.9)",
  text: "#101828",
  muted: "#667085",
  primary: "#4f46e5",
  primaryText: "#ffffff",
  success: "#12a150",
  danger: "#d92d20",
  warning: "#b54708",
  line: "rgba(16,24,40,0.08)",
  chip: "rgba(79,70,229,0.1)",
};

const dark: typeof light = {
  bg: "#0b1220",
  card: "rgba(30,41,59,0.72)",
  cardBorder: "rgba(255,255,255,0.08)",
  text: "#f2f4f7",
  muted: "#98a2b3",
  primary: "#818cf8",
  primaryText: "#0b1220",
  success: "#32d583",
  danger: "#f97066",
  warning: "#fdb022",
  line: "rgba(255,255,255,0.1)",
  chip: "rgba(129,140,248,0.16)",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
