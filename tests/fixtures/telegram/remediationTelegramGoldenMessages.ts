export const REMEDIATION_TELEGRAM_GOLDEN_MESSAGES = {
  GOLDEN_FINAL_AML: `🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

🔴 <b>90/100 — критический риск</b>
Операцию не проводить.

🔎 <b>Почему такая оценка</b>
Кошелёк отправил 1 176 317 USDT на <a href="https://tronscan.org/#/address/TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm">TWGC…TdTm</a> — 100% исходящей суммы, 2 перевода.
Сейчас этот получатель находится в чёрном списке USDT; его заблокировали после этих переводов.

💸 <b>Движение денег</b>
<a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a> → <a href="https://tronscan.org/#/address/TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm">TWGC…TdTm</a>: 1 176 317 USDT (100%, 2 перевода).
83% проверяемой суммы поступило через мост или обменный сервис; до общего пула источник не разделяется по клиентам.

<b>Покрытие</b>
Доступно 24 входящих перевода. К выбранной сумме относятся 10.
Ещё 14 проверены, но исключены: это подтверждённые технические GasFree-комиссии.`,

  GOLDEN_WHERE_PRELIMINARY: `🧾 <b>Откуда деньги — предварительный результат</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

🟠 <b>Предварительный риск: 78/100</b>

🔎 <b>Почему такая оценка</b>
83% выбранной суммы пришло через кроссчейн-мост с общей ликвидностью.
После такого сервиса более ранний источник сложнее отделить от переводов других клиентов.

💸 <b>Движение денег</b>
<a href="https://tronscan.org/#/address/TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV">TBXS…XPdV</a> → <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>: 976 891,047722 USDT (83%).

<b>Покрытие</b>
К выбранной сумме относятся 10 входящих переводов; прослежено 83% суммы.
Оставшиеся 17% не удалось связать с подтверждённым источником.`,

  GOLDEN_NO_FINAL_TECHNICAL: `🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

⚪ <b>Итоговая оценка не рассчитана</b>

🔎 <b>Что произошло</b>
Источник данных не отдал старые переводы, необходимые для расчёта.

<b>Покрытие</b>
К проверяемой сумме отобрано 10 входящих переводов.
Общее число доступных переводов в этом результате не сохранено.
До повторной проверки не проводите операцию.`,

  GOLDEN_TRUE_NO_ACTIVITY: `🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP">TRiv…MnxP</a>

⚪ <b>Оценка не рассчитана</b>

🔎 <b>Что нашли</b>
В проверенном периоде нет входящих переводов основной суммы, происхождение которых можно оценить.
Технические комиссии не считаются движением основной суммы.`,

  GOLDEN_VERIFY20_ACTIVE_NO_DEBIT: `🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK">TFag…nXzK</a>
Разрешение на управление USDT сейчас: активное, безлимитное; подтверждено напрямую в официальном контракте USDT.
Фактическое списание через этот контракт: не найдено.

🔴 <b>90/100 — критический риск для кошелька</b>

🔎 <b>Почему такая оценка</b>
Контракт имеет точный Verify20-шаблон массовых списаний с множества кошельков.
Контракту доступен текущий баланс: 4 084,665 USDT.
Связи кампании и BTTOLD-последовательность — контекст, а не доказательство кражи.

🧭 <b>Что делать</b>
Если вы проверяете чужой кошелёк — не переводите на него деньги, пока владелец не объяснит и не отзовёт опасное разрешение.`,

  GOLDEN_VERIFY20_EXACT_DEBIT: `🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK">TFag…nXzK</a>
Разрешение на управление USDT сейчас: активное, безлимитное; подтверждено напрямую в официальном контракте USDT.
Фактическое списание через этот контракт: подтверждено, 13 302 USDT.

🔴 <b>95/100 — критический риск для кошелька</b>

🔎 <b>Почему такая оценка</b>
Найдена точная Verify20-цепочка и списание USDT через этот контракт.
Контракту доступен текущий баланс: 4 084,665 USDT.
Это подтверждает движение средств, но само по себе не доказывает кражу и не показывает, кто управлял операцией.

🧭 <b>Что делать</b>
На отслеживаемом кошельке найдено активное разрешение. Если это ваш кошелёк — отзовите разрешение на управление USDT и до этого не пополняйте его.`,

  GOLDEN_BRIDGERS_ACTIVE: `🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s">TPwe…Et5s</a>
Разрешение на управление USDT сейчас: активное, безлимитное; подтверждено напрямую в официальном контракте USDT.
Списание через этот контракт: 91,103009 USDT в подтверждённом swap.

🟢 <b>10/100 — низкий риск для кошелька</b>

🔎 <b>Почему такая оценка</b>
Кошелёк сам запустил успешный обмен через Bridgers через 66 секунд после выдачи доступа; сумма совпала.

🧭 <b>Что делать</b>
Swap объяснён. Если это ваш кошелёк, неиспользуемое разрешение можно отозвать как цифровую гигиену.`,

  GOLDEN_BRIDGERS_ZERO: `🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s">TPwe…Et5s</a>
Разрешение на управление USDT сейчас: 0 USDT; подтверждено напрямую в официальном контракте USDT.
Списание через этот контракт: 91,103009 USDT в ранее подтверждённом обмене.

🟢 <b>0/100 — разрешение больше не активно</b>

🔎 <b>Вывод</b>
Обмен через Bridgers объяснён. Разрешение на управление USDT равно нулю, действий не требуется.`,

  GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN: `🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s">TPwe…Et5s</a>
Разрешение на управление USDT сейчас: подтвердить не удалось; нельзя считать его активным или отозванным.
Ранее кошелёк выдавал этому контракту доступ к USDT. Текущее списание через него не подтверждено.

⚪ <b>Текущий риск для кошелька не рассчитан</b>

🔎 <b>Почему</b>
Прямой запрос разрешения к официальному контракту USDT завершился ошибкой.

🧭 <b>Что делать</b>
Если вы проверяете чужой кошелёк — попросите владельца подтвердить текущее разрешение на управление USDT.`,

  GOLDEN_USDD_PSM: `🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

🟡 <b>45/100 — требуется проверка</b>

🔎 <b>Почему такая оценка</b>
83% проверяемой суммы пришло из USDD PSM — децентрализованного сервиса обмена USDT и USDD с общей ликвидностью.
После общего пула более ранний источник сложнее отделить от переводов других пользователей.

💸 <b>Движение денег</b>
<a href="https://tronscan.org/#/address/TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ">TSUY…12sQ</a> → <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>: 976 891,047722 USDT (83%, 1 перевод).

<b>Покрытие</b>
К выбранной сумме относятся 10 входящих переводов; прослежено 83% суммы.`,

  GOLDEN_GASFREE_ACCOUNT: `🧾 <b>Проверка контракта</b>
Кошелёк: <a href="https://tronscan.org/#/address/TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP">TRiv…MnxP</a>

🟢 <b>10/100 — низкий риск контракта</b>

🔎 <b>Что нашли</b>
Это GasFree Account — сервисный контракт для переводов USDT с оплатой комиссии через провайдера.
Точных признаков Verify20, опасного разрешения на управление USDT или списания USDT не найдено.

🧭 <b>Вывод</b>
Сам GasFree-статус не повышает AML-риск. Переводы этого адреса продолжают оцениваться как обычные денежные потоки.`
} as const;

export type RemediationTelegramGoldenId = keyof typeof REMEDIATION_TELEGRAM_GOLDEN_MESSAGES;

export const REMEDIATION_TELEGRAM_GOLDEN_IDS = Object.freeze(
  Object.keys(REMEDIATION_TELEGRAM_GOLDEN_MESSAGES) as RemediationTelegramGoldenId[]
);
