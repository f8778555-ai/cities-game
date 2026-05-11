/**
 * Магазин аватаров — эмодзи, разблокируемые за уровни или достижения.
 */

export const SHOP_AVATARS = [
  // Базовые (доступны всем)
  { emoji: "🙂", category: "basic", requireLevel: 1 },
  { emoji: "😎", category: "basic", requireLevel: 1 },
  { emoji: "🤓", category: "basic", requireLevel: 1 },
  { emoji: "😇", category: "basic", requireLevel: 1 },
  { emoji: "🥳", category: "basic", requireLevel: 1 },
  { emoji: "🤠", category: "basic", requireLevel: 1 },
  { emoji: "🦊", category: "basic", requireLevel: 1 },
  { emoji: "🐱", category: "basic", requireLevel: 1 },
  { emoji: "🐶", category: "basic", requireLevel: 1 },
  { emoji: "🐼", category: "basic", requireLevel: 1 },

  // Уровни
  { emoji: "🦁", category: "level", requireLevel: 2 },
  { emoji: "🐸", category: "level", requireLevel: 2 },
  { emoji: "🐨", category: "level", requireLevel: 3 },
  { emoji: "🐰", category: "level", requireLevel: 3 },
  { emoji: "🐯", category: "level", requireLevel: 4 },
  { emoji: "🐲", category: "level", requireLevel: 5 },
  { emoji: "🦄", category: "level", requireLevel: 6 },
  { emoji: "👾", category: "level", requireLevel: 7 },
  { emoji: "🤖", category: "level", requireLevel: 8 },
  { emoji: "👻", category: "level", requireLevel: 10 },
  { emoji: "🎃", category: "level", requireLevel: 12 },
  { emoji: "🌟", category: "level", requireLevel: 15 },
  { emoji: "⚡", category: "level", requireLevel: 18 },
  { emoji: "🔥", category: "level", requireLevel: 20 },
  { emoji: "💎", category: "level", requireLevel: 25 },
  { emoji: "👑", category: "level", requireLevel: 30 },

  // Достижения
  { emoji: "🏆", category: "achievement", requireAchievement: "ten_wins" },
  { emoji: "🎯", category: "achievement", requireAchievement: "first_win" },
  { emoji: "🎲", category: "achievement", requireAchievement: "ten_games" },
  { emoji: "🎨", category: "achievement", requireAchievement: "personalized" },
  { emoji: "🎸", category: "achievement", requireAchievement: "all_letters" },
  { emoji: "🎮", category: "achievement", requireAchievement: "fifty_games" },
  { emoji: "⚽", category: "achievement", requireAchievement: "streak_3" },
  { emoji: "🏀", category: "achievement", requireAchievement: "streak_5" },
  { emoji: "🚀", category: "achievement", requireAchievement: "streak_10" },
  { emoji: "🛸", category: "achievement", requireAchievement: "long_city" },
  { emoji: "🌈", category: "achievement", requireAchievement: "social" },
  { emoji: "🗺️", category: "achievement", requireAchievement: "hundred_cities" },
  { emoji: "🧭", category: "achievement", requireAchievement: "five_hundred_cities" },
  { emoji: "⚡", category: "achievement", requireAchievement: "fast_move" },
  { emoji: "🎖️", category: "achievement", requireAchievement: "google_user" },
];

export function isAvatarUnlocked(user, item) {
  if (!item) return false;
  if (item.category === "basic") return true;
  if (item.requireLevel && (user.level || 1) >= item.requireLevel) return true;
  if (item.requireAchievement && user.achievements?.[item.requireAchievement]) return true;
  return !!(user.unlockedAvatars?.[item.emoji]);
}

export function getShopForUser(user) {
  return SHOP_AVATARS.map(a => ({
    ...a,
    unlocked: isAvatarUnlocked(user, a),
  }));
}
