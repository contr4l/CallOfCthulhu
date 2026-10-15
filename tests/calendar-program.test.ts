import test from "node:test";
import assert from "node:assert/strict";
import { setCalendar, advanceCalendar, calendarDay } from "../packages/engine/calendar.js";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

test("calendar retains four-minute and half-hour durations across midnight", () => {
  let clock = setCalendar("1931-09-01", 23 * 60 + 58);
  clock = advanceCalendar(clock, 4);
  assert.equal(clock.date, "1931-09-02");
  assert.equal(clock.minuteOfDay, 2);
  clock = advanceCalendar(clock, 30);
  assert.equal(clock.minuteOfDay, 32);
  assert.equal(clock.elapsedMinutes, 34);
  assert.equal(calendarDay("1931-12-20") - calendarDay("1931-09-01"), 110);
});
test("unknown times remain unknown; pause forbids hourly activities without losing explicit voyage dates", () => {
  const clock = setCalendar("1931-09-01", null);
  assert.throws(() => advanceCalendar(clock, 60), /先登记/);
  const later = advanceCalendar(clock, 26 * 1440, true);
  assert.equal(later.date, "1931-09-27");
  assert.equal(later.minuteOfDay, null);
  assert.throws(() => advanceCalendar({ ...later, paused: true }, 60), /暂停/);
  assert.equal(advanceCalendar({ ...later, paused: true }, 1440, true).date, "1931-09-28");
  for (const date of ["1931-02-29", "1931-09-31", "1931-9-01"]) assert.throws(() => setCalendar(date, null));
  assert.throws(() => setCalendar("1931-09-01", 1440));
  assert.throws(() => advanceCalendar(setCalendar("1931-09-01", 0), -4));
});
test("program calendar records player-selected evening time, sleep and bounded recovery through a restart", () => {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "calendar-fixture";
  delete story.healthPolicy;
  story.calendar = { hpPerDay: 1, mpPerHour: 1 };
  story.entry = "entry";
  story.nodes = [{ id: "entry", title: "登记时刻", text: ["选择开始时刻。"], chapter: "1", background: story.nodes[0].background, type: "program", program: [
    { kind: "effects", effects: [{ op: "clock", action: "set", date: "1931-09-01", minute: null }] },
    { kind: "number", label: "晚间开始时刻", field: "counter.startHour", min: 18, max: 23 },
    { kind: "effects", effects: [
      { op: "clock", action: "set", date: "1931-09-01", minute: { field: "counter.startHour", factor: 60 } },
      { op: "clock", action: "advance", minutes: 480 },
    ] },
    { kind: "choices", choices: [{ id: "wait", label: "等候半小时", effects: [{ op: "clock", action: "advance", minutes: 30 }] }] },
    { kind: "end", label: "验收结束", collect: false },
  ] }];
  const validated = validateStory(story);
  const character = createCharacter("教授", { ...story.presets[0], attributes: { ...story.presets[0].attributes!, pow: 85 }, mp: 3 }, 85);
  character.hp -= 4;
  const initial = initialState(validated, character, () => 1);
  assert.equal(initial.calendar!.minuteOfDay, null);
  assert.throws(() => advance(validated, initial, "confirm", () => 1, { value: 17 }), /超出/);
  const asleep = advance(validated, initial, "confirm", () => 1, { value: 23 }).state;
  assert.deepEqual(asleep.calendar, { date: "1931-09-02", minuteOfDay: 7 * 60, elapsedMinutes: 480, paused: false });
  assert.equal(asleep.character.hp, character.hp + 1);
  assert.equal(asleep.character.mp, 11);
  const restored = JSON.parse(JSON.stringify(asleep));
  assert.deepEqual(project(validated, restored, "run", 1), project(validated, asleep, "run", 1));
  const end = advance(validated, restored, "next", () => 1).state;
  assert.equal(end.calendar!.minuteOfDay, 450);
  assert.equal(end.character.mp, 11);
  assert.equal(initial.character.hp, character.hp);
});
