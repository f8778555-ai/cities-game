/**
 * Определения достижений и логика проверки.
 * Каждое достижение: id, title, description, icon, check(user) -> bool.
 */

export const ACHIEVEMENTS = [
  {
    id: "first_game",
    title: "Первый шаг",
    description: "Сыграть первую партию",
    icon: "🎮",
    check: (u) => u.stats.games >= 1,
  },
  {
    id: "first_win",
    title: "Первая победа",
    description: "Выиграть первую партию",
    icon: "🏆",
    check: (u) => u.stats.wins >= 1,
  },
  {
    id: "ten_games",
    title: "Новичок",
    description: "Сыграть 10 партий",
    icon: "🎯",
    check: (u) => u.stats.games >= 10,
  },
  {
    id: "fifty_games",
    title: "Опытный",
    description: "Сыграть 50 партий",
    icon: "⭐",
    check: (u) => u.stats.games >= 50,
  },
  {
    id: "hundred_games",
    title: "Ветеран",
    description: "Сыграть 100 партий",
    icon: "🌟",
    check: (u) => u.stats.games >= 100,
  },
  {
    id: "ten_wins",
    title: "Чемпион",
    description: "Выиграть 10 партий",
    icon: "🥇",
    check: (u) => u.stats.wins >= 10,
  },
  {
    id: "fifty_wins",
    title: "Мастер",
    description: "Выиграть 50 партий",
    icon: "👑",
    check: (u) => u.stats.wins >= 50,
  },
  {
    id: "streak_3",
    title: "В ударе",
    description: "Выиграть 3 партии подряд",
    icon: "🔥",
    check: (u) => u.stats.maxStreak >= 3,
  },
  {
    id: "streak_5",
    title: "Огонь!",
    description: "Выиграть 5 партий подряд",
    icon: "💥",
    check: (u) => u.stats.maxStreak >= 5,
  },
  {
    id: "streak_10",
    title: "Непобедимый",
    description: "Выиграть 10 партий подряд",
    icon: "⚡",
    check: (u) => u.stats.maxStreak >= 10,
  },
  {
    id: "all_letters",
    title: "Полиглот",
    description: "Назвать города на 20 разных букв",
    icon: "📚",
    check: (u) => Object.keys(u.stats.lettersUsed || {}).length >= 20,
  },
  {
    id: "long_city",
    title: "Длинное слово",
    description: "Назвать город из 15+ букв",
    icon: "📏",
    check: (u) => (u.stats.longestCity?.length || 0) >= 15,
  },
  {
    id: "hundred_cities",
    title: "Географ",
    description: "Назвать 100 городов суммарно",
    icon: "🗺️",
    check: (u) => u.stats.totalCities >= 100,
  },
  {
    id: "five_hundred_cities",
    title: "Картограф",
    description: "Назвать 500 городов суммарно",
    icon: "🧭",
    check: (u) => u.stats.totalCities >= 500,
  },
  {
    id: "social",
    title: "Компанейский",
    description: "Сыграть с 10 разными людьми",
    icon: "👥",
    check: (u) => Object.keys(u.stats.playedWithPlayers || {}).length >= 10,
  },
  {
    id: "fast_move",
    title: "Реактивный",
    description: "Сделать ход быстрее 3 секунд",
    icon: "⚡",
    check: (u) => u.stats.fastestMoveMs && u.stats.fastestMoveMs < 3000,
  },
  {
    id: "google_user",
    title: "Член клуба",
    description: "Войти через Google",
    icon: "🎖️",
    check: (u) => !!u.googleSub,
  },
  {
    id: "personalized",
    title: "Индивидуальность",
    description: "Настроить профиль",
    icon: "🎨",
    check: (u) => u.avatar !== "🙂" || u.color !== "#6ea8ff",
  },
];

/** Возвращает массив id только что разблокированных достижений. */
export function checkAchievements(user, unlockFn) {
  const newlyUnlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (user.achievements[a.id]) continue;
    try {
      if (a.check(user)) {
        if (unlockFn(user.id, a.id)) newlyUnlocked.push(a);
      }
    } catch {}
  }
  return newlyUnlocked;
}
