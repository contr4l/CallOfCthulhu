import type { CheckResult } from "../../../../packages/contracts/index";
import { explainRoll, explainContest } from "../check-explanation";
import { useReading } from "../reading";
import { CheckOutcomeText, checkOutcomeClass } from "./CheckOutcomeText";
export function CheckExplanation({ result }: { result: CheckResult }) {
  const { convert } = useReading();
  const own = explainRoll(result),
    other = result.opponent ? explainRoll(result.opponent) : null;
  const contest = explainContest(result);
  return (
    <div className="check-explanation">
      {result.assistance?.targetBonus ? (
        <p>{convert(`命运助力：目标值＋${result.assistance.targetBonus}`)}</p>
      ) : null}
      {result.assistance?.previousRoll !== undefined && (
        <p>
          {convert(
            `重掷：上次 ${result.assistance.previousRoll}，本次 ${result.roll}，以本次结果为准。`,
          )}
        </p>
      )}
      {result.luckSpent !== undefined && (
        <p>
          {convert(
            `原始骰点 ${result.originalRoll}；花费 ${result.luckSpent} 点幸运后调整为 ${result.roll}。`,
          )}
        </p>
      )}
      <p className="check-comparison">
        <CheckOutcomeText text={`D100 · ${own.comparison}，`} />
        <span className={checkOutcomeClass(own.passed)}>
          {convert(own.label)}
        </span>
      </p>
      {own.reason && (
        <p className="check-reason">
          <CheckOutcomeText text={own.reason} />
        </p>
      )}
      {result.candidates.length > 1 && (
        <p>
          <CheckOutcomeText
            text={`候选骰点 ${result.candidates.join(" / ")}；原始采用 ${result.originalRoll ?? result.roll}。`}
          />
        </p>
      )}
      {other && (
        <p className="check-comparison opponent-comparison">
          <CheckOutcomeText text={`对手 D100 · ${other.comparison}，`} />
          <span className={checkOutcomeClass(other.passed)}>
            {convert(other.label)}
          </span>
        </p>
      )}
      {other?.reason && (
        <p className="check-reason">
          <CheckOutcomeText text={`对手：${other.reason}`} />
        </p>
      )}
      {contest && (
        <p className="check-reason">
          <CheckOutcomeText text={contest} />
        </p>
      )}
    </div>
  );
}
