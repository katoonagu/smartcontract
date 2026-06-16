# Telegram Bot UX: Main Menu and Core Flows

## Summary

The Telegram bot should feel like a working control panel, not a guided marketing funnel. The first screen shows the core tools immediately: wallet check, transaction check, USDT check, approvals, watched wallets, and theft reporting.

The bot must not expose admin functions. There is no admin button, command, or hidden bot entry point. Admin work stays in the web admin panel.

## Goals

- Keep frequent actions visible on the first screen.
- Let users paste an address or transaction hash without choosing a mode first.
- Use clear user-facing words instead of internal risk-engine labels.
- Keep emergency theft reporting visible without mixing it with routine checks.
- Avoid guarantees such as "safe wallet" or "clean transaction".

## Non-Goals

- No admin UI inside Telegram.
- No "risk modules" menu item on the first screen.
- No hidden admin command in the bot.
- No promise that the bot can recover stolen funds or prove absolute safety.

## Main Menu

Main menu text:

```text
TRON Guard

Проверяю TRON-адреса, транзакции и разрешения USDT.

Можно отправить адрес или tx hash прямо сюда. Для частых действий используйте кнопки.
```

Main menu buttons:

```text
Проверить кошелек    Проверить tx
Approvals            Кошельки

        Сообщить о краже

Проверить USDT       Настройки
Помощь
```

`Сообщить о краже` sits alone in the middle row. It is an emergency flow and should be easy to find under stress.

`Проверить USDT` is the final label for incoming USDT checks. The short label keeps the action visible and avoids exchange-only language.

## Free Input Routing

The bot should accept plain messages from the main screen:

- TRON address: start wallet check.
- Transaction hash: start transaction check.
- Unsupported text: ask for a TRON address, tx hash, or menu action.

The user should not need to press `Проверить кошелек` before pasting an address.

## Wallet Check

Entry points:

- `Проверить кошелек`
- plain TRON address
- follow-up buttons from tx, USDT, approvals, or wallet list results

Result template:

```text
Проверка кошелька

Адрес: T...
Итог: есть признаки риска

Что найдено:
- входящие USDT от адреса с пометкой
- активные approvals
- последние операции: 3 за 24 часа

Что можно сделать:
- проверить approvals
- добавить кошелек в наблюдение
- открыть отчет
```

Buttons:

```text
Approvals
Добавить в кошельки
Проверить tx
Открыть отчет
```

## Transaction Check

Entry points:

- `Проверить tx`
- plain transaction hash
- follow-up buttons from wallet, USDT, or theft flows

Result template:

```text
Проверка транзакции

Tx: ...
Сумма: 1 250 USDT
Откуда: T...
Куда: T...
Статус: подтверждена

Что важно:
- получатель есть в списке наблюдения
- у отправителя есть активные approvals
```

Buttons:

```text
Проверить отправителя
Проверить получателя
Открыть отчет
```

## USDT Check

Entry point:

- `Проверить USDT`

Prompt:

```text
Проверить USDT

Отправьте tx hash входящего USDT.
Я проверю сумму, отправителя, получателя, подтверждения и найденные признаки риска.
```

Result template:

```text
Входящий USDT

Сумма: 1 250 USDT
Отправитель: T...
Получатель: T...
Подтверждения: 19

Что найдено:
- отправитель новый для этого кошелька
- активных blacklist-меток не найдено
- approvals у получателя есть
```

Buttons:

```text
Проверить отправителя
Проверить получателя
Approvals
Открыть отчет
```

## Approvals

The button label stays `Approvals`, because crypto users recognize it. Inside messages, explain the term as `разрешения USDT`.

Result template:

```text
Approvals

Нашел 2 активных разрешения USDT.

1. Spender: T...
Лимит: без ограничения
Последнее использование: 12 июня

2. Spender: T...
Лимит: 500 USDT
Последнее использование: не найдено
```

Buttons:

```text
Как отозвать
Проверить spender
Обновить
```

## Wallets

`Кошельки` is the watched-wallet list, not a check result.

Template:

```text
Кошельки

4 кошелька под наблюдением.
Алерты включены для 3.

T...a91 — без новых событий
T...c02 — новый входящий USDT
T...88f — есть активные approvals
```

Buttons:

```text
Добавить кошелек
Настроить алерты
Проверить все
```

## Theft Report

Entry point:

- `Сообщить о краже`

First screen:

```text
Сообщить о краже

Что произошло?
```

Buttons:

```text
Украли USDT / активы
Подозрительная транзакция
Подписал разрешение
Не уверен
```

The bot collects only the minimum data:

1. Wallet address.
2. Transaction hash, if the user has one.
3. Lost asset: USDT, TRX, or another token.
4. When the user noticed the loss.

Result template:

```text
Заявка о краже

Кошелек: T...
Tx: ...
Статус: собираю данные

Что можно сделать сейчас:
1. Не переводите новые средства на этот кошелек.
2. Проверьте активные approvals.
3. Сохраните tx hash и адреса получателей.
```

Buttons:

```text
Проверить approvals
Проверить tx
Открыть отчет
Назад в меню
```

The theft flow should not promise recovery. It helps collect facts, check approvals, inspect transactions, and prepare a report.

## Settings

`Настройки` contains only user settings:

```text
Уведомления
Кошельки
Язык
Часовой пояс
```

No admin controls appear here.

## Help

`Помощь` contains short reference screens:

```text
Как читать результат
Что проверяет бот
Как отозвать approvals
Что делать при краже
```

`Что проверяет бот` replaces the earlier "risk modules" idea. This help screen can list active checks, beta checks, and unavailable checks, but it should not be a main menu item.

## Status Language

Use precise status labels:

```text
Признаки риска найдены
Признаков риска не найдено
Данных мало
Проверка не завершена
Источник временно не отвечает
```

Avoid absolute labels:

```text
Безопасно
Чисто
Гарантированно надежно
100% риска нет
```

## Error Handling

If the input is not recognized:

```text
Не понял сообщение.

Отправьте TRON-адрес, tx hash или выберите действие в меню.
```

If a provider is unavailable:

```text
Источник временно не отвечает.

Я покажу результат по доступным данным. Часть проверок можно повторить позже.
```

If a check is incomplete:

```text
Проверка не завершена.

Данных пока мало: не удалось получить часть транзакций. Можно открыть отчет или повторить проверку позже.
```

## Component Boundaries

- Main menu renderer: owns the first-screen text and buttons.
- Free input router: detects address, tx hash, and unsupported text.
- Check result formatters: wallet, tx, USDT, approvals.
- Theft flow state machine: collects the minimum theft-report data and produces a case summary.
- Help/settings renderers: keep explanatory and preference screens separate from checks.

These boundaries keep copy and button logic separate from forensic scoring internals.

## Testing Notes

Cover these behaviors:

- Main menu contains `Проверить USDT` and does not contain admin entry points.
- `Сообщить о краже` is a single centered row in the button layout.
- Plain address input starts wallet check.
- Plain tx hash input starts transaction check.
- Unsupported input returns the short recovery message.
- Provider errors use `Источник временно не отвечает`.
- No result formatter says `Безопасно`, `Чисто`, or `100% риска нет`.
