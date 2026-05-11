/**
 * Кастомные темы интерфейса.
 */
export const THEMES = [
  { id: "dark",    name: "Тёмная",     icon: "🌙", requireLevel: 1 },
  { id: "light",   name: "Светлая",    icon: "☀️", requireLevel: 1 },
  { id: "neon",    name: "Неон",       icon: "💫", requireLevel: 3 },
  { id: "sunset",  name: "Закат",      icon: "🌅", requireLevel: 5 },
  { id: "forest",  name: "Лес",        icon: "🌲", requireLevel: 7 },
  { id: "ocean",   name: "Океан",      icon: "🌊", requireLevel: 10 },
  { id: "space",   name: "Космос",     icon: "🌌", requireLevel: 15 },
  { id: "vintage", name: "Винтаж",     icon: "📻", requireLevel: 20 },
];

export function isThemeUnlocked(user, theme) {
  if (!theme) return false;
  return (user.level || 1) >= (theme.requireLevel || 1);
}

export function getThemesForUser(user) {
  return THEMES.map(t => ({ ...t, unlocked: isThemeUnlocked(user, t) }));
}
