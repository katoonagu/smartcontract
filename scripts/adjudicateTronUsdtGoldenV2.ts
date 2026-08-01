import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AdjudicationDraftV2,
  ResolvedAdjudicationFactV2
} from "../tools/golden-pilot-v2/adjudication";
import { canonicalJson } from "../tools/golden-pilot-v2/canonicalJson";
import type {
  LockedReviewV2,
  ReviewFindingV2
} from "../tools/golden-pilot-v2/reviewWorkspace";

type Decision = "ACCEPTABLE" | "REVIEW" | "DECLINE";

const ROOT = "artifacts/golden-v2-2026-07";
const ADJUDICATED_AT = "2026-07-23T13:30:00.000Z";

const policy: Record<string, {
  decision: Decision;
  score: number;
  ru: string;
  en: string;
}> = {
  "blind-history-scope": {
    decision: "REVIEW",
    score: 35,
    ru: "Найден повторяющийся быстрый перевод входящих средств дальше. Это поведенческий паттерн, а не прямое доказательство злоупотребления.",
    en: "Repeated rapid forwarding of inbound funds was observed. This is a behavioral pattern, not direct proof of abuse."
  },
  "blind-incoming-deposit-scope": {
    decision: "REVIEW",
    score: 45,
    ru: "Высокий входящий и исходящий оборот образует плотный транзитный паттерн. Метаданные создания контрактом сами по себе риск не повышают.",
    en: "High inbound and outbound throughput forms a dense transit pattern. Contract-creation metadata alone does not add risk."
  },
  "blind-route-scope": {
    decision: "REVIEW",
    score: 42,
    ru: "Большая доля входящего объёма вскоре ушла дальше. Это значимый транзитный контекст без hard evidence.",
    en: "A material share of inbound volume was forwarded. This is significant transit context without hard evidence."
  },
  "blind-selected-amount-scope": {
    decision: "REVIEW",
    score: 40,
    ru: "Выбранная входящая сумма почти полностью перемещена дальше. Неизвестные контрагенты сами по себе баллы не добавляют.",
    en: "The selected inbound amount was almost entirely forwarded. Unknown counterparties alone add no points."
  },
  "blind-wallet-scope": {
    decision: "REVIEW",
    score: 40,
    ru: "Концентрированный входящий поток распределяется по многим получателям. Это проверяемый fan-out паттерн без прямого доказательства.",
    en: "Concentrated inbound flow is distributed across many recipients. This is a reviewable fan-out pattern without direct proof."
  },
  "regression-tbl7": {
    decision: "REVIEW",
    score: 45,
    ru: "Кошелёк работает как коллектор и транзитный узел. Биржевые разметки показаны как контекст и не переопределяют прошлые переводы задним числом.",
    en: "The wallet behaves as a collector and transit hub. Exchange labels are context and do not retroactively reclassify earlier transfers."
  },
  "regression-tqr": {
    decision: "REVIEW",
    score: 45,
    ru: "Найден устойчивый высокооборотный транзитный паттерн. Более поздние сервисные разметки не являются hard evidence для прошлых событий.",
    en: "A sustained high-throughput transit pattern was found. Later service labels are not hard evidence for earlier events."
  },
  "synthetic-500-pages": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Глубина истории и число страниц сами по себе не создают риск.",
    en: "History depth and page count do not create risk by themselves."
  },
  "synthetic-ambiguous-delivery": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Неопределённость доставки — техническое состояние, а не характеристика кошелька.",
    en: "Delivery ambiguity is a technical state, not a wallet risk signal."
  },
  "synthetic-bybit-plus-hard-evidence": {
    decision: "DECLINE",
    score: 90,
    ru: "Есть прямое поступление от адреса, находившегося в blacklist во время перевода. Больший безопасный поток Bybit не снижает hard-evidence floor.",
    en: "There is a direct inbound transfer from an address blacklisted at transfer time. Larger safe Bybit flow does not lower the hard-evidence floor."
  },
  "synthetic-dangerous-approval-no-debit": {
    decision: "REVIEW",
    score: 55,
    ru: "Найдено опасное разрешение, но подтверждённого списания нет. Нужна защитная проверка без утверждения о краже.",
    en: "A dangerous approval was found, but no debit is confirmed. Protective review is required without claiming a theft."
  },
  "synthetic-dense-wallet": {
    decision: "REVIEW",
    score: 45,
    ru: "Плотный fan-in/fan-out и быстрый вывод образуют составной поведенческий сигнал. Плотность графа сама по себе hard evidence не является.",
    en: "Dense fan-in/fan-out with rapid forwarding forms a composite behavioral signal. Graph density alone is not hard evidence."
  },
  "synthetic-direct-blacklist-1pct": {
    decision: "DECLINE",
    score: 90,
    ru: "Подтверждено прямое поступление от адреса в blacklist на момент перевода. Малый процент не отменяет сам hard fact.",
    en: "A direct inbound transfer from an address blacklisted at transfer time is confirmed. Its small share does not cancel the hard fact."
  },
  "synthetic-duplicates": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Повтор одного canonical fact не учитывается второй раз и не меняет оценку.",
    en: "A duplicate canonical fact is counted once and does not change the score."
  },
  "synthetic-dust-spam": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Незапрошенный dust, полученный кошельком, не повышает его риск.",
    en: "Unsolicited dust received by the wallet does not raise its risk."
  },
  "synthetic-empty-wallet": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Активности USDT и подтверждённых риск-сигналов нет.",
    en: "There is no USDT activity and no confirmed risk signal."
  },
  "synthetic-key-exhaustion": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Исчерпание provider key — технический факт и не добавляет risk-баллы.",
    en: "Provider-key exhaustion is a technical fact and adds no risk points."
  },
  "synthetic-new-no-usdt": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Новый кошелёк без USDT-активности не получает риск только из-за возраста.",
    en: "A new wallet with no USDT activity receives no risk merely because of its age."
  },
  "synthetic-one-legitimate-transfer": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Найдена одна прямая легитимная биржевая операция без риск-паттерна.",
    en: "One direct legitimate exchange transfer was found without a risk pattern."
  },
  "synthetic-operational-wallet": {
    decision: "ACCEPTABLE",
    score: 5,
    ru: "Старый активный операционный кошелёк не показывает составного подозрительного паттерна. Неизвестный контрагент сам по себе даёт ноль.",
    en: "The old active operational wallet shows no composite suspicious pattern. An unknown counterparty alone contributes zero."
  },
  "synthetic-reorder": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Перестановка одинаковых входных фактов не меняет результат.",
    en: "Reordering equivalent input facts does not change the result."
  },
  "synthetic-restart": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Restart с тем же immutable evidence не дублирует риск.",
    en: "Restarting with the same immutable evidence does not duplicate risk."
  },
  "synthetic-unknown-no-pattern": {
    decision: "ACCEPTABLE",
    score: 0,
    ru: "Неизвестный источник без связанного подозрительного поведения добавляет ноль баллов.",
    en: "An unknown source without correlated suspicious behavior adds zero points."
  },
  "synthetic-victim-debit": {
    decision: "REVIEW",
    score: 50,
    ru: "Подтверждено списание у жертвы. Нужна защитная проверка, но роль жертвы не переносит на кошелёк риск получателя или drainer.",
    en: "A victim debit is confirmed. Protective review is required, but the victim role does not transfer recipient or drainer risk to the wallet."
  }
};

