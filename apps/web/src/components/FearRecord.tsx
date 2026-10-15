import { useState } from "react";
import type { FearProjected } from "../../../../packages/contracts/fear";

export function FearRecord({ fear }: { fear: FearProjected }) {
  const [chosenSheet, chooseSheet] = useState<number | null>(null);
  const sheet = fear.mapSheets.find(value => value.sheet === chosenSheet)
    ?? fear.mapSheets.find(value => value.sheet === fear.currentBox.sheet)
    ?? fear.mapSheets[0];
  return <section className="record-sheet fear-record" aria-label="探索记录">
    <h3>探索记录</h3>
    <dl className="fear-resources">
      <div><dt>食物</dt><dd>{fear.food} / {fear.foodCapacity}</dd></div>
      {fear.missionId === "3" && <div><dt>任务食物</dt><dd>{fear.missionFood} / {fear.missionFoodTarget}</dd></div>}
      <div><dt>线索</dt><dd>{fear.clues}</dd></div>
      <div><dt>经验</dt><dd>{fear.xp}</dd></div>
      <div><dt>关闭的地狱之门</dt><dd>{fear.gatesClosed} / 7</dd></div>
      <div><dt>仪式幸运</dt><dd>{fear.luck ?? 0}</dd></div>
    </dl>
    {!!fear.elapsedTimeBoxes && <p>研读与仪式耗时：{fear.elapsedTimeBoxes}格</p>}
    {!!fear.skills?.some(skill => skill.kind === "arcane") && <p>学会的奥术：{fear.skills.filter(skill => skill.kind === "arcane").map(skill => `${skill.label}${skill.level === 2 ? "（专家）" : ""}`).join("、")}</p>}
    <p>当前武器：{fear.currentWeapon.label} · 伤害 {fear.currentWeapon.damage}
      {fear.currentWeapon.ammo !== undefined && ` · 弹药 ${fear.currentWeapon.ammo}`}</p>
    {Object.entries(fear.silverAmmo ?? {}).some(([, count]) => count > 0) && <p>银弹：{Object.entries(fear.silverAmmo ?? {}).filter(([, count]) => count > 0).map(([id, count]) => `${fear.weapons.find(weapon => weapon.id === id)?.label ?? id} ${count} 发`).join("、")}</p>}
    {!!fear.weapons.length && <p>携带武器：{fear.weapons.map(weapon => `${weapon.label}${weapon.count > 1 ? ` ×${weapon.count}` : ""}${weapon.ammo !== undefined ? `（共用弹药 ${weapon.ammo}）` : ""}${weapon.broken ? `（损坏 ${weapon.broken} 把）` : ""}`).join("、")}</p>}
    <p><strong>{fear.currentMission.label}</strong><br />{fear.currentMission.goal}</p>
    {fear.combat && <p role="status">第 {fear.combat.round} 回合 · 对手剩余生命：{fear.combat.enemyLives.join("、")}</p>}
    {sheet && <>
      {fear.mapSheets.length > 1 && <label>地图纸
        <select value={sheet.sheet} onChange={event => chooseSheet(Number(event.target.value))}>
          {fear.mapSheets.map(value => <option key={value.sheet} value={value.sheet}>第 {value.sheet} 张</option>)}
        </select>
      </label>}
      <div className="fear-map" role="group" aria-label={`第 ${sheet.sheet} 张地图，当前位置 ${fear.currentBox.box}`}>
        {sheet.boxes.map(box => {
          const current = box.id === fear.currentBox.id;
          const reachable = fear.reachable.includes(box.id);
          const description = [current && "当前位置", box.visited ? "已探索" : "未探索", reachable && "可前往", box.searched && "已搜索", box.safehouse && "安全屋", box.storedItemCount && `存放 ${box.storedItemCount} 件物品`].filter(Boolean).join("，");
          return <div key={box.id} className={`fear-map-box${current ? " current" : ""}${box.visited ? " visited" : ""}${reachable ? " reachable" : ""}`} aria-current={current ? "location" : undefined} aria-label={`地块 ${box.box}，${description}`} title={description}>
            <span>{box.box}</span><small>{box.safehouse ? "安全屋" : current ? "当前位置" : box.visited ? "已探索" : "未探索"}</small>
            {!!box.storedItemCount && <small>物品 {box.storedItemCount}</small>}
          </div>;
        })}
      </div>
      <p className="fear-map-legend">边框标记可前往的位置。</p>
    </>}
    {!!fear.scars.length && <p>伤疤：{fear.scars.map(value => value.label).join("、")}</p>}
    {!!fear.traumas.length && <p>创伤：{fear.traumas.map(value => value.label).join("、")}</p>}
  </section>;
}
