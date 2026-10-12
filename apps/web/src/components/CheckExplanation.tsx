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
            text={`候选骰点 ${result.candidates.join(" / ")}；本次采用 ${result.roll}。`}
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