function parse<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function review(root: string, caseId: string): LockedReviewV2 {
  return parse<LockedReviewV2>(join(ROOT, root, caseId, "submitted-review.json"));
}

function selectedFinding(
  caseId: string,
  factId: string,
  reviews: LockedReviewV2[]
): ReviewFindingV2 {
  const candidates = reviews
    .flatMap((item) => item.findings)
    .filter((item) => item.canonicalFactId === factId);
  if (candidates.length === 0) throw new Error(`missing_reviewed_fact:${caseId}:${factId}`);
  if (factId.includes(":Bybit:")) {
    return { ...candidates[0]!, lane: "neutral" };
  }
  if (factId.includes(":Frozen at event:")) {
    return { ...candidates[0]!, lane: "hard", timing: "at_event" };
  }
  if (factId.includes(":HTX 4:")) {
    return { ...candidates[0]!, lane: "context", timing: "later" };
  }
  const priority = { hard: 0, pattern: 1, context: 2, neutral: 3 } as const;
  return [...candidates].sort((left, right) => priority[left.lane] - priority[right.lane])[0]!;
}

function resolvedFact(finding: ReviewFindingV2): ResolvedAdjudicationFactV2 {
  return {
    canonicalFactId: finding.canonicalFactId,
    lane: finding.lane,
    role: finding.subjectRole,
    directness: finding.directness,
    timing: finding.timing
  };
}

function aggregateValues(reviews: LockedReviewV2[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of reviews) {
    for (const [key, value] of Object.entries(item.dossierAggregates)) {
      result[key] ??= value;
    }
  }
  return result;
}

