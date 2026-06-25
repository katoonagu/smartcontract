# Project Walkthrough Documentation

Эта папка - понятная внутренняя документация по проекту.

Цель: описать систему так, чтобы мы сами могли быстро объяснить продукт, режимы проверки, логику риска, админку и ограничения без чтения кода.

## Как Пишем

- Пишем простым языком.
- Отделяем то, что уже работает, от идей и улучшений.
- Объясняем не только "что делает", но и "зачем это нужно".
- Не прячем ограничения: если режим что-то не доказывает, так и пишем.
- Старые подробные документы оставляем как источник деталей, но основная дорожка чтения должна быть короче и понятнее.

## Рекомендуемый Порядок Чтения

1. [Purpose, Problem, And Clients](./00-purpose-and-clients.md) - зачем существует продукт и для кого он.
2. [Режимы проверки: FastCheck, DeepCheck, Where is money](./06-check-modes-fast-deep-where-is-money.md) - простая логика трех главных режимов.
3. [Жизненный цикл проверки](./10-check-lifecycle-plain-language.md) - путь от Telegram-запроса до job, worker, результата, риска и админки.
4. [Итоговый риск простым языком](./07-unified-wallet-risk-plain-language.md) - как несколько проверок превращаются в один score и decision.
5. [Как читать админку](./08-admin-forensics-console-plain-language.md) - Jobs, статусы, графы, bundles, boundary и история проверок.
6. [Глоссарий простым языком](./09-glossary-plain-language.md) - рабочие определения терминов из проверок, графов, риска и админки.
7. [Unified Wallet Risk Scoring v2](./04-unified-wallet-risk-scoring-v2.md) - техническая версия логики итогового риска.
8. [Shared Source Bundle Exposure Rerun](./05-shared-source-bundle-exposure-rerun.md) - как переиспользуется логика источников денег.
9. [Three Address Score Comparison](./03-three-address-score-comparison.md) - примеры сравнения нескольких адресов.

## Подробные И Исторические Материалы

- [Address Check Layers: Fast Check](./01-address-check-fast-check.md) - большой подробный документ. Сейчас в нем также есть много деталей по Deep Research и Where Is Money.
- [Unified Score DB Job Case Study](./02-unified-score-db-job-case-study.md) - разбор старых сохраненных проверок и пересчета риска.

Новые главы должны постепенно забирать из старых документов самое важное и переписывать это нормальным человеческим языком.
