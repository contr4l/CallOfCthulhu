import type { CalendarState } from "../contracts/calendar.js";

const DAY = 86_400_000;
function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export function calendarDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("日历日期格式错误");
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date)
    invalid("日历日期不存在");
  return parsed / DAY;
}
export function setCalendar(date: string, minute: number | null, previous?: CalendarState): CalendarState {
  calendarDay(date);
  if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute > 1439))
    invalid("日历时刻须为当天第0至1439分钟");
  return { date, minuteOfDay: minute, elapsedMinutes: previous?.elapsedMinutes ?? 0, paused: previous?.paused ?? false };
}
export function advanceCalendar(calendar: CalendarState, minutes: number, wholeDays = false): CalendarState {
  if (!Number.isSafeInteger(minutes) || minutes < 0) invalid("经过时间须为非负整数分钟");
  if (calendar.paused && !wholeDays) invalid("当前小时钟已暂停");
  if (wholeDays && minutes % 1440) invalid("日期推进须为完整天数");
  if (calendar.minuteOfDay === null && !wholeDays) invalid("请先登记当前时刻");
  const total = (calendar.minuteOfDay ?? 0) + minutes;
  const day = calendarDay(calendar.date) + Math.floor(total / 1440);
  const date = new Date(day * DAY).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid("日历时间超出支持范围");
  const elapsedMinutes = calendar.elapsedMinutes + minutes;
  if (!Number.isSafeInteger(elapsedMinutes)) invalid("累计时间超出支持范围");
  return { ...calendar, date, minuteOfDay: calendar.minuteOfDay === null ? null : total % 1440, elapsedMinutes };
}