function exactHtml(input: {
  locale: "ru" | "en";
  subjectAddress: string;
  blockNumber: string;
  decision: Decision;
  score: number;
  summary: string;
}): string {
  const labels = input.locale === "ru"
    ? {
        title: "🧾 Проверка кошелька",
        wallet: "Кошелёк",
        ACCEPTABLE: "низкий риск",
        REVIEW: "нужна проверка",
        DECLINE: "высокий риск",
        why: "Почему такая оценка",
        snapshot: "Снимок"
      }
    : {
        title: "🧾 Wallet check",
        wallet: "Wallet",
        ACCEPTABLE: "low risk",
        REVIEW: "review required",
        DECLINE: "high risk",
        why: "Why this score",
        snapshot: "Snapshot"
      };
  const emoji = input.decision === "ACCEPTABLE" ? "🟢" : input.decision === "REVIEW" ? "🟡" : "🔴";
  return [
    `<b>${labels.title}</b>`,
    `${labels.wallet}: <code>${input.subjectAddress}</code>`,
    "",
    `${emoji} <b>${input.score}/100 — ${labels[input.decision]}</b>`,
    "",
    `<b>${labels.why}</b>`,
    input.summary,
    "",
    `<i>${labels.snapshot}: TRON #${input.blockNumber}</i>`
  ].join("\n");
}

function resolveDraft(caseId: string): void {
  const draftPath = join(ROOT, "adjudication-draft", `${caseId}.json`);
  const draft = parse<AdjudicationDraftV2>(draftPath);
  const reviews = [
    review("locked-reviewer-a", caseId),
    review("locked-reviewer-b", caseId)
  ];
  const selected = policy[caseId];
  if (!selected) throw new Error(`missing_adjudication_policy:${caseId}`);
  const bundle = parse<{
    subjectAddress: string;
    snapshot: { confirmedBlockNumber: string };
  }>(join(ROOT, "reviewer-a", caseId, "neutral-bundle.json"));
  const findings = new Map(
    draft.reviewedCanonicalFactIds.map((id) => [id, selectedFinding(caseId, id, reviews)])
  );
  const facts = [...findings.values()].map(resolvedFact);
  const aggregates = aggregateValues(reviews);
  const scoreProperties = [...new Set(reviews.flatMap((item) => item.scoreProperties))].sort();
  const terminalBoundaries = [...new Set(reviews.flatMap((item) => item.terminalBoundaries))].sort();
  const proportionalResult = reviews[0]!.attributionResults.proportional;

  draft.resolution = {
    resolvedFacts: facts,
    selectedAttributionPolicy: "proportional",
    expectedDecision: selected.decision,
    exactScore: selected.score,
    scoreProperties,
    dossierAggregates: aggregates,
    telegramExpectation: [
      {
        locale: "ru",
        exactHtml: exactHtml({
          locale: "ru",
          subjectAddress: bundle.subjectAddress,
          blockNumber: bundle.snapshot.confirmedBlockNumber,
          decision: selected.decision,
          score: selected.score,
          summary: selected.ru
        })
      },
      {
        locale: "en",
        exactHtml: exactHtml({
          locale: "en",
          subjectAddress: bundle.subjectAddress,
          blockNumber: bundle.snapshot.confirmedBlockNumber,
          decision: selected.decision,
          score: selected.score,
          summary: selected.en
        })
      }
    ],
    adjudicatorId: "codex-root-adjudicator",
    adjudicatedAt: ADJUDICATED_AT
  };

  draft.disagreements = draft.disagreements.map((item) => {
    let resolution: unknown;
    if (item.field === "decision") resolution = selected.decision;
    else if (item.field === "preferredAttributionPolicy") resolution = "proportional";
    else if (item.field === "attributionResults") resolution = proportionalResult;
    else if (item.field === "terminalBoundaries") resolution = terminalBoundaries;
    else if (item.field === "scoreProperties") resolution = scoreProperties;
    else if (item.field.startsWith("dossierAggregates.")) {
      resolution = aggregates[item.field.slice("dossierAggregates.".length)]!;
    } else {
      const match = /^findings\.(.+)\.(presence|lane|subjectRole|counterpartyRole|directness|timing|evidenceRefs)$/u
        .exec(item.field);
      if (!match) throw new Error(`unknown_disagreement:${caseId}:${item.field}`);
      const finding = findings.get(match[1]!);
      if (!finding) throw new Error(`missing_disagreement_fact:${caseId}:${match[1]}`);
      const field = match[2]!;
      resolution =
        field === "presence" ? true
          : field === "lane" ? finding.lane
            : field === "subjectRole" ? finding.subjectRole
              : field === "counterpartyRole" ? finding.counterpartyRole
                : field === "directness" ? finding.directness
                  : field === "timing" ? finding.timing
                    : finding.evidenceRefs;
    }
    if (resolution === undefined || resolution === null) {
      throw new Error(`empty_disagreement_resolution:${caseId}:${item.field}`);
    }
    return { ...item, resolution };
  });

  writeFileSync(draftPath, canonicalJson(draft), "utf8");
}

const caseIds = readdirSync(join(ROOT, "adjudication-draft"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length))
  .sort();

if (caseIds.length !== 24) throw new Error(`expected_24_cases:${caseIds.length}`);
for (const caseId of caseIds) resolveDraft(caseId);
console.log(`adjudicated ${caseIds.length} cases with proportional attribution`);
