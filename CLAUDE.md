# CLAUDE.md — read this first (owner's rules and the project's decisions)

The shop app of «محل الباشمهندس» (a mobile / e-wallet shop in Egypt): Vue 3 + Pinia front end (`web/`),
Node/Express back end (`server/`), local SQLite + Turso online copy, shared accounting rules (`shared/`).
Runs on the shop PC; phones open it. The AI debt checker is a SEPARATE repository: `mazenalhadidy/wa-debt-checker`.

Architecture, formulas and tables: `docs/ARCHITECTURE.md`. Do NOT re-design what is
described there; extend it. Every change is small and in the existing style.

## How to work with the owner
- **Always push** every finished change (he asked): the working branch AND `main` (on the shop PC «تحديث متاح»
  appears once CI's `release-gate` passed). Also give him the zip:
  `git archive --format=zip --prefix=elbshmds/ -o <scratchpad>/elbshmds-vX.Y.zip HEAD`.
- **The two zips are ALWAYS the last thing of every final reply**: the shop zip (above) AND the ready AI zip
  (in the wa-debt-checker repo: `npm run package` → `release/wa-debt-checker.zip`, copied to
  `<scratchpad>/wa-debt-checker-READY.zip`), even when only one app changed.
- **Screenshots**: none while working. At the END of the reply, send the screenshots you took while testing
  (phone 390 px first). Send others only when he asks.
- Ask only when a choice really changes the result; otherwise decide and say so briefly.
- Reply in English, short and plain; Arabic only for the exact UI words.
- Before finishing: `npm run lint`, `npm test`, `npm run build` (and `npm test` in wa-debt-checker if it changed).
  Check the screen in the browser (Playwright, phone 390 px and 1280 px) — measure, don't guess.
- **Solid first**: `tests/cascade.test.js` (random weeks, every kind of past-day edit / تعويض, each day compared with a
  replay from scratch) must stay green, and `tests/e2e/walk.cjs` (the real screens, two days, an edit of the previous
  day, a تعويض, every page at 390/768/1280) must print ALL PASSED before a release. Extend both with every new feature.
  (cascade.test.js runs on Linux only: on Windows the test process crashes after ~40 test databases in a row.)
  `tests/e2e/mobile.cjs` (a real phone profile) must print ALL PASSED too.

## UI rules (he asked for each of these)
- Language: **Modern Standard Arabic** (not Egyptian dialect) in the UI and in the AI's instructions/explanations.
  Exception: quoted examples of real chat messages keep their dialect wording («الحساب كده», «ابعتلي ٥٠٠»).
- **No obvious instructions** on screen (no "write this here", no "(مطلوب)", no explaining what a button does).
  Keep only errors, «وضع المشاهدة فقط», and real warnings, short.
- **No minus signs for عجز / زيادة**: the word says which (عجز or زيادة, never «العجز/الزيادة» as a value)
  and the colour (red عجز, green زيادة). Cumulative: «عجز تراكمي» / «زيادة تراكمية».
- In the day summary the day's عجز/زيادة row is coloured entirely; in the cumulative group only the word and number.
- Words: «ديون» (not الديون على المحل), «المكن» (not رصيد ماكينات الشبكة).
- اليومية: المبيعات on the right, المدخلات in the middle, المخرجات on the left (same order in the phone tabs);
  amounts aligned to the **right**.
- Calculations written like a calculator (AI tool final result): **left-to-right**, a line breaks only between numbers,
  never inside a number, and a new line starts with its sign (`+53,000`).
- Tables (e.g. العجوزات): right-to-left, titles on ONE line, ONE thick row per record, must fit a 360 px phone.
- «التفاصيل» toggles are a small round arrow (no text).
- Every screen is checked at phone, tablet and computer widths: columns only where each one fits whole (measure).
- الحسابات: العملاء (right) · المحافظ (middle) · الديون (left), side by side from 1000 px (narrower: tabs); each list has
  ONE fixed height (the page never jumps while searching). The first field of each table also searches it (letters
  and digits, Arabic-insensitive, spaces ignored); an exact ACTIVE duplicate is refused (same `sameKey`; the same
  number with different text is another wallet). Clients and ديون are ONE list of people (one item type `client`, one signed balance:
  + he owes the shop → العملاء, − the shop owes him → الديون shown positive; at 0 he stays where the day started). A
  person moves by himself when his balance crosses 0. Typing a name in one table shows matching people of the other one;
  picking him opens his calculator in his own direction. Same table: التغيير | النهائي (the value
  from before is not shown). التغيير = the calculator (as it always was, same look). Tapping النهائي and typing the new
  value saves the difference as today's change. A new client/debt starts with change 0. Sorted by the balance
  (largest first), zero balances at the bottom.
- Delete buttons: red outline icons (never filled), with a confirmation or «تراجع».
- الإدارة: الثوابت is a normal table right under النقدية والمكن. Every other device in «الهواتف والأجهزة المتصلة» has a
  red «فصل» (password): its login stops at once (`data/disconnected-devices.json`); it can log in again with the password.
- Jumping between fields (never in المحافظ): اليومية and الإضافة/الخصم — letters typed after the amount go on in the
  name/reason field (which may hold digits); العملاء / الديون / الثوابت — digits typed after the name go to the amount.
- **Phones** (`web/lib/mobile.js`, `(pointer: coarse)`): fields 16 px (no zoom); every field has its Enter key
  (`enterkeyhint` التالي / تم) and Enter moves to the next field; after adding, the cursor is back on the first field
  (the keyboard stays open); in اليومية on a phone Enter on the amount goes to the name (no letters on the number
  keyboard), Enter there adds (a real keyboard: Enter adds at once). While typing the bottom menu hides and the field
  is scrolled to the middle; buttons ≥ 40 px (small arrows / the status circle get a larger invisible touch area);
  pulling the page down does not reload it.
- A value changed after a day was closed is shown **crossed out next to the new value**.

## Accounting decisions (do not change without asking)
- A client/debt value is ALWAYS start + today's change (`rowFinal`), never a stored value (a fallback once kept stale
  values in the days after an edited day — v3.32–3.37; repaired once at start: `repair_flow_v1`).
