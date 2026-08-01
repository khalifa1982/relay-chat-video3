import type { Entry } from "./types";

/**
 * Strings owned by the ADMIN CONSOLE (`pages/app/Admin.tsx`).
 *
 * One module per surface — see `dict/index.ts` for why.
 *
 * ── THE THREE ACCOUNT TIERS GET THREE DIFFERENT ARABIC WORDS ──────────────────────
 * ضيف / مسجّل / مشرف. They are three different things the server can actually express
 * (`users.role`, and the absence of a `users` row at all), and this console's whole job
 * is moving somebody between them — so collapsing any two onto one Arabic word would
 * make the segmented control read as a no-op in the language where nobody would notice.
 *
 * THEIR ENGLISH HALVES ARE NOT FREE TEXT: they must stay byte-identical to what
 * `roleLabel()` (app/VerifiedBadge.tsx) returns, because the row tag and the badge
 * beside it are the SAME fact and must not come to disagree about the word. That file
 * is outside this sweep, so the agreement is held by an assertion in
 * `adminLocale.test.ts` rather than by a shared function — which is the stronger of the
 * two anyway, since it also fails if somebody edits VerifiedBadge.
 *
 * ── DELETE IS NOT WITHDRAW, AND NEITHER IS "REMOVE" ───────────────────────────────
 * حذف is the irreversible purge of a person; سحب is taking back a registration
 * suggestion, which costs nobody anything. v2.105.27 established that this repo keeps
 * such verbs apart in Arabic; the same rule applies to a console where one of them
 * cannot be undone.
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ELSE ────────────────────────────────────────────
 * Every number here is interpolated — counts, a 6-digit RELAY number, a percentage, a
 * date — so it stays Western for the reason v2.106.84 recorded: a substituted "6"
 * beside an Arabic-Indic numeral on one line reads as a rendering fault. A RELAY number
 * also has to be the number somebody reads out loud and then types.
 *
 * ── ENVIRONMENT VARIABLES AND PRODUCT NAMES ARE NEVER TRANSLATED ──────────────────
 * `REDIS_URL`, `APNS_P8_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `VOIP_NODE_SECRET`,
 * `EXPO_ACCESS_TOKEN`, `TLS`, `STUN`, `TURN`, `RELAY`, `Firebase`, `Expo`, `Redis`,
 * `Mediasoup`, `WebRTC` are things an operator types or greps for. Translating one
 * would send them looking for a file that does not exist, which is the exact failure
 * this console exists to prevent.
 */
