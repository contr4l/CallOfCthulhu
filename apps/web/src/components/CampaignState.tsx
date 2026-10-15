import type { CalendarState } from "../../../../packages/contracts/calendar";
import type { PartyState } from "../../../../packages/contracts/party";
import { skillLabels } from "../../../../packages/contracts/character-labels";

export function CampaignState({ calendar, party }: { calendar?: CalendarState; party?: PartyState }) {
  return <>
    {calendar && <section className="record-sheet" aria-label="行动日历">
      <h3>行动日历</h3>
      <p>{calendar.date} · {calendar.minuteOfDay === null ? "时刻待登记" : `${String(Math.floor(calendar.minuteOfDay / 60)).padStart(2, "0")}:${String(calendar.minuteOfDay % 60).padStart(2, "0")}`}</p>
      {calendar.paused && <p>航行期间暂停小时计时</p>}
    </section>}
    {!!party?.members.length && <section className="record-sheet" aria-label="同伴状态">
      <h3>同伴</h3>
      {party.members.map((member) => <details key={member.id}>
        <summary>{member.character.name} · {member.status === "dead" ? "死亡" : member.status === "missing" ? "失踪" : member.status === "absent" ? "未同行" : member.unconscious ? "昏迷" : "同行"} · 生命 {member.character.hp}/{member.character.maxHp}</summary>
        <p>{member.character.occupation}</p>
        {!!member.inventory.length && <p>随身物品：{member.inventory.map(item => `${item.label} × ${item.quantity ?? 1}`).join("、")}</p>}
        <div className="character-sheet-scroll"><table className="character-sheet">
          <caption>{member.character.name}的技能</caption>
          <thead><tr><th>技能</th><th>普通</th><th>困难</th><th>极难</th></tr></thead>
          <tbody>{Object.entries(member.character.skills).map(([key, value]) => <tr key={key}>
            <th>{skillLabels[key] ?? key}</th><td>{value}</td><td>{Math.floor(value / 2)}</td><td>{Math.floor(value / 5)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>)}
    </section>}
  </>;
}
