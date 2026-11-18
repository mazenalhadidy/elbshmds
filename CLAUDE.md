# CLAUDE.md — read this first (owner's rules and the project's decisions)

This repo has two apps for «محل الباشمهندس» (a mobile / e-wallet shop in Egypt):
- **The shop app** (repo root): Vue 3 + Pinia front end (`web/`), Node/Express back end (`server/`),
  local SQLite + Turso online copy, shared accounting rules (`shared/`). Runs on the shop PC; phones open it.
- **The AI debt checker** (`ai-tool/`): reads WhatsApp chats / pictures and writes the final calculation. Netlify or local.

Architecture, formulas and tables: `docs/ARCHITECTURE.md`. AI tool: `ai-tool/README.md`. Do NOT re-design what is
described there; extend it. Every change is small and in the existing style.

## How to work with the owner
- **Never push to GitHub** unless he asks in that message. Commit on the working branch, then give him a zip:
  `git archive --format=zip --prefix=elbshmds/ -o <scratchpad>/elbshmds-vX.Y.zip HEAD`
  (and `HEAD:ai-tool` with prefix `wa-debt-checker/` when the AI tool changed).
- **The two zips are ALWAYS the last thing of every final reply**: the shop zip (above) AND the ready AI zip
  (`npm --prefix ai-tool run package` → `ai-tool/release/wa-debt-checker.zip`, copied to `<scratchpad>/wa-debt-checker-READY.zip`),
  even when only one app changed.
- **Screenshots**: none while working. At the END of the reply, send the screenshots you took while testing
  (phone 390 px first). Send others only when he asks.
- Ask only when a choice really changes the result; otherwise decide and say so briefly.
- Reply in English, short and plain; Arabic only for the exact UI words.
- Before finishing: `npm run lint`, `npm test`, `npm run build` (and `npm --prefix ai-tool test` if the AI tool changed).
  Check the screen in the browser (Playwright, phone 390 px and 1280 px) — measure, don't guess.

## UI rules (he asked for each of these)
- Language: **Modern Standard Arabic** (not Egyptian dialect) in the UI and in the AI's instructions/explanations.
  Exception: quoted examples of real chat messages keep their dialect wording («الحساب كده», «ابعتلي ٥٠٠»).
- **No obvious instructions** on screen (no "write this here", no "(مطلوب)", no explaining what a button does).
  Keep only errors, «وضع المشاهدة فقط», and real warnings, short.
- **No minus signs for عجز / زيادة**: the word says which (عجز or زيادة, never «العجز/الزيادة» as a value)
  and the colour (red عجز, green زيادة). Cumulative: «عجز تراكمي» / «زيادة تراكمية».
- In the day summary the day's عجز/زيادة row is coloured entirely; in the cumulative group only the word and number.
- Words: «ديون» (not الديون على المحل), «المكن» (not رصيد ماكينات الشبكة).
- اليومية (inputs/outputs/sales): amounts aligned to the **right**.
- Calculations written like a calculator (AI tool final result): **left-to-right**, a line breaks only between numbers,
  never inside a number, and a new line starts with its sign (`+53,000`).
- Tables (e.g. العجوزات): right-to-left, titles on ONE line, ONE thick row per record, must fit a 360 px phone.
- «التفاصيل» toggles are a small round arrow (no text).
- الحسابات: العملاء on the right, المحافظ on the left. The first field of each table also searches it
  (wallet: any number containing the typed digits; names: Arabic-insensitive); an exact ACTIVE duplicate is refused
  («هذا الرقم موجود بالفعل» / «هذا الاسم موجود بالفعل»). Only clients have the calculator; ديون are typed directly.
- A value changed after a day was closed is shown **crossed out next to the new value**.

## Accounting decisions (do not change without asking)
- diff = التصفية الافتراضية − التصفية الحقيقية; positive = عجز. Real total of a day = تصفية البارحة of the next day.
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
- **Closing a day**: blocked until today's cash or المكن is typed (0 counts). A date before the last saved day is
  allowed, with a warning in the close dialog.
- **Late changes** (written offline for a day that was closed meanwhile): the closed day is NEVER changed by itself.
  The server keeps them (table `late_ops`, no message on the phone) behind «تغييرات متأخرة (n)» on «التصفية»:
  per change «أضف» (into its saved day, password, flows like a calendar edit) or «ارفض»; also «أضف الكل» /
  «ارفض الكل». A change that no longer fits its day stays in the list with the reason.
- Renaming / restoring an item can never create two ACTIVE items of the same type with the same name.
- Database: never edit an old migration; add a new one at the end of `server/db/schema.js`.

## AI tool decisions (`ai-tool/`)
- Prompts, rules and JSON schemas live on the server (`lib/ai.js`); the page sends a task name. Prompt caching on.
- Input: WhatsApp export (.zip/.txt) OR pictures + pasted messages.
- Ready-to-use Windows package: `npm --prefix ai-tool run package` → `ai-tool/release/wa-debt-checker.zip`
  (START.cmd, one bundled server file, only Node.js needed). Give him that zip when the AI tool changes.
- Start: two options — «ابحث عنها بنفسك» (the AI finds the last account closing by meaning, no keyword) or
  «أنا أحددها» (start text/picture, searched from the END of the chat). «ابدأ من هنا» on any message.
- Who is the shop: judged by the AI in EVERY chat (names can change); past answers are evidence, not rules;
  a known name that seems to switch side is never changed silently. Auto-start when everyone is known and ≥3 runs.
- Split transfers («تم ٥٠٠٠٠» after receipts) count once; a calculator statement is the start and is checked against
  the chat; terms older than the chat are "before the chat", not errors.

## CI/CD
`.github/workflows/ci.yml`: lint, tests (Node 22/24 + Windows), build, Docker image, AI-tool tests, `release-gate`.
The shop PC's updater installs a commit only if `release-gate` passed. Keep CI green.
