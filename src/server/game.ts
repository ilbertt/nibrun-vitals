// The game layer: a level from page views, achievements from everything else already recorded.
import * as store from '#store.ts';

const XP_PER_LEVEL_SQUARED = 25;
const CENTURION_VIEWS = 100;
const CROWD_ONLINE = 10;
const WORLDWIDE_COUNTRIES = 5;
const SURVIVOR_REDEPLOYS = 5;
const POWER_NAP_S = 3600;
const MARATHON_S = 21_600;
const BOOPED_COUNT = 100;

export function level(views: number) {
  const lvl = Math.floor(Math.sqrt(views / XP_PER_LEVEL_SQUARED)) + 1;
  return {
    lvl,
    xp: views,
    floor: XP_PER_LEVEL_SQUARED * (lvl - 1) ** 2,
    next: XP_PER_LEVEL_SQUARED * lvl ** 2,
  };
}

export type AchievementInputs = {
  nowS: number;
  bootedAtS: number;
  totalViews: number;
  bootCount: number;
  peak: number;
};

export function achievements(input: AchievementInputs) {
  const a = store.achievementInputs();
  const awakeStreakS = input.nowS - Math.max(a.lastNapEnd ?? 0, input.bootedAtS);
  const list = [
    { id: 'first-light', name: 'first light', desc: 'booted for the first time', p: 1 },
    {
      id: 'centurion',
      name: 'centurion',
      desc: '100 page views',
      p: input.totalViews / CENTURION_VIEWS,
    },
    { id: 'crowd', name: 'crowd', desc: '10 online at once', p: input.peak / CROWD_ONLINE },
    {
      id: 'worldwide',
      name: 'worldwide',
      desc: '5 countries in one day',
      p: a.maxCountriesDay / WORLDWIDE_COUNTRIES,
    },
    {
      id: 'survivor',
      name: 'survivor',
      desc: '5 redeploys',
      p: (input.bootCount - 1) / SURVIVOR_REDEPLOYS,
    },
    {
      id: 'power-nap',
      name: 'power nap',
      desc: 'a nap longer than an hour',
      p: a.longestNapS / POWER_NAP_S,
    },
    { id: 'marathon', name: 'marathon', desc: 'awake 6h straight', p: awakeStreakS / MARATHON_S },
    { id: 'booped', name: 'much booped', desc: '100 boops', p: store.boops / BOOPED_COUNT },
  ];
  return list.map(({ id, name, desc, p }) => {
    const unlocked = p >= 1;
    return {
      id,
      name,
      desc,
      progress: Math.min(1, p),
      unlocked,
      at: store.unlockedAt({ id, unlocked }),
    };
  });
}