export const ADMIN = {
  // ── Page chrome ──────────────────────────────────────────────────────────────
  "admin.title": { en: "Admin", ar: "الإدارة" },
  "admin.chip": { en: "ADMIN", ar: "مشرف" },
  "admin.chipTitle": {
    en: "You are signed in as a RELAY administrator",
    ar: "أنت مسجَّل الدخول كمشرف على RELAY",
  },

  // ── The gate ─────────────────────────────────────────────────────────────────
  "admin.onlyTitle": { en: "Administrators only", ar: "للمشرفين فقط" },
  "admin.onlyBody": {
    en: "This account doesn't hold the admin role. Nothing on this page is available to it.",
    ar: "هذا الحساب لا يملك صلاحية الإشراف. لا شيء في هذه الصفحة متاح له.",
  },

  // ── Stat tiles ───────────────────────────────────────────────────────────────
  "admin.stat.users": { en: "Users", ar: "المستخدمون" },
  "admin.stat.guests": { en: "Guests", ar: "الضيوف" },
  /* "Parties" counts call PARTICIPANTS, not calls — the landing page calls the same
     figure "Call parties". The Arabic says the same thing rather than "مكالمات", which
     would be a number that is wrong about the thing it names. */
  "admin.stat.parties": { en: "Parties", ar: "أطراف المكالمات" },
  "admin.stat.online": { en: "Online", ar: "متصل" },

  // ── Search ───────────────────────────────────────────────────────────────────
  "admin.search.placeholder": {
    en: "Find a person — name or number",
    ar: "ابحث عن شخص — بالاسم أو الرقم",
  },
  "admin.search.aria": { en: "Find a person", ar: "ابحث عن شخص" },
  "admin.search.submit": { en: "Find", ar: "بحث" },
  "admin.blurb": {
    en: "Changing a number updates everyone who saved it. Messages, calls, contacts and statuses all stay with the person — only the number moves, and the old one is never reissued to anybody else.",
    ar: "تغيير الرقم يُحدِّثه لدى كل من حفظه. تبقى الرسائل والمكالمات وجهات الاتصال والحالات مع صاحبها — الرقم وحده هو ما ينتقل، والرقم القديم لا يُمنح لأحد آخر أبدًا.",
  },

  // ── List states ──────────────────────────────────────────────────────────────
  "admin.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
  /* Three different answers, never one: a failed search, an empty search and an empty
     database need three different next steps. */
  "admin.noMatches": { en: "Nobody matches “{query}”.", ar: "لا أحد يطابق «{query}»." },
  "admin.noneYet": { en: "No identities yet.", ar: "لا هويات بعد." },
  "admin.unnamed": { en: "Unnamed", ar: "بلا اسم" },

  // ── The three account tiers ──────────────────────────────────────────────────
  /* The English halves MUST equal roleLabel() — see the header. */
  "admin.tier.guest": { en: "Guest", ar: "ضيف" },
  "admin.tier.registered": { en: "Registered", ar: "مسجّل" },
  "admin.tier.admin": { en: "Admin", ar: "مشرف" },

  // ── The per-row ⋮ menu ───────────────────────────────────────────────────────
  "admin.row.toolsFor": { en: "Account tools for {who}", ar: "أدوات حساب {who}" },
  "admin.menu.title": { en: "Account tools", ar: "أدوات الحساب" },
  "admin.menu.changeNumber": { en: "Change number", ar: "تغيير الرقم" },
  "admin.menu.hideNumber": { en: "Hide number editor", ar: "إخفاء محرّر الرقم" },
  "admin.menu.notifications": { en: "Notifications", ar: "الإشعارات" },
  "admin.menu.hideNotifications": { en: "Hide notifications", ar: "إخفاء الإشعارات" },
  "admin.menu.accountType": { en: "Account type", ar: "نوع الحساب" },
  "admin.menu.hideAccountType": { en: "Hide account type", ar: "إخفاء نوع الحساب" },
  "admin.menu.deleteAccount": { en: "Delete account", ar: "حذف الحساب" },
  "admin.menu.hideDelete": { en: "Hide delete", ar: "إخفاء الحذف" },

  // ── Delete (the one irreversible thing on this screen) ───────────────────────
  "admin.delete.label": { en: "Delete this account", ar: "حذف هذا الحساب" },
  "admin.delete.warning": {
    en: "Delete this person completely. This cannot be undone.",
    ar: "احذف هذا الشخص نهائيًا. لا يمكن التراجع عن ذلك.",
  },
  "admin.delete.bulletData": {
    en: "Their messages, threads, contacts, stories, call log and devices go.",
    ar: "تُحذف رسائلهم ومحادثاتهم وجهات اتصالهم وقصصهم وسجل مكالماتهم وأجهزتهم.",
  },
  "admin.delete.bulletThreads": {
    en: "Anyone who was in a 1:1 chat with them loses that conversation from their own inbox. Group chats survive for their other members.",
    ar: "كل من كان في محادثة ثنائية معهم يفقد تلك المحادثة من صندوق وارده. أما محادثات المجموعات فتبقى لبقية أعضائها.",
  },
  /* The number is a NODE, not a substituted string: it is six Western digits inside an
     Arabic sentence and has to be LTR-isolated or its parts reorder. `tn` keeps the
     placeholder inside the sentence so Arabic can put it where the language wants. */
  "admin.delete.bulletNumber": {
    en: "{number} is retired for good — it is never handed to anybody else.",
    ar: "يُسحب الرقم {number} نهائيًا — ولا يُمنح لأي شخص آخر أبدًا.",
  },
  "admin.delete.bulletFiles": {
    en: "Files they sent stay in storage and stay locked shut. Their profile photo stays too — no more readable than before, but not erased.",
    ar: "تبقى الملفات التي أرسلوها في التخزين وتبقى مُقفلة. وتبقى صورة ملفهم الشخصي أيضًا — دون أن تصبح مقروءة أكثر من ذي قبل، لكنها لا تُمحى.",
  },
  "admin.delete.bulletBlocks": {
    en: "A block anyone placed on them stays in place.",
    ar: "يبقى أي حظر وضعه أحد عليهم ساريًا كما هو.",
  },
  "admin.delete.typeToEnable": {
    en: "Type their 6-digit number to enable Delete.",
    ar: "اكتب رقمهم المكوَّن من 6 خانات لتفعيل الحذف.",
  },
  "admin.delete.confirmAria": {
    en: "Type {number} to confirm deleting this person",
    ar: "اكتب {number} لتأكيد حذف هذا الشخص",
  },
  "admin.delete.action": { en: "Delete permanently", ar: "حذف نهائي" },
  "admin.delete.busy": { en: "Deleting…", ar: "جارٍ الحذف…" },
  "admin.delete.done": {
    en: "Deleted. Their number is retired and will not be reissued.",
    ar: "تم الحذف. سُحب رقمهم ولن يُمنح من جديد.",
  },
  "admin.delete.failed": {
    en: "Couldn't delete that person.",
    ar: "تعذّر حذف هذا الشخص.",
  },

  // ── Account type ─────────────────────────────────────────────────────────────
  "admin.type.label": { en: "Change account type", ar: "تغيير نوع الحساب" },
  "admin.type.aria": { en: "Account type", ar: "نوع الحساب" },
  "admin.type.guestExplain": {
    en: "Guests have no account behind them, so there's no role to change. They keep their number and everything in it when they register themselves.",
    ar: "الضيوف لا يقف خلفهم حساب، فلا توجد صلاحية يمكن تغييرها. ويحتفظون برقمهم وبكل ما فيه عندما يسجّلون بأنفسهم.",
  },
  /* THE SENTENCE THAT SAYS HOW FAR THE BUTTON REACHES. It mints no account, sends no
     code and signs nobody in — only a request from the device holding that identity can
     finish a registration, which is what stops an admin attaching an address they
     control and then signing in as somebody else. The Arabic has to carry all three
     denials, not a summary of them. */
  "admin.type.suggestExplain": {
    en: "You can suggest the address they should use. They see it in their app, can change it, and finish registering themselves — this doesn't create an account or send anything.",
    ar: "يمكنك اقتراح العنوان الذي يستخدمونه. سيظهر لهم في تطبيقهم، ويمكنهم تغييره وإكمال التسجيل بأنفسهم — وهذا لا يُنشئ حسابًا ولا يُرسل أي شيء.",
  },
  "admin.type.alreadySuggested": { en: "Already suggested: ", ar: "مُقترح بالفعل: " },
  "admin.type.emailAria": {
    en: "Suggested registration address for {who}",
    ar: "عنوان التسجيل المُقترح لـ {who}",
  },
  "admin.type.suggest": { en: "Suggest", ar: "اقتراح" },
  "admin.type.suggesting": { en: "Saving…", ar: "جارٍ الحفظ…" },
  "admin.type.withdraw": { en: "Withdraw", ar: "سحب" },
  "admin.type.suggested": {
    en: "Suggested. It shows in their app next time they open it.",
    ar: "تم الاقتراح. سيظهر في تطبيقهم عند فتحه في المرة القادمة.",
  },
  "admin.type.suggestFailed": {
    en: "Couldn't save that suggestion.",
    ar: "تعذّر حفظ هذا الاقتراح.",
  },
  "admin.type.withdrawFailed": {
    en: "Couldn't withdraw that suggestion.",
    ar: "تعذّر سحب هذا الاقتراح.",
  },
  "admin.type.saving": { en: "Saving…", ar: "جارٍ الحفظ…" },

  // ── Change number ────────────────────────────────────────────────────────────
  "admin.number.label": { en: "Change number", ar: "تغيير الرقم" },
  "admin.number.aria": { en: "New number for {who}", ar: "الرقم الجديد لـ {who}" },
  "admin.number.apply": { en: "Apply", ar: "تطبيق" },
  "admin.number.applying": { en: "Changing…", ar: "جارٍ التغيير…" },
  "admin.number.rule": {
    en: "Six digits, and it can't start with 000 or 111.",
    ar: "ست خانات، ولا يمكن أن يبدأ بـ 000 أو 111.",
  },
  /* ENGLISH USES AN ARROW BETWEEN TWO LTR NUMBERS; ARABIC USES WORDS. A toast is one
     flat string with no way to isolate a run, so "777-777 → 888-888" inside an RTL
     paragraph can have its parts reordered. "من … إلى …" removes the hazard outright
     and is better Arabic than an arrow would be. */
  "admin.number.changed": { en: "Changed {from} → {to}", ar: "تم التغيير من {from} إلى {to}" },
  "admin.number.unchanged": {
    en: "That was already their number.",
    ar: "كان هذا رقمهم بالفعل.",
  },
  "admin.number.failed": {
    en: "Couldn't change that number.",
    ar: "تعذّر تغيير هذا الرقم.",
  },

  // ── Fleet media card ─────────────────────────────────────────────────────────
  "admin.media.label": { en: "Call media — this fleet", ar: "وسائط المكالمات — هذا الأسطول" },
  "admin.media.reading": { en: "Reading the media config…", ar: "جارٍ قراءة إعدادات الوسائط…" },
  "admin.media.readFailed": {
    en: "Couldn't read the media config.",
    ar: "تعذّرت قراءة إعدادات الوسائط.",
  },
  "admin.media.mesh": { en: "WebRTC mesh in use", ar: "شبكة WebRTC المباشرة قيد الاستخدام" },
  "admin.media.transportInUse": { en: "{transport} in use", ar: "{transport} قيد الاستخدام" },
  "admin.media.meshCost": {
    en: "Peer-to-peer — each phone in an N-party call runs N−1 encoders, so 6 is the cap.",
    ar: "اتصال مباشر بين الأطراف — كل هاتف في مكالمة من N طرفًا يشغّل N−1 مُرمِّزًا، ولذلك الحد الأقصى هو 6.",
  },
  /* Singular and plural are two keys because English needs them to be. Arabic counts
     differently again, so each half is written to read naturally beside its own number
     rather than transliterating the other language's grammar. */
  "admin.media.relaysOne": {
    en: "Relays: 1 host, {tls} TLS",
    ar: "المُرحِّلات: مضيف واحد، {tls} عبر TLS",
  },
  "admin.media.relaysMany": {
    en: "Relays: {hosts} hosts, {tls} TLS",
    ar: "المُرحِّلات: {hosts} مضيفًا، {tls} عبر TLS",
  },
  /* THE RELAY BREAKDOWN LINE IS DELIBERATELY NOT A DICTIONARY ENTRY. It is
     `<hosts> · N STUN · N UDP · N TCP` — protocol names and Western digits, with no
     prose in it at all, so both halves would have been byte-identical. An entry whose
     two halves are the same is a claim that something was translated when nothing was,
     and it would be the one entry that fails this module's own "the Arabic differs"
     rule for a legitimate reason. It is composed inline in `Admin.tsx` instead. */
  "admin.media.noTurn": {
    en: "No TURN advertised — a call behind a strict NAT has no fallback.",
    ar: "لا يوجد TURN مُعلَن — المكالمة خلف NAT صارم بلا بديل تلجأ إليه.",
  },
  "admin.media.turnSecret": { en: "TURN secret set", ar: "سرّ TURN مضبوط" },
  "admin.media.turnSecretDetail": {
    en: "Credentials are minted per call, never shown.",
    ar: "تُصدَر بيانات الاعتماد لكل مكالمة على حدة، ولا تُعرض أبدًا.",
  },
  "admin.media.poolOff": { en: "Media node pool: not configured", ar: "مجموعة عقد الوسائط: غير مُهيَّأة" },
  "admin.media.poolOn": {
    en: "Media nodes: {eligible} of {total} accepting rooms",
    ar: "عقد الوسائط: {eligible} من {total} تقبل الغرف",
  },
  "admin.media.nodeRoomsOne": {
    en: "1 room · {consumers} consumers · {cpu}% cpu/core",
    ar: "غرفة واحدة · {consumers} مستهلكًا · {cpu}% معالج/نواة",
  },
  "admin.media.nodeRoomsMany": {
    en: "{rooms} rooms · {consumers} consumers · {cpu}% cpu/core",
    ar: "{rooms} غرفة · {consumers} مستهلكًا · {cpu}% معالج/نواة",
  },
  "admin.media.draining": { en: "draining", ar: "قيد الإخلاء" },
  "admin.media.stale": { en: "stale", ar: "قديم" },
  /* The in-call control is LABELLED "Stats" in `lib/relayAssets.ts`, which this sweep
     does not cover — so the word stays literal and only the sentence around it is
     translated. Telling somebody in Arabic to tap a button whose face says "Stats"
     would send them looking for a control that is not there. */
  "admin.media.statsHint": {
    en: "In a call, tap {stats} in the control bar for live round-trip, packet loss, and whether media is going through a relay.",
    ar: "أثناء المكالمة، اضغط {stats} في شريط التحكم لمعرفة زمن الذهاب والإياب وفقد الحزم وما إذا كانت الوسائط تمرّ عبر مُرحِّل.",
  },

  // ── The media pool's reason lines ────────────────────────────────────────────
  /* Deliberately NOT one "pool unhealthy" sentence: an empty registry and a saturated
     fleet are the same empty list and opposite jobs. Telling somebody to add a node
     when the agent is not running has them launch a second box that also fails to
     register, so each line names the action ITS OWN reason calls for. */
  "admin.pool.unconfigured": {
    en: "Needs REDIS_URL. Every call is on the mesh, which is the current design.",
    ar: "يحتاج إلى REDIS_URL. كل المكالمات تجري على الشبكة المباشرة، وهذا هو التصميم الحالي.",
  },
  "admin.pool.ok": {
    en: "Rooms are being distributed by load.",
    ar: "تُوزَّع الغرف حسب الحِمل.",
  },
  "admin.pool.okDraining": {
    en: "Rooms are being distributed by load. {count} draining.",
    ar: "تُوزَّع الغرف حسب الحِمل. {count} قيد الإخلاء.",
  },
  "admin.pool.noNodes": {
    en: "Nothing has registered — check the node agent is running and can reach Redis. Not a capacity problem.",
    ar: "لم تُسجَّل أي عقدة — تحقّق من أن وكيل العقدة يعمل ويستطيع الوصول إلى Redis. المشكلة ليست في السعة.",
  },
  "admin.pool.allStale": {
    en: "All {total} registered but not heartbeating. Check the agents and their clocks.",
    ar: "العقد الـ{total} جميعها مُسجَّلة لكنها لا ترسل نبضات. تحقّق من الوكلاء ومن ساعاتها.",
  },
  "admin.pool.allDraining": {
    en: "Every node is being retired. Clear the drain flag, or add a node.",
    ar: "جميع العقد قيد السحب من الخدمة. أزِل علامة الإخلاء، أو أضِف عقدة.",
  },
  "admin.pool.allExcluded": {
    en: "Nodes heartbeat but fail signaling — a wrong VOIP_NODE_SECRET does exactly this.",
    ar: "العقد ترسل نبضات لكنها تفشل في الإشارات — قيمة VOIP_NODE_SECRET الخاطئة تفعل هذا بالضبط.",
  },
  "admin.pool.allSaturated": {
    en: "{saturated} node(s) at their CPU or room ceiling. THIS is the signal to add a node.",
    ar: "{saturated} من العقد بلغت سقف المعالج أو سقف الغرف. هذه هي العلامة التي تستدعي إضافة عقدة.",
  },
  "admin.pool.disabled": {
    en: "Mediasoup is switched off for this fleet; calls use the mesh.",
    ar: "Mediasoup مُعطَّل لهذا الأسطول؛ المكالمات تستخدم الشبكة المباشرة.",
  },

  // ── Push doctor ──────────────────────────────────────────────────────────────
  "admin.push.label": { en: "Push doctor — per transport", ar: "فاحص الإشعارات — لكل قناة" },
  "admin.push.checking": { en: "Checking…", ar: "جارٍ الفحص…" },
  "admin.push.readFailed": {
    en: "Couldn't read the notification state.",
    ar: "تعذّرت قراءة حالة الإشعارات.",
  },
  "admin.push.devicesOne": {
    en: "1 phone app device registered",
    ar: "جهاز واحد بتطبيق الهاتف مُسجَّل",
  },
  "admin.push.devicesMany": {
    en: "{count} phone app devices registered",
    ar: "{count} أجهزة بتطبيق الهاتف مُسجَّلة",
  },
  "admin.push.noDevices": {
    en: "No phone-app device registered",
    ar: "لا يوجد جهاز بتطبيق الهاتف مُسجَّل",
  },
  /* The envelope is a literal contract the shell must post — never translated. */
  "admin.push.noDevicesDetail": {
    en: 'The app has never handed us a push token. Nothing the server does can fix this — the shell must post {type:"SET_PUSH_TOKEN", token} into the page.',
    ar: 'لم يُسلِّمنا التطبيق أي رمز إشعارات قط. لا شيء يفعله الخادم يصلح هذا — على القشرة أن تُرسل {type:"SET_PUSH_TOKEN", token} إلى الصفحة.',
  },
  "admin.push.deviceEntry": {
    en: "{kind} · {prefix}… ({length} chars)",
    ar: "{kind} · {prefix}… ({length} خانة)",
  },
  "admin.push.routable": { en: "Every token is routable", ar: "كل الرموز قابلة للتوجيه" },
  "admin.push.mismatchedOne": {
    en: "1 token filed under the wrong transport",
    ar: "رمز واحد مُصنَّف تحت القناة الخاطئة",
  },
  "admin.push.mismatchedMany": {
    en: "{count} tokens filed under the wrong transport",
    ar: "{count} رموز مُصنَّفة تحت القناة الخاطئة",
  },
  "admin.push.mismatchEntry": {
    en: "stored {kind}, looks like {derived}",
    ar: "مخزَّن كـ {kind}، لكنه يبدو {derived}",
  },
  "admin.push.switchOn": { en: "Their push switch is on", ar: "مفتاح الإشعارات لديهم مُفعَّل" },
  "admin.push.switchOff": {
    en: "THEY turned push notifications off",
    ar: "هُم من أوقفوا إشعارات الدفع",
  },
  "admin.push.switchOffDetail": {
    en: "Profile → Notifications on their device.",
    ar: "الملف الشخصي ← الإشعارات على جهازهم.",
  },
  "admin.push.fcmOn": {
    en: "Firebase is configured on the server",
    ar: "Firebase مُهيَّأ على الخادم",
  },
  "admin.push.fcmOff": {
    en: "Firebase is NOT configured on the server",
    ar: "Firebase غير مُهيَّأ على الخادم",
  },
  "admin.push.fcmOnDetail": {
    en: "FIREBASE_SERVICE_ACCOUNT_JSON is present and parses.",
    ar: "قيمة FIREBASE_SERVICE_ACCOUNT_JSON موجودة وتُحلَّل بنجاح.",
  },
  "admin.push.fcmOffDetail": {
    en: "Only needed for RAW device tokens. Expo tokens go through Expo and need nothing here.",
    ar: "مطلوب فقط لرموز الأجهزة الخام. رموز Expo تمرّ عبر Expo ولا تحتاج شيئًا هنا.",
  },
  "admin.push.expo": { en: "Expo delivery is available", ar: "التوصيل عبر Expo متاح" },
  "admin.push.expoTokenSet": { en: "EXPO_ACCESS_TOKEN set.", ar: "قيمة EXPO_ACCESS_TOKEN مضبوطة." },
  "admin.push.expoTokenMissing": {
    en: "No access token — fine unless the Expo account enforces one.",
    ar: "لا يوجد رمز وصول — لا بأس ما لم يكن حساب Expo يفرض واحدًا.",
  },
  "admin.push.webOn": { en: "Browser push is configured", ar: "إشعارات المتصفح مُهيَّأة" },
  "admin.push.webOff": { en: "Browser push is NOT configured", ar: "إشعارات المتصفح غير مُهيَّأة" },
  "admin.push.apnsOn": {
    en: "iPhone ring (APNs VoIP) is configured",
    ar: "رنين iPhone (APNs VoIP) مُهيَّأ",
  },
  "admin.push.apnsOff": {
    en: "iPhone ring (APNs VoIP) is NOT configured",
    ar: "رنين iPhone (APNs VoIP) غير مُهيَّأ",
  },
  "admin.push.apnsOnDetail": {
    en: "A locked iPhone shows the full-screen call screen. Credential: {credential}.",
    ar: "يعرض iPhone المقفل شاشة المكالمة بملء الشاشة. بيانات الاعتماد: {credential}.",
  },
  "admin.push.apnsCert": { en: "VoIP Services certificate", ar: "شهادة VoIP Services" },
  "admin.push.apnsKey": { en: "signing key (.p8)", ar: "مفتاح توقيع (.p8)" },
  "admin.push.apnsOffDetail": {
    en: "Needs either APNS_P8_KEY + APNS_KEY_ID + APNS_TEAM_ID, or APNS_VOIP_CERT_PEM + APNS_VOIP_KEY_PEM, plus a topic (APNS_VOIP_TOPIC or APNS_BUNDLE_ID). Android is unaffected.",
    ar: "يحتاج إمّا APNS_P8_KEY + APNS_KEY_ID + APNS_TEAM_ID، أو APNS_VOIP_CERT_PEM + APNS_VOIP_KEY_PEM، بالإضافة إلى موضوع (APNS_VOIP_TOPIC أو APNS_BUNDLE_ID). ولا يتأثر Android بذلك.",
  },
  /* Three states rather than one sentence with a sign flip: expired, expiring and
     healthy call for three different actions, and the first two are the ones somebody
     has to act on today. */
  "admin.push.certExpired": {
    en: "The VoIP certificate EXPIRED {days} days ago — iPhones cannot ring",
    ar: "انتهت صلاحية شهادة VoIP قبل {days} يومًا — لا يمكن لأجهزة iPhone أن ترنّ",
  },
  "admin.push.certExpiring": {
    en: "The VoIP certificate expires in {days} days — reissue it now",
    ar: "تنتهي صلاحية شهادة VoIP خلال {days} يومًا — أعِد إصدارها الآن",
  },
  "admin.push.certValid": {
    en: "The VoIP certificate is valid for {days} more days",
    ar: "شهادة VoIP صالحة لمدة {days} يومًا إضافية",
  },
  "admin.push.certDetail": {
    en: "Expires {date}. Apple lets two certificates exist at once, so you can reissue and swap with no downtime.",
    ar: "تنتهي في {date}. تسمح Apple بوجود شهادتين معًا، فيمكنك إعادة الإصدار والتبديل دون انقطاع.",
  },
  "admin.push.ringOn": { en: "A CALL pushes a ring", ar: "المكالمة تُرسل إشعار رنين" },
  "admin.push.ringOff": { en: "A CALL does not push at all", ar: "المكالمة لا تُرسل أي إشعار" },
  "admin.push.sendsFor": { en: "What pushes: {kinds}.", ar: "ما الذي يُرسل إشعارًا: {kinds}." },
  "admin.push.test": { en: "Send a test notification", ar: "إرسال إشعار تجريبي" },
  "admin.push.testing": { en: "Sending…", ar: "جارٍ الإرسال…" },
  "admin.push.sentOne": { en: "Sent to 1 device.", ar: "أُرسل إلى جهاز واحد." },
  "admin.push.sentMany": { en: "Sent to {count} devices.", ar: "أُرسل إلى {count} أجهزة." },
  /* Zero delivered is the INFORMATIVE case — the send path ran and nothing was
     reachable, which is a different answer from the request failing. */
  "admin.push.nothingReachable": {
    en: "Nothing was reachable — no device accepted it.",
    ar: "لا شيء يمكن الوصول إليه — لم يقبله أي جهاز.",
  },
  "admin.push.testFailed": { en: "Couldn't send the test.", ar: "تعذّر إرسال الإشعار التجريبي." },
} as const satisfies Record<string, Entry>;
