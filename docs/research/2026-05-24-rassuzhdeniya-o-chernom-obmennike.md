# Рассуждения о черном обменнике

Дата: 2026-05-24

Источник: голосовые сообщения из `C:\Users\User\Downloads`.

Важно: это машинная расшифровка через локальный Whisper. Сомнительные места помечены как `[проверить]`, чтобы не фиксировать распознавание как точный факт.

## Расшифровка

> Смотри, видишь кошелек, вот этот JMH https://tronscan.org/#/address/TCByDHmom85mQMiwvh6Yy8gQVdQyZ7CjMh/transfers , видишь кошелек? Этот кошелек фигурирует, именно этот кошелек этого обменника.



> И если у тебя деньги уходят на этот кошелек в конечном итоге, через 2-3-4 цепочки, через 2-3-4 шага, то это благо (обменник черный).


> И когда вот так выходит, я сразу из этой суммы (транзакции) отнимаю 3,5% и ищу через 20 минут эту же транзакцию либо с HTX-вывода, там у них есть свой адрес, либо с Bybit-вывода.



> И нахожу с вероятностью 100% все за кошелек. Вот именно каким способом.



> Ну и в целом у них просто, знаешь, чаще всего они не меняют свои алгоритмы. Они `[проверить фразу]` и гоняют долгое время.





## Смысловая выжимка

- Есть конкретный TRON-кошелек, который стабильно фигурирует как кошелек одного и того же черного обменника.
- Если проверяемый адрес получает или отправляет средства так, что в конечном итоге путь через 2-4 hop приходит к этому кошельку, это должно быть отдельным forensic risk context signal.
- Паттерн может повторяться: обменник долго не меняет алгоритм и адреса, поэтому seed-address watchlist имеет практический смысл.
- Практическая ручная эвристика: при выходе через такой обменник смотреть сумму с поправкой примерно `3.5%` и искать похожий вывод через около `20 минут`, особенно с HTX или Bybit withdrawal address.
- Нужна осторожная формулировка: это не доказательство, а `known high-risk exchanger proximity / inbound provenance candidate`.

## Продуктовые заметки

- Такой адрес лучше хранить не только как плоский `address_labels`, а как assertion/watchlist entry:
  - `chain = tron`;
  - `address`;
  - `entity_name`;
  - `category = high_risk_exchange`;
  - `role = output_wallet | hot_wallet | collector | unknown`;
  - `confidence`;
  - `severity`;
  - `source_name`;
  - `source_url`;
  - `notes`;
  - `first_seen`, `last_seen`;
  - `evidence_json`.
- В `/check <address>` и Phase 10A deep forensic job это должно попадать в inbound provenance:
  - direct exposure: `risky_exchange -> subject`;
  - 2-hop exposure: `risky_exchange -> intermediate -> subject`;
  - later: 3-4 hop exposure with stricter caps and stronger false-positive controls.
- Report wording:
  - `Inbound funds have upstream exposure to known high-risk exchange infrastructure within N hops; manual review required.`
  - `Public-chain continuity should not be assumed after CEX/service boundary.`
  - Не использовать формулировки вроде `fraud proven` или юридические выводы.

## Дополнительная расшифровка

### audio_2026-05-24_21-19-35.ogg

> Блин, звонят постоянно. Короче, он принимает на себя бабки и потом тут попереводит их автоматом на следующий адрес. И вот они там через 4-5 адресов заходят все наши. Они просто перманентно заходят, заходят без окончания края.

## Дополнительная смысловая заметка

- Появляется отдельный паттерн: exchange/обменник может работать как автоматический транзитный узел.
- Адрес принимает входящие средства и автоматически переводит их на следующий адрес.
- Связь может проявляться не на 2 hop, а на 4-5 hop, поэтому 2-hop MVP должен быть расширяемым до 3-4/5 hop в deep mode.
- Для 4-5 hop нужен не обычный широкий BFS, а bounded/progressive search:
  - known seed addresses черного обменника;
  - temporal ordering;
  - amount preservation с учетом комиссии/процента;
  - stop на CEX/service boundaries;
  - cautious wording: `known high-risk exchanger proximity candidate; manual review required`.

## Дополнительная расшифровка 2

### audio_2026-05-24_21-37-19.ogg

> Да, примерно так. Но знаешь, какая у них система? У них, видимо, цепочка такая: они могут, например, принять деньги на HTX, а тебе выплата приходит с Bybit. То есть по сути происходит прерывание цепочки.
>
> Или у них на HTX может быть несколько аккаунтов. Мы же не знаем, с какого именно аккаунта эти деньги выходят. Они могут принять деньги на один аккаунт HTX, потом внутри HTX сделать перевод на другой аккаунт, и уже с этого аккаунта сделать вывод.
>
> Тогда у тебя тоже не будет прямой связи между вводом и выводом. То есть все равно будет прерывание цепи.

### audio_2026-05-24_21-37-33.ogg

> Но в целом ты правильно все понял: деньги мошенника попадают на этот адрес, который ты указал. Потом они оттуда идут на следующий адрес, вот этот `JHH/JMH` `[проверить точное название или фрагмент адреса]`. И потом через 2-3 адреса они уходят на HTX.

### audio_2026-05-24_21-37-38.ogg

> Просто представь, брат: мы почти полгода, ну не полгода, месяца три потратили на то, чтобы просто установить, что это за обменник. И когда мы это установили, тогда начали копать еще глубже и нашли этот `[континентай / проверить термин]`. Капец просто.

## Дополнительная продуктовая заметка 2

- Важный false-negative риск: связь может намеренно обрываться через CEX internal transfer.
- Пример: средства заходят на HTX, затем внутри HTX переводятся между аккаунтами, а наружу выходят уже с другого HTX-аккаунта или вообще через Bybit.
- Поэтому для forensic report нельзя обещать continuous public-chain trace через CEX. Правильная формулировка:
  - `Funds reached CEX/service boundary; public-chain continuity should not be assumed.`
  - `A later withdrawal with similar amount/time pattern may be an inferred off-chain continuation candidate, not confirmed on-chain evidence.`
- Для known high-risk exchanger watchlist это означает:
  - exact on-chain path до seed-address или от seed-address считается сильным public-chain evidence;
  - переход через HTX/Bybit является boundary;
  - совпадение суммы после комиссии и времени после CEX withdrawal можно хранить только как weak inferred continuation;
  - в score это должно быть ниже, чем direct/2-hop on-chain provenance.