- diff = التصفية الافتراضية − التصفية الحقيقية; positive = عجز. Real total of a day = تصفية البارحة of the next day.
- Exception: when the day before today was NOT saved, the open day's تصفية البارحة can be typed (✎, `setOpening` with
  `gap`, checked by the server). It is kept (`days.opening_manual`) when earlier days change; the next day is normal.
- Until today's cash or network is typed, the day shows «بانتظار عدّ النقدية» (no fake shortage).
- **العجوزات** (`web/pages/DeficitsPage.vue`, route `/settle/deficits`): one row per saved day with «تعويض».
- **تعويض** (`CompensateDialog.vue`, `POST /api/days/:id/compensate`, table `compensations`): a signed amount added to
  ONE category TOTAL of a saved day's summary (sales/input/output → profit → افتراضية; wallets/clients/cash/المكن (+),
  ديون/ثوابت (−) → حقيقية). The day's tables are never changed. It **flows to every later day** exactly like a calendar
  edit. The day's note is edited with it; only the added part is stored with the compensation. Password required.
- `days.orig` = values the day was closed with. A changed day crosses out every changed value and lists its changes at
  the end of its summary (التاريخ | التغيير | الملاحظة); calendar edits are listed too, dated with the day itself.
  Later days changed only by an earlier day cross out ONLY تصفية البارحة.
- تعويض is ONLY for saved (closed) days: the open day is changed directly and has no عجز/زيادة until it is closed.
- A wrong تعويض is deleted from the saved day's changes table (password); later days go back.
- **Closing a day**: blocked until today's cash or المكن is typed (0 counts) AND every active client / debt has
  today's change written (0 counts) — `unchecked()` in the engine, checked by the server too. A date before the last saved day is
  allowed, with a warning in the close dialog.
- **Late changes** (written offline for a day that was closed meanwhile): the closed day is NEVER changed by itself.
  The server keeps them (table `late_ops`, no message on the phone) behind «تغييرات متأخرة (n)» on «التصفية»:
  per change «أضف» (into its saved day, password, flows like a calendar edit) or «ارفض»; also «أضف الكل» /
  «ارفض الكل». A change that no longer fits its day stays in the list with the reason.
- Renaming / restoring an item can never create two ACTIVE items of the same type with the same name.
- Database: never edit an old migration; add a new one at the end of `server/db/schema.js`.

## Updates (shop PC)
- The launcher (`scripts/updater.js`) only PREPARES a new version from GitHub `main` (download, install, build,
  tests). Nothing is installed by itself: the app shows «تحديث متاح»; it installs only after the button + the
  update password (`UPDATE_PASSWORD` in `.env`, chosen by the owner; not the login password).
- The switch must never lose data: graceful stop (requests finish, last Turso push, DB closed), DB copied to
  `data/backups/before-update-<sha>/`, new version started; if it is not healthy the copy is put back and the old
  version starts. Phones keep unsent changes on the phone and send them after (same opId, never twice).

## CI/CD
`.github/workflows/ci.yml`: lint, tests (Node 22/24 + Windows), build, Docker image, `release-gate`.
«تحديث متاح» appears only for a commit whose `release-gate` passed. Keep CI green.
