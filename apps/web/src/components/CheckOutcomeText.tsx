import { useReading } from "../reading";
// Match failure phrases first so “未通过检定” is never colored as success.
const outcomeWords =
  /(未通[過过](?:[檢检]定)?|未(?:能)?成功|大失[敗败]|[檢检]定失[敗败]|失[敗败]|大成功|極難成功|极难成功|困[難难]成功|普通成功|[檢检]定成功|成功|通[過过][檢检]定|\b(?:unsuccessful|did not pass|not passed|critical success|extreme success|hard success|regular success|success(?:ful)?|failure|failed|fumble|passed (?:the )?(?:check|roll))\b)/i;
export function checkOutcomeClass(success: boolean) {
  return success ? "check-success" : "check-failure";
}
export function CheckOutcomeText({ text }: { text: string }) {
  const { convert } = useReading();
  return convert(text)
    .split(outcomeWords)
    .map((part, i) =>
      i % 2 ? (
        <span
          key={i}
          className={checkOutcomeClass(
            !/失[敗败]|^未|failure|failed|fumble|unsuccessful|^did not|^not /i.test(
              part,
            ),
          )}
        >
          {part}
        </span>
      ) : (
        part
      ),
    );
}
