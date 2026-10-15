export type CalendarState = {
  date: string;
  minuteOfDay: number | null;
  elapsedMinutes: number;
  paused: boolean;
};
export type CalendarDefinition = {
  hpPerDay?: number;
  mpPerHour?: number;
};
