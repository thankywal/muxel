/**
 * Console translations.
 *
 * Every string an operator can see lives here, in each supported language. The
 * console reads the operator's chosen language on every render, so switching it
 * changes the whole interface rather than only the next screen.
 *
 * Placeholders are written as {name} and substituted by {@link t}. A missing
 * translation falls back to English rather than showing a key, because a shop
 * owner should never be shown an identifier.
 */

export const LOCALES = ["en", "th", "zh", "my"] as const;

export type Locale = (typeof LOCALES)[number];

/** Language names, each written in its own language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  th: "ไทย",
  zh: "中文",
  my: "မြန်မာ",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

type Entry = Record<Locale, string>;

/**
 * Every string the console and the bots can say.
 *
 * Exported so a test can hold the whole table to one rule at once, rather than
 * catching a bad entry only when someone opens the screen that uses it.
 */
export const STRINGS = {
  // Shared ------------------------------------------------------------------
  back: { en: "Back", th: "ย้อนกลับ", zh: "返回", my: "နောက်သို့" },
  cancel: { en: "Cancel", th: "ยกเลิก", zh: "取消", my: "မလုပ်တော့ပါ" },
  yes: { en: "Yes", th: "ใช่", zh: "是", my: "ဟုတ်ကဲ့" },
  no: { en: "No", th: "ไม่", zh: "否", my: "မဟုတ်ပါ" },
  none: { en: "none", th: "ไม่มี", zh: "无", my: "မရှိပါ" },
  saved: { en: "Saved.", th: "บันทึกแล้ว", zh: "已保存", my: "သိမ်းပြီးပါပြီ" },

  btnUpdateNow: {
    en: "Update now",
    th: "อัปเดตตอนนี้",
    zh: "立即更新",
    my: "ယခု update လုပ်ရန်",
  },
  btnSecrets: { en: "Secrets", th: "ความลับ", zh: "密钥", my: "လျှို့ဝှက်ချက်" },
  btnSecAdd: { en: "Add GitHub token", th: "เพิ่มโทเค็น GitHub", zh: "添加 GitHub 令牌", my: "GitHub token ထည့်ရန်" },
  btnSecReplace: { en: "Replace GitHub token", th: "เปลี่ยนโทเค็น GitHub", zh: "更换 GitHub 令牌", my: "GitHub token လဲရန်" },
  btnSecRemove: { en: "Remove it", th: "ลบออก", zh: "移除", my: "ဖယ်ရှားရန်" },
  secTitle: {
    en: "Secrets",
    th: "ความลับ",
    zh: "密钥",
    my: "လျှို့ဝှက်ချက်များ",
  },
  secBody: {
    en: "Kept sealed in your own deployment. Nobody else can read them, including whoever published this code.",
    th: "เก็บแบบเข้ารหัสไว้ในระบบของคุณเอง ไม่มีใครอ่านได้ รวมถึงผู้เผยแพร่โค้ดนี้",
    zh: "以加密形式保存在你自己的部署中。任何人都无法读取，包括发布这份代码的人。",
    my: "သင့်ကိုယ်ပိုင် deployment ထဲမှာ encrypt လုပ်ပြီး သိမ်းထားပါသည်။ ဤကုဒ်ကို ထုတ်ဝေသူအပါအဝင် မည်သူမျှ ဖတ်၍မရပါ။",
  },
  secGithubSet: {
    en: "GitHub token: set. One click updates are available.",
    th: "โทเค็น GitHub: ตั้งค่าแล้ว อัปเดตด้วยคลิกเดียวได้",
    zh: "GitHub 令牌：已设置。可一键更新。",
    my: "GitHub token: ထည့်ပြီး။ တစ်ချက်နှိပ် update လုပ်နိုင်ပါပြီ။",
  },
  secGithubUnset: {
    en: "GitHub token: not set. Add one and updates apply from here, with no visit to GitHub and no redeploy.",
    th: "โทเค็น GitHub: ยังไม่ได้ตั้ง เพิ่มแล้วอัปเดตได้จากที่นี่ ไม่ต้องเข้า GitHub และไม่ต้อง deploy ใหม่",
    zh: "GitHub 令牌：未设置。添加后即可在此更新，无需前往 GitHub，也无需重新部署。",
    my: "GitHub token: မထည့်ရသေးပါ။ ထည့်လိုက်ရင် GitHub ကို မသွားရဘဲ redeploy မလုပ်ရဘဲ ဒီကနေ update လုပ်နိုင်ပါသည်။",
  },
  secAddTitle: {
    en: "Create a token for your own repository",
    th: "สร้างโทเค็นสำหรับที่เก็บโค้ดของคุณ",
    zh: "为你自己的仓库创建一个令牌",
    my: "သင့်ကိုယ်ပိုင် repository အတွက် token ဆောက်ပါ",
  },
  secAddSteps: {
    en: "1. Open github.com/settings/personal-access-tokens/new\n2. Repository access: only the copy this deployment came from\n3. Permissions: Contents, Read and write\n4. Create it, then send the token here.\n\nIt is checked before it is kept, and never shown again.",
    th: "1. เปิด github.com/settings/personal-access-tokens/new\n2. สิทธิ์ที่เก็บ: เฉพาะสำเนาที่ระบบนี้มาจาก\n3. สิทธิ์: Contents อ่านและเขียน\n4. สร้างแล้วส่งโทเค็นมาที่นี่\n\nระบบจะตรวจสอบก่อนบันทึก และจะไม่แสดงอีก",
    zh: "1. 打开 github.com/settings/personal-access-tokens/new\n2. 仓库权限：仅限本部署来源的那个副本\n3. 权限：Contents，读写\n4. 创建后把令牌发到这里。\n\n保存前会先验证，之后不再显示。",
    my: "၁. github.com/settings/personal-access-tokens/new ကို ဖွင့်ပါ\n၂. Repository access: ဤ deployment လာရာ မိတ္တူတစ်ခုတည်း\n၃. Permissions: Contents, Read and write\n၄. ဆောက်ပြီး token ကို ဒီမှာ ပို့ပါ။\n\nမသိမ်းခင် စစ်ပါသည်၊ ပြီးရင် ထပ်မပြတော့ပါ။",
  },
  secTokenBad: {
    en: "GitHub refused that token, so nothing was saved. Check it was copied whole.",
    th: "GitHub ปฏิเสธโทเค็นนี้ จึงไม่ได้บันทึก ตรวจว่าคัดลอกครบหรือไม่",
    zh: "GitHub 拒绝了该令牌，未保存。请检查是否完整复制。",
    my: "GitHub က ဤ token ကို ငြင်းလိုက်၍ မသိမ်းထားပါ။ အပြည့်အစုံ ကူးမိမမိ စစ်ပါ။",
  },
  secTokenSaved: {
    en: "Saved and sealed. You can update from the console now.",
    th: "บันทึกและเข้ารหัสแล้ว อัปเดตจากคอนโซลได้เลย",
    zh: "已保存并加密。现在可以从控制台更新。",
    my: "သိမ်းပြီး encrypt လုပ်ပြီးပါပြီ။ ယခု console ကနေ update လုပ်နိုင်ပါပြီ။",
  },
  secUpdTitle: {
    en: "Update",
    th: "อัปเดต",
    zh: "更新",
    my: "အပ်ဒိတ်",
  },

  btnWebConsole: {
    en: "Web console",
    th: "คอนโซลบนเว็บ",
    zh: "网页控制台",
    my: "ဝဘ် console",
  },
  btnWebConNew: {
    en: "New code",
    th: "รหัสใหม่",
    zh: "新的代码",
    my: "ကုဒ်အသစ်",
  },
  webConTitle: {
    en: "Open the console on a computer",
    th: "เปิดคอนโซลบนคอมพิวเตอร์",
    zh: "在电脑上打开控制台",
    my: "ကွန်ပျူတာမှာ console ဖွင့်ရန်",
  },
  webConBody: {
    en: "Go to app.muxel.site, paste your deployment address, then type this code.",
    th: "ไปที่ app.muxel.site ใส่ที่อยู่ระบบของคุณ แล้วพิมพ์รหัสนี้",
    zh: "打开 app.muxel.site，填入你的部署地址，然后输入此代码。",
    my: "app.muxel.site ကို ဖွင့်ပြီး သင့် deployment လိပ်စာ ထည့်၊ ပြီးရင် ဤကုဒ်ကို ရိုက်ထည့်ပါ။",
  },
  webConExpiry: {
    en: "It works once, for ten minutes.",
    th: "ใช้ได้ครั้งเดียว ภายในสิบนาที",
    zh: "仅可使用一次，有效期十分钟。",
    my: "တစ်ကြိမ်သာ၊ ဆယ်မိနစ်အတွင်း အသုံးပြုနိုင်ပါသည်။",
  },

  private: {
    en: "This console is private. Ask the owner to grant you access.",
    th: "คอนโซลนี้เป็นส่วนตัว โปรดขอสิทธิ์จากเจ้าของ",
    zh: "此控制台为私有。请向所有者申请访问权限。",
    my: "ဤ console သည် သီးသန့်ဖြစ်သည်။ ပိုင်ရှင်ထံ ခွင့်ပြုချက် တောင်းပါ။",
  },
  failed: {
    en: "That action could not complete.",
    th: "ทำรายการไม่สำเร็จ",
    zh: "该操作无法完成。",
    my: "အဲဒီလုပ်ဆောင်ချက် မပြီးမြောက်ပါ။",
  },
  expired: {
    en: "This menu expired.",
    th: "เมนูนี้หมดอายุแล้ว",
    zh: "此菜单已过期。",
    my: "ဤ menu သက်တမ်းကုန်သွားပါပြီ။",
  },

  // Home --------------------------------------------------------------------
  homeTitle: { en: "Muxel console", th: "คอนโซล Muxel", zh: "Muxel 控制台", my: "Muxel console" },
  homeBody: {
    en: "Manage the businesses and bots in this deployment.",
    th: "จัดการธุรกิจและบอทในระบบนี้",
    zh: "管理此部署中的商家与机器人。",
    my: "ဤ deployment ရှိ လုပ်ငန်းများနှင့် bot များကို စီမံပါ။",
  },
  btnBusinesses: { en: "Businesses", th: "ธุรกิจ", zh: "商家", my: "လုပ်ငန်းများ" },
  btnAddBusiness: { en: "Add business", th: "เพิ่มธุรกิจ", zh: "添加商家", my: "လုပ်ငန်း အသစ်ထည့်" },
  btnHelp: { en: "Help", th: "ช่วยเหลือ", zh: "帮助", my: "အကူအညီ" },
  btnLanguage: { en: "Language", th: "ภาษา", zh: "语言", my: "ဘာသာစကား" },

  // Businesses --------------------------------------------------------------
  bizListTitle: { en: "Businesses", th: "ธุรกิจ", zh: "商家", my: "လုပ်ငန်းများ" },
  bizListEmpty: {
    en: "No businesses yet. Add one to get started.",
    th: "ยังไม่มีธุรกิจ เพิ่มหนึ่งรายการเพื่อเริ่มต้น",
    zh: "还没有商家。添加一个即可开始。",
    my: "လုပ်ငန်း မရှိသေးပါ။ တစ်ခု ထည့်ပြီး စတင်ပါ။",
  },
  bizListCount: {
    en: "{count} configured.",
    th: "ตั้งค่าแล้ว {count} รายการ",
    zh: "已配置 {count} 个。",
    my: "{count} ခု ရှိပါသည်။",
  },
  bizAddTitle: { en: "Add business", th: "เพิ่มธุรกิจ", zh: "添加商家", my: "လုပ်ငန်း အသစ်ထည့်" },
  bizAddBody: {
    en: [
      "A business is created by connecting the bot your customers will write to.",
      "",
      "1. Open @BotFather and send /newbot.",
      "2. Give it the name of the business, because that becomes the name here",
      "   and the name customers see.",
      "3. Copy the token it gives you and send it to this chat.",
      "",
      "Do not send the token of this console bot. That one is yours alone and",
      "customers must never reach it.",
    ].join("\n"),
    th: [
      "ธุรกิจจะถูกสร้างขึ้นเมื่อเชื่อมต่อบอทที่ลูกค้าจะทักเข้ามา",
      "",
      "1. เปิด @BotFather แล้วส่ง /newbot",
      "2. ตั้งชื่อบอทเป็นชื่อธุรกิจ เพราะชื่อนั้นจะกลายเป็นชื่อที่นี่",
      "   และเป็นชื่อที่ลูกค้าเห็น",
      "3. คัดลอกโทเคนที่ได้ แล้วส่งมาที่แชทนี้",
      "",
      "อย่าส่งโทเคนของบอทคอนโซลนี้ บอทนี้เป็นของคุณคนเดียว",
      "และลูกค้าต้องเข้าถึงไม่ได้",
    ].join("\n"),
    zh: [
      "连接客户将要联系的机器人，即可创建一个商家。",
      "",
      "1. 打开 @BotFather，发送 /newbot。",
      "2. 用商家名称为它命名，这个名称会成为这里的名称，",
      "   也是客户看到的名称。",
      "3. 复制它给出的 token，发送到此聊天。",
      "",
      "不要发送这个控制台机器人的 token。它只属于你，",
      "客户绝不能接触到它。",
    ].join("\n"),
    my: [
      "customer တွေ စာပို့မယ့် bot ကို ချိတ်လိုက်တာနဲ့ လုပ်ငန်းတစ်ခု ဖြစ်လာပါမည်။",
      "",
      "၁။ @BotFather ဖွင့်ပြီး /newbot ပို့ပါ။",
      "၂။ လုပ်ငန်းအမည်ကို bot ရဲ့ နာမည်အဖြစ် ပေးပါ — အဲဒါက ဒီမှာ ပေါ်မယ့်",
      "   အမည်ဖြစ်ပြီး customer မြင်ရမယ့် အမည်လည်း ဖြစ်ပါသည်။",
      "၃။ ရလာတဲ့ token ကို ကူးပြီး ဤ chat ထဲ ပို့ပါ။",
      "",
      "ဤ console bot ရဲ့ token ကို မပို့ပါနှင့်။ အဲဒါက သင့်တစ်ယောက်တည်းအတွက်ဖြစ်ပြီး",
      "customer တွေ ဘယ်တော့မှ မရောက်ရပါ။",
    ].join("\n"),
  },
  bizAddInvalid: {
    en: "Send a name between 1 and 80 characters.",
    th: "กรุณาส่งชื่อความยาว 1 ถึง 80 ตัวอักษร",
    zh: "请发送 1 至 80 个字符的名称。",
    my: "စာလုံး ၁ လုံးမှ ၈၀ အတွင်း အမည် ပို့ပါ။",
  },
  bizAddedFromBot: {
    en: "Added {name}, served by @{username}.",
    th: "เพิ่ม {name} แล้ว ให้บริการโดย @{username}",
    zh: "已添加 {name}，由 @{username} 提供服务。",
    my: "{name} ကို ထည့်ပြီးပါပြီ — @{username} က ဝန်ဆောင်ပေးပါမည်။",
  },
  bizAddSameAsConsole: {
    en: "That is this console bot. Create a separate bot for the business.",
    th: "นั่นคือบอทคอนโซลนี้ กรุณาสร้างบอทแยกต่างหากสำหรับธุรกิจ",
    zh: "那是本控制台机器人。请为商家单独创建一个机器人。",
    my: "အဲဒါက ဤ console bot ပါ။ လုပ်ငန်းအတွက် သီးခြား bot တစ်ခု ဆောက်ပါ။",
  },

  // Diagnostics ---------------------------------------------------------------
  btnDiagnostics: { en: "Problems", th: "ปัญหา", zh: "问题", my: "ပြဿနာများ" },
  diagTitle: { en: "Recent problems", th: "ปัญหาล่าสุด", zh: "近期问题", my: "မကြာသေးမီ ပြဿနာများ" },
  diagEmpty: {
    en: "Nothing has gone wrong recently.",
    th: "ไม่มีปัญหาในช่วงที่ผ่านมา",
    zh: "近期没有出现问题。",
    my: "မကြာသေးမီက ပြဿနာ မရှိပါ။",
  },
  diagBody: {
    en: "When the assistant fails to answer, the reason is recorded here so you do not need a dashboard to find it.",
    th: "เมื่อผู้ช่วยตอบไม่ได้ เหตุผลจะถูกบันทึกไว้ที่นี่ คุณจึงไม่ต้องเปิดแดชบอร์ดเพื่อค้นหา",
    zh: "当助手无法回答时，原因会记录在这里，你无需打开控制面板即可查看。",
    my: "assistant မဖြေနိုင်တဲ့အခါ အကြောင်းရင်းကို ဤနေရာမှာ မှတ်ထားပါသည် — dashboard ဖွင့်စရာ မလိုပါ။",
  },

  // Web agent ---------------------------------------------------------------------
  btnWebAgent: { en: "Web agent", th: "เอเจนต์เว็บ", zh: "网页助手", my: "Web agent" },
  webTitle: {
    en: "Web agent for {name}",
    th: "เอเจนต์เว็บของ {name}",
    zh: "{name} 的网页助手",
    my: "{name} အတွက် Web agent",
  },
  webIntro: {
    en: "The same assistant, on your own website. Visitors get a small chat bubble in the corner, and their questions reach the same documents, the same customer list and the same handover queue as Telegram.\n\nGenerating it gives you a link to try it yourself first, and one line to paste into your site.",
    th: "ผู้ช่วยตัวเดิม แต่อยู่บนเว็บไซต์ของคุณ ผู้เข้าชมจะเห็นปุ่มแชทเล็ก ๆ ที่มุมจอ และคำถามของพวกเขาจะไปถึงเอกสารชุดเดียวกัน รายชื่อลูกค้าชุดเดียวกัน และคิวส่งต่อเดียวกันกับ Telegram\n\nเมื่อสร้างแล้ว คุณจะได้ลิงก์สำหรับทดลองก่อน และโค้ดหนึ่งบรรทัดสำหรับวางในเว็บไซต์",
    zh: "同一个助手，放到你自己的网站上。访客会在角落看到一个小聊天气泡，他们的问题会进入与 Telegram 完全相同的文档、客户列表和人工接管队列。\n\n生成后你会得到一个可以先自己试用的链接，以及一行粘贴到网站里的代码。",
    my: "အတူတူ assistant ကို သင့်ကိုယ်ပိုင် website ပေါ်မှာ။ လာကြည့်သူတွေက ထောင့်မှာ chat ခလုတ်လေး တွေ့ရပြီး၊ သူတို့မေးခွန်းတွေက Telegram နဲ့ တူညီတဲ့ document, ဝယ်သူစာရင်း, handover queue ဆီ ရောက်ပါတယ်။\n\nဆောက်လိုက်ရင် ကိုယ်တိုင် အရင်စမ်းဖို့ link တစ်ခုနဲ့၊ website မှာ paste လုပ်ဖို့ တစ်ကြောင်းတည်း ရပါမယ်။",
  },
  btnGenerateWeb: {
    en: "Generate web agent",
    th: "สร้างเอเจนต์เว็บ",
    zh: "生成网页助手",
    my: "Web agent ဆောက်မည်",
  },
  webLive: {
    en: "Live. Try it yourself at the link below, then paste the line into your site.",
    th: "พร้อมใช้งานแล้ว ลองที่ลิงก์ด้านล่างก่อน จากนั้นวางโค้ดลงในเว็บไซต์ของคุณ",
    zh: "已启用。先用下面的链接自己试试，然后把那行代码粘贴到你的网站里。",
    my: "အသုံးပြုနိုင်ပါပြီ။ အောက်က link မှာ ကိုယ်တိုင် အရင်စမ်းပြီး၊ အဲဒီတစ်ကြောင်းကို သင့် website မှာ paste လုပ်ပါ။",
  },
  webOff: {
    en: "Switched off. The bubble will not appear on your site and the link answers nothing.",
    th: "ปิดอยู่ ปุ่มแชทจะไม่ปรากฏบนเว็บไซต์ และลิงก์จะไม่ตอบสนอง",
    zh: "已关闭。气泡不会出现在你的网站上，链接也不会有响应。",
    my: "ပိတ်ထားပါတယ်။ သင့် website မှာ ခလုတ် မပေါ်တော့ဘဲ link ကလည်း ဘာမှ ပြန်မဖြေပါ။",
  },
  webTry: { en: "Try it here", th: "ลองที่นี่", zh: "在这里试用", my: "ဒီမှာ စမ်းပါ" },
  webEmbed: {
    en: "Paste this into your website, just before the closing body tag",
    th: "วางโค้ดนี้ในเว็บไซต์ของคุณ ก่อนแท็กปิด body",
    zh: "把这行粘贴到你网站的 body 结束标签之前",
    my: "ဒါကို သင့် website ရဲ့ body ပိတ်တဲ့ tag မတိုင်ခင် paste လုပ်ပါ",
  },
  /**
   * The line that pops out beside the bubble on a shop's own website.
   *
   * Read by a customer, not an operator, so it is the one string in this table
   * addressed to a stranger. It names the shop, because a bubble that says
   * "Chat with us" on a page full of products is asking to be ignored, and
   * offers help rather than announcing a robot.
   */
  // Choosing a channel ------------------------------------------------------------
  bizNewTitle: {
    en: "Where will your customers talk to you?",
    th: "ลูกค้าจะคุยกับคุณที่ไหน",
    zh: "你的客户会在哪里和你聊天？",
    my: "သင့် customer တွေ ဘယ်ကနေ စကားပြောမလဲ?",
  },
  bizNewBody: {
    en: "Pick where this business answers. This is only where the conversation happens: the documents, the customer list and the assistant itself are the same either way.",
    th: "เลือกช่องทางที่ธุรกิจนี้จะตอบลูกค้า นี่คือแค่ที่ที่การสนทนาเกิดขึ้น เอกสาร รายชื่อลูกค้า และตัวผู้ช่วยเหมือนกันทั้งสองทาง",
    zh: "选择这个业务在哪里回复客户。这只是对话发生的地方，文档、客户列表和助手本身两边完全相同。",
    my: "ဒီလုပ်ငန်းက ဘယ်ကနေ ဖြေမလဲ ရွေးပါ။ ဒါက စကားပြောတဲ့ နေရာပဲ ဖြစ်ပြီး၊ စာရွက်စာတမ်း၊ ဝယ်သူစာရင်းနဲ့ assistant ကိုယ်တိုင်က နှစ်ဖက်လုံး အတူတူပါ။",
  },
  btnRouteTelegram: {
    en: "Telegram agent",
    th: "เอเจนต์ Telegram",
    zh: "Telegram 助手",
    my: "Telegram agent",
  },
  routeTelegramBody: {
    en: "Customers write to a Telegram bot. You will need to create one with @BotFather, which is free and takes a minute.",
    th: "ลูกค้าส่งข้อความไปที่บอท Telegram คุณต้องสร้างบอทด้วย @BotFather ซึ่งฟรีและใช้เวลาราวหนึ่งนาที",
    zh: "客户向一个 Telegram bot 发消息。你需要用 @BotFather 创建一个，免费，约一分钟。",
    my: "Customer တွေက Telegram bot ဆီ စာပို့မယ်။ @BotFather မှာ တစ်ခု ဆောက်ရမယ် — အခမဲ့ဖြစ်ပြီး တစ်မိနစ်ခန့်ပဲ ကြာပါတယ်။",
  },
  btnRouteWeb: {
    en: "Web agent",
    th: "เอเจนต์เว็บ",
    zh: "网页助手",
    my: "Web agent",
  },
  routeWebBody: {
    en: "Customers use a chat bubble on your own website. No Telegram bot is needed. You get a link to try it and one line to paste into your site.",
    th: "ลูกค้าใช้ปุ่มแชทบนเว็บไซต์ของคุณเอง ไม่ต้องมีบอท Telegram คุณจะได้ลิงก์สำหรับทดลองและโค้ดหนึ่งบรรทัดสำหรับวางในเว็บไซต์",
    zh: "客户使用你自己网站上的聊天气泡。不需要 Telegram bot。你会得到一个试用链接和一行粘贴到网站的代码。",
    my: "Customer တွေက သင့်ကိုယ်ပိုင် website ပေါ်က chat ခလုတ်ကနေ သုံးမယ်။ Telegram bot မလိုပါဘူး။ စမ်းဖို့ link တစ်ခုနဲ့ website မှာ paste လုပ်ဖို့ တစ်ကြောင်း ရပါမယ်။",
  },
  bizNewBoth: {
    en: "You can add the other one later. Nothing here is final.",
    th: "คุณเพิ่มอีกช่องทางภายหลังได้ ไม่มีอะไรที่เปลี่ยนไม่ได้",
    zh: "另一个可以之后再添加，这里没有不可更改的选择。",
    my: "နောက်တစ်ခုကို နောက်မှ ထပ်ထည့်လို့ရပါတယ်။ ဒီမှာ အပြီးသတ် ဆုံးဖြတ်ချက် မဟုတ်ပါဘူး။",
  },
  bizWebTitle: {
    en: "Name this business",
    th: "ตั้งชื่อธุรกิจนี้",
    zh: "给这个业务起名",
    my: "ဒီလုပ်ငန်းကို အမည်ပေးပါ",
  },
  bizWebBody: {
    en: "Send the shop's name. Visitors see it at the top of the chat, and you will see it in your list of businesses. You can change it afterwards.",
    th: "ส่งชื่อร้าน ผู้เข้าชมจะเห็นชื่อนี้ด้านบนของหน้าต่างแชท และคุณจะเห็นในรายการธุรกิจ เปลี่ยนภายหลังได้",
    zh: "发送店铺名称。访客会在聊天窗口顶部看到它，你也会在业务列表中看到它。之后可以修改。",
    my: "ဆိုင်နာမည် ပို့ပါ။ လာကြည့်သူတွေက စကားပြောခန်း အပေါ်မှာ မြင်ရပြီး၊ သင်လည်း လုပ်ငန်းစာရင်းထဲမှာ မြင်ရပါမယ်။ နောက်မှ ပြောင်းလို့ရပါတယ်။",
  },
  bizTelegram: { en: "Telegram", th: "Telegram", zh: "Telegram", my: "Telegram" },
  bizWebsite: { en: "Website", th: "เว็บไซต์", zh: "网站", my: "Website" },
  bizChannelLive: { en: "live", th: "พร้อมใช้งาน", zh: "已启用", my: "အသုံးပြုနိုင်ပါပြီ" },
  bizChannelOff: { en: "switched off", th: "ปิดอยู่", zh: "已关闭", my: "ပိတ်ထားပါတယ်" },
  bizChannelAbsent: {
    en: "not set up",
    th: "ยังไม่ได้ตั้งค่า",
    zh: "尚未设置",
    my: "မဆောက်ရသေးပါ",
  },
  webTeaser: {
    en: "Hi! Ask me anything about {name}: prices, stock, delivery. How can I help?",
    th: "สวัสดีค่ะ! สอบถามเกี่ยวกับ {name} ได้เลย ทั้งราคา สินค้า และการจัดส่ง มีอะไรให้ช่วยไหมคะ",
    zh: "你好！关于 {name} 的任何问题都可以问我，价格、库存、配送都行。有什么可以帮您？",
    my: "မင်္ဂလာပါ! {name} အကြောင်း စျေးနှုန်း၊ ပစ္စည်းရှိမရှိ၊ ပို့ဆောင်မှု စတာတွေ ဘာမဆို မေးလို့ရပါတယ်။ ဘာကူညီပေးရမလဲ?",
  },
  webHowTitle: {
    en: "How to add it",
    th: "วิธีติดตั้ง",
    zh: "如何安装",
    my: "ဘယ်လို ထည့်မလဲ",
  },
  webHowBody: {
    en: "1. Press the code above to copy it.\n2. Open your website editor and find the page template, the one used by every page.\n3. Paste the line at the very bottom, just above the closing body tag, and save.\n\nOn Wordpress use Appearance, Theme File Editor, footer.php. On Shopify use Online Store, Themes, Edit code, theme.liquid. On Wix or Squarespace look for Settings, Custom code. Anywhere else, paste it wherever the site lets you add HTML to every page.\n\nReload your site and the bubble appears in the corner. Set Allowed sites to your domain afterwards, so nobody else can put your assistant on their page.",
    th: "1. กดที่โค้ดด้านบนเพื่อคัดลอก\n2. เปิดตัวแก้ไขเว็บไซต์ของคุณ แล้วหาไฟล์เทมเพลตที่ทุกหน้าใช้ร่วมกัน\n3. วางโค้ดไว้ล่างสุด ก่อนแท็กปิด body แล้วบันทึก\n\nบน Wordpress ใช้ Appearance, Theme File Editor, footer.php บน Shopify ใช้ Online Store, Themes, Edit code, theme.liquid บน Wix หรือ Squarespace ให้หา Settings, Custom code ที่อื่น ๆ ให้วางในที่ที่เว็บไซต์อนุญาตให้เพิ่ม HTML ลงทุกหน้า\n\nรีโหลดเว็บไซต์แล้วปุ่มแชทจะปรากฏที่มุมจอ จากนั้นตั้งค่าเว็บไซต์ที่อนุญาตเป็นโดเมนของคุณ เพื่อไม่ให้คนอื่นนำผู้ช่วยของคุณไปใช้",
    zh: "1. 点击上面的代码即可复制。\n2. 打开你的网站编辑器，找到每个页面都会用到的模板文件。\n3. 把这行粘贴到最底部、body 结束标签之前，然后保存。\n\nWordpress 用 外观、主题文件编辑器、footer.php；Shopify 用 在线商店、模板、编辑代码、theme.liquid；Wix 或 Squarespace 找 设置、自定义代码。其他平台就粘贴到任何可以给所有页面添加 HTML 的地方。\n\n重新加载网站，气泡就会出现在角落。之后把「允许的网站」设为你的域名，别人就无法把你的助手放到他们的页面上。",
    my: "၁။ အပေါ်က code ကို နှိပ်ပြီး ကူးယူပါ။\n၂။ သင့် website editor ကို ဖွင့်ပြီး စာမျက်နှာတိုင်း သုံးတဲ့ template ဖိုင်ကို ရှာပါ။\n၃။ အဲဒီတစ်ကြောင်းကို အောက်ဆုံးမှာ၊ body ပိတ်တဲ့ tag မတိုင်ခင် paste လုပ်ပြီး save လုပ်ပါ။\n\nWordpress ဆိုရင် Appearance, Theme File Editor, footer.php ကို သုံးပါ။ Shopify ဆိုရင် Online Store, Themes, Edit code, theme.liquid ကို သုံးပါ။ Wix သို့မဟုတ် Squarespace ဆိုရင် Settings, Custom code ကို ရှာပါ။ တခြားဟာဆိုရင် စာမျက်နှာတိုင်းမှာ HTML ထည့်လို့ရတဲ့ နေရာမှာ paste လုပ်ပါ။\n\nWebsite ကို ပြန် load လုပ်ရင် ထောင့်မှာ chat ခလုတ် ပေါ်လာပါမယ်။ ပြီးရင် ခွင့်ပြုထားသော site မှာ သင့် domain ကို သတ်မှတ်ပါ။ ဒါဆို တခြားသူတွေ သင့် assistant ကို သူတို့စာမျက်နှာမှာ တင်လို့ မရတော့ပါ။",
  },
  btnWebName: {
    en: "Change web agent name",
    th: "เปลี่ยนชื่อเอเจนต์เว็บ",
    zh: "更改网页助手名称",
    my: "Web agent အမည် ပြောင်းမည်",
  },
  webNameBody: {
    en: "Send the name visitors should see at the top of the chat. One deployment can run a web agent for every business, so give each one a name you will recognise in this list, usually the shop's own name.",
    th: "ส่งชื่อที่ผู้เข้าชมจะเห็นด้านบนของหน้าต่างแชท หนึ่ง deployment สามารถมีเอเจนต์เว็บของทุกธุรกิจได้ จึงควรตั้งชื่อที่คุณจำได้ในรายการนี้ ปกติคือชื่อร้าน",
    zh: "发送访客会在聊天窗口顶部看到的名称。一个部署可以为每个业务运行网页助手，所以给每个助手起一个你在列表中能认出的名字，通常就是店铺名称。",
    my: "စကားပြောခန်း အပေါ်မှာ လာကြည့်သူတွေ မြင်ရမယ့် အမည်ကို ပို့ပါ။ deployment တစ်ခုတည်းမှာ လုပ်ငန်းတိုင်းအတွက် web agent တစ်ခုစီ ရှိနိုင်လို့ ဒီစာရင်းထဲမှာ သင် မှတ်မိမယ့် အမည် — များသောအားဖြင့် ဆိုင်နာမည် — ပေးပါ။",
  },
  webColour: { en: "Colour", th: "สี", zh: "颜色", my: "အရောင်" },
  webDomains: { en: "Allowed sites", th: "เว็บไซต์ที่อนุญาต", zh: "允许的网站", my: "ခွင့်ပြုထားသော site များ" },
  webAnyDomain: {
    en: "any site (set one to be safe)",
    th: "ทุกเว็บไซต์ (ควรกำหนดเพื่อความปลอดภัย)",
    zh: "任何网站（建议设定以策安全）",
    my: "site အားလုံး (လုံခြုံဖို့ သတ်မှတ်သင့်ပါတယ်)",
  },
  btnWebColour: { en: "Change colour", th: "เปลี่ยนสี", zh: "更改颜色", my: "အရောင် ပြောင်းမည်" },
  btnWebGreeting: {
    en: "Change greeting",
    th: "เปลี่ยนข้อความทักทาย",
    zh: "更改问候语",
    my: "နှုတ်ဆက်စာ ပြောင်းမည်",
  },
  btnWebDomains: {
    en: "Set allowed sites",
    th: "กำหนดเว็บไซต์ที่อนุญาต",
    zh: "设置允许的网站",
    my: "ခွင့်ပြု site သတ်မှတ်မည်",
  },
  btnWebDisable: { en: "Switch off", th: "ปิด", zh: "关闭", my: "ပိတ်မည်" },
  btnWebEnable: { en: "Switch on", th: "เปิด", zh: "开启", my: "ဖွင့်မည်" },
  webColourBody: {
    en: "Pick the colour of the chat bubble. Text on it is chosen for you so it stays readable.",
    th: "เลือกสีของปุ่มแชท ระบบจะเลือกสีตัวอักษรให้เองเพื่อให้อ่านง่าย",
    zh: "选择聊天气泡的颜色。上面的文字颜色会自动选取，以保证清晰可读。",
    my: "Chat ခလုတ်ရဲ့ အရောင် ရွေးပါ။ အပေါ်က စာလုံးအရောင်ကို ဖတ်ရလွယ်အောင် အလိုအလျောက် ရွေးပေးပါတယ်။",
  },
  webGreetingBody: {
    en: "Send the first line a visitor sees when they open the chat. Something like: Hello, ask me anything about our shop.\n\nSend a dash to have no greeting.",
    th: "ส่งข้อความบรรทัดแรกที่ผู้เข้าชมจะเห็นเมื่อเปิดแชท เช่น สวัสดีค่ะ สอบถามเรื่องร้านได้เลย\n\nส่งเครื่องหมายขีดหากไม่ต้องการข้อความทักทาย",
    zh: "发送访客打开聊天时看到的第一句话，例如：你好，有什么想了解的都可以问我。\n\n发送一个短横线表示不要问候语。",
    my: "Chat ဖွင့်လိုက်တဲ့အခါ လာကြည့်သူ မြင်ရမယ့် ပထမစာကြောင်း ပို့ပါ။ ဥပမာ: မင်္ဂလာပါ၊ ဆိုင်အကြောင်း မေးလို့ရပါတယ်။\n\nနှုတ်ဆက်စာ မလိုချင်ရင် ဒင်းတစ်ခု ပို့ပါ။",
  },
  webDomainsBody: {
    en: "Send the website addresses allowed to use this assistant, separated by commas. For example: myshop.com, www.myshop.com\n\nSubdomains are included. Until you set this, any site that copies your line can spend your daily allowance.",
    th: "ส่งที่อยู่เว็บไซต์ที่อนุญาตให้ใช้ผู้ช่วยนี้ คั่นด้วยจุลภาค เช่น myshop.com, www.myshop.com\n\nรวมซับโดเมนด้วย หากยังไม่กำหนด เว็บไซต์ใดก็ตามที่คัดลอกโค้ดของคุณไปจะใช้โควตารายวันของคุณได้",
    zh: "发送允许使用此助手的网站地址，用逗号分隔，例如：myshop.com, www.myshop.com\n\n子域名会一并包含。在你设定之前，任何复制了你那行代码的网站都能消耗你的每日额度。",
    my: "ဒီ assistant ကို သုံးခွင့်ပြုမယ့် website လိပ်စာတွေကို ကော်မာခြားပြီး ပို့ပါ။ ဥပမာ: myshop.com, www.myshop.com\n\nSubdomain တွေပါ ပါဝင်ပါတယ်။ မသတ်မှတ်မချင်း သင့်ကုဒ်ကို ကူးယူသွားတဲ့ ဘယ် site မဆို သင့်နေ့စဉ်ခွင့်ပြုချက်ကို သုံးနိုင်ပါတယ်။",
  },

  // Commands and instruction styles ----------------------------------------------
  cmdStart: { en: "Open the console", th: "เปิดคอนโซล", zh: "打开控制台", my: "Console ဖွင့်" },
  cmdInstruction: {
    en: "How the bot should behave",
    th: "ตั้งค่าพฤติกรรมของบอท",
    zh: "设置机器人的行为",
    my: "Bot ဘယ်လို ပြုမူရမလဲ",
  },
  cmdBusiness: { en: "Your businesses", th: "ธุรกิจของคุณ", zh: "你的商家", my: "သင့် business များ" },
  cmdHelp: { en: "Help", th: "ช่วยเหลือ", zh: "帮助", my: "အကူအညီ" },
  btnViewInstructions: {
    en: "Current agent skill",
    th: "สกิลที่ใช้อยู่",
    zh: "当前使用的技能",
    my: "လက်ရှိ agent skill",
  },
  instViewTitle: {
    en: "Current agent skill for {name}",
    th: "สกิลที่ {name} ใช้อยู่",
    zh: "{name} 当前使用的技能",
    my: "{name} ရဲ့ လက်ရှိ agent skill",
  },
  instActive: { en: "In use", th: "กำลังใช้", zh: "正在使用", my: "အသုံးပြုနေသည်" },
  instCustom: { en: "Your own wording", th: "ข้อความของคุณเอง", zh: "你自己写的内容", my: "သင်ကိုယ်တိုင် ရေးထားသည်" },
  instLength: { en: "{count} characters", th: "{count} ตัวอักษร", zh: "{count} 个字符", my: "စာလုံး {count} လုံး" },
  instTruncated: {
    en: "Shown up to the message limit. The assistant reads all of it.",
    th: "แสดงได้เท่าที่ข้อความรองรับ ผู้ช่วยอ่านทั้งหมด",
    zh: "此处只显示到消息长度上限，助手读取的是全文。",
    my: "message ကန့်သတ်ချက်အထိပဲ ပြထားပါသည်။ assistant ကတော့ အားလုံး ဖတ်ပါသည်။",
  },
  instClearConfirm: {
    en: "Delete the agent skill for {name}? The assistant goes back to its default behaviour. You can still undo this afterwards, and your documents and products are not touched.",
    th: "ลบสกิลของ {name} หรือไม่? ผู้ช่วยจะกลับไปใช้พฤติกรรมเริ่มต้น คุณยังย้อนกลับได้ภายหลัง และเอกสารกับสินค้าของคุณจะไม่ถูกแตะต้อง",
    zh: "要删除 {name} 的技能吗？助手会恢复默认行为。之后仍可撤销，你的文档和商品不受影响。",
    my: "{name} ရဲ့ agent skill ကို ဖျက်မလား? assistant က မူလအပြုအမူကို ပြန်သုံးပါမယ်။ နောက်မှ Undo လုပ်လို့ ရပါသေးတယ်၊ သင့် document နဲ့ ကုန်ပစ္စည်းတွေကို မထိပါ။",
  },
  btnChooseStyle: {
    en: "Choose a style",
    th: "เลือกสไตล์",
    zh: "选择风格",
    my: "ပုံစံ ရွေးမည်",
  },
  skillsTitle: {
    en: "How should this bot behave?",
    th: "ให้บอทนี้ทำตัวอย่างไร?",
    zh: "这个机器人该如何表现？",
    my: "ဒီ bot က ဘယ်လို ပြုမူသင့်လဲ?",
  },
  skillsBody: {
    en: "Pick a starting point. It is written in as ordinary instructions, so you can edit it afterwards or undo it. Your documents and products are not affected.",
    th: "เลือกจุดเริ่มต้นสักแบบ ระบบจะบันทึกเป็นคำสั่งธรรมดา คุณจึงแก้ไขหรือย้อนกลับได้ภายหลัง เอกสารและสินค้าของคุณไม่ได้รับผลกระทบ",
    zh: "先选一个起点。它会写成普通指令，之后你可以修改或撤销。你的文档和商品不受影响。",
    my: "အစပြုစရာ တစ်ခု ရွေးပါ။ ပုံမှန် ညွှန်ကြားချက်အဖြစ် ရေးသွင်းမှာမို့ နောက်မှ ပြင်လို့လည်း ရ၊ ပြန်ဖျက်လို့လည်း ရပါတယ်။ သင့် document နဲ့ ကုန်ပစ္စည်းတွေကို မထိပါ။",
  },

  // Human takeover --------------------------------------------------------------
  btnConversation: { en: "Conversation", th: "บทสนทนา", zh: "对话记录", my: "စကားဝိုင်း" },
  btnTakeOver: { en: "Take over", th: "รับช่วงต่อ", zh: "接手对话", my: "လူကိုယ်တိုင် ဖြေမည်" },
  btnSendAsHuman: { en: "Send a message", th: "ส่งข้อความ", zh: "发送消息", my: "စာပို့မည်" },
  btnHandBack: { en: "Give back to the assistant", th: "คืนให้ผู้ช่วย", zh: "交还给助手", my: "assistant ကို ပြန်အပ်မည်" },
  btnNeedsPerson: { en: "Waiting for a person", th: "รอเจ้าหน้าที่", zh: "等待人工", my: "လူ စောင့်နေသည်" },
  convTitle: { en: "Conversation with {name}", th: "บทสนทนากับ {name}", zh: "与 {name} 的对话", my: "{name} နှင့် စကားဝိုင်း" },
  convEmpty: {
    en: "Nothing has been said yet.",
    th: "ยังไม่มีข้อความ",
    zh: "还没有任何消息。",
    my: "ဘာမှ မပြောရသေးပါ။",
  },
  convCustomer: { en: "Customer", th: "ลูกค้า", zh: "客户", my: "ဝယ်သူ" },
  convAssistant: { en: "Assistant", th: "ผู้ช่วย", zh: "助手", my: "Assistant" },
  convHuman: { en: "You", th: "คุณ", zh: "你", my: "သင်" },
  convNoUsername: {
    en: "No Telegram username, so they can only be reached inside this chat.",
    th: "ไม่มีชื่อผู้ใช้ Telegram จึงติดต่อได้เฉพาะในแชทนี้",
    zh: "没有 Telegram 用户名，只能在这个对话里联系。",
    my: "Telegram username မရှိလို့ ဒီ chat ထဲကပဲ ဆက်သွယ်လို့ ရပါတယ်။",
  },
  btnShowMedia: { en: "Show {time}", th: "ดูของ {time}", zh: "查看 {time}", my: "{time} ကို ကြည့်" },
  mediaGone: {
    en: "That attachment is no longer available.",
    th: "ไฟล์แนบนี้ไม่มีอยู่แล้ว",
    zh: "该附件已不可用。",
    my: "အဲဒီ ပူးတွဲဖိုင် မရှိတော့ပါ။",
  },
  mediaFailed: {
    en: "Telegram would not hand that file over. Files older than a few months are usually gone.",
    th: "Telegram ไม่ยอมส่งไฟล์นั้นมา ไฟล์ที่เก่ากว่าไม่กี่เดือนมักถูกลบไปแล้ว",
    zh: "Telegram 无法提供该文件。超过几个月的文件通常已被清除。",
    my: "Telegram က အဲဒီဖိုင်ကို မပေးပါ။ လအနည်းငယ်ကျော်တဲ့ ဖိုင်တွေက များသောအားဖြင့် ပျောက်သွားပါပြီ။",
  },
  convStateWaiting: {
    en: "The assistant could not answer this and asked for a person.",
    th: "ผู้ช่วยตอบคำถามนี้ไม่ได้ จึงขอให้เจ้าหน้าที่ช่วย",
    zh: "助手无法回答这个问题，已请求人工协助。",
    my: "Assistant က ဒါကို မဖြေနိုင်လို့ လူတစ်ယောက် လိုအပ်ကြောင်း တောင်းဆိုထားပါတယ်။",
  },
  convStateHuman: {
    en: "You are answering this chat. The assistant is staying quiet until you give it back.",
    th: "คุณกำลังตอบแชทนี้อยู่ ผู้ช่วยจะเงียบจนกว่าคุณจะคืนให้",
    zh: "你正在回复这个对话。在你交还之前，助手不会作答。",
    my: "ဒီ chat ကို သင် ဖြေနေပါတယ်။ ပြန်မအပ်မချင်း assistant က တိတ်ဆိတ်နေပါမယ်။",
  },
  convSendBody: {
    en: "Type your reply. It is sent to the customer from the business bot, as though the business wrote it.",
    th: "พิมพ์คำตอบของคุณ ข้อความจะถูกส่งถึงลูกค้าผ่านบอทของธุรกิจ เสมือนว่าธุรกิจเป็นผู้เขียน",
    zh: "输入你的回复。消息将通过商家机器人发送给客户，就像商家亲自回复一样。",
    my: "သင့်အဖြေကို ရိုက်ပါ။ business bot ကနေ ဝယ်သူဆီ ပို့ပေးမှာဖြစ်ပြီး business ကိုယ်တိုင် ရေးသလို ဖြစ်ပါမယ်။",
  },
  convSent: { en: "Sent.", th: "ส่งแล้ว", zh: "已发送。", my: "ပို့ပြီးပါပြီ။" },
  convNoChat: {
    en: "This customer has no conversation to answer into yet.",
    th: "ลูกค้ารายนี้ยังไม่มีบทสนทนาให้ตอบ",
    zh: "该客户还没有可回复的对话。",
    my: "ဒီဝယ်သူမှာ ဖြေစရာ စကားဝိုင်း မရှိသေးပါ။",
  },
  convSendFailed: {
    en: "The message could not be delivered. The customer may have blocked the bot.",
    th: "ส่งข้อความไม่สำเร็จ ลูกค้าอาจบล็อกบอทไว้",
    zh: "消息发送失败。客户可能已屏蔽该机器人。",
    my: "စာ ပို့လို့ မရပါ။ ဝယ်သူက bot ကို block ထားနိုင်ပါတယ်။",
  },
  waitTitle: { en: "Waiting for a person", th: "รอเจ้าหน้าที่", zh: "等待人工", my: "လူ စောင့်နေသည်" },
  waitEmpty: {
    en: "No customer is waiting.",
    th: "ไม่มีลูกค้ารออยู่",
    zh: "没有客户在等待。",
    my: "စောင့်နေတဲ့ ဝယ်သူ မရှိပါ။",
  },

  // Cloudflare usage ----------------------------------------------------------
  btnUsage: { en: "Usage", th: "การใช้งาน", zh: "用量", my: "အသုံးပြုမှု" },
  usgTitle: {
    en: "Cloudflare usage",
    th: "การใช้งาน Cloudflare",
    zh: "Cloudflare 用量",
    my: "Cloudflare အသုံးပြုမှု",
  },
  usgToday: { en: "Today", th: "วันนี้", zh: "今天", my: "ယနေ့" },
  usgMonth: { en: "This month", th: "เดือนนี้", zh: "本月", my: "ဤလ" },
  usgNeurons: { en: "AI neurons", th: "AI neurons", zh: "AI neurons", my: "AI neurons" },
  usgRequests: { en: "Worker requests", th: "คำขอ Worker", zh: "Worker 请求", my: "Worker requests" },
  usgVectorQueried: {
    en: "Vectorize searched",
    th: "Vectorize ที่ค้นหา",
    zh: "Vectorize 查询量",
    my: "Vectorize ရှာဖွေမှု",
  },
  usgVectorStored: {
    en: "Vectorize stored",
    th: "Vectorize ที่เก็บไว้",
    zh: "Vectorize 存储量",
    my: "Vectorize သိမ်းဆည်းမှု",
  },
  usgMuxel: {
    en: "Answered by this deployment today",
    th: "ตอบโดยระบบนี้วันนี้",
    zh: "本部署今天已回复",
    my: "ဤ deployment က ယနေ့ ဖြေကြားပြီး",
  },
  usgMessages: { en: "replies", th: "การตอบ", zh: "条回复", my: "ခု" },
  usgTokens: { en: "tokens in / out", th: "โทเคน เข้า / ออก", zh: "输入 / 输出 tokens", my: "token ဝင် / ထွက်" },
  usgRepliesLeft: {
    en: "About {count} more replies fit in today's free allowance, at today's rate.",
    th: "ยังตอบได้อีกประมาณ {count} ครั้งภายในโควตาฟรีของวันนี้ ตามอัตราการใช้ปัจจุบัน",
    zh: "按今天的消耗速度，免费额度还够大约 {count} 条回复。",
    my: "ယနေ့ နှုန်းအတိုင်းဆိုရင် အခမဲ့ခွင့်ပြုချက်နဲ့ နောက်ထပ် {count} ခန့် ဖြေနိုင်ပါသေးတယ်။",
  },
  usgFreeNote: {
    en: "Limits shown are the Free plan allowance. On a paid plan they are included amounts, not caps.",
    th: "ขีดจำกัดที่แสดงคือโควตาของแผนฟรี หากใช้แผนแบบชำระเงิน ตัวเลขนี้คือส่วนที่รวมให้ ไม่ใช่เพดาน",
    zh: "所示额度为免费方案的配额。付费方案中这些是包含用量，而非上限。",
    my: "ပြထားတဲ့ ကန့်သတ်ချက်တွေက Free plan ခွင့်ပြုချက် ဖြစ်ပါတယ်။ ငွေပေးချေ plan မှာတော့ ဒါတွေက ပါဝင်တဲ့ ပမာဏဖြစ်ပြီး အမြင့်ဆုံး ကန့်သတ်ချက် မဟုတ်ပါ။",
  },
  usgNoToken: {
    en: "Account totals are not shown because no Cloudflare API token is set. Muxel's own measurements are above. To see the account figures, create a token with Account Analytics: Read and add it as the secret CF_API_TOKEN, along with CF_ACCOUNT_ID.",
    th: "ไม่แสดงยอดรวมของบัญชีเพราะยังไม่ได้ตั้งค่า Cloudflare API token ตัวเลขด้านบนคือค่าที่ Muxel วัดเอง หากต้องการดูยอดของบัญชี ให้สร้าง token ที่มีสิทธิ์ Account Analytics: Read แล้วเพิ่มเป็น secret ชื่อ CF_API_TOKEN พร้อมกับ CF_ACCOUNT_ID",
    zh: "未设置 Cloudflare API token，因此不显示账户总量。上方为 Muxel 自己的统计。若要查看账户数据，请创建具有 Account Analytics: Read 权限的 token，并将其添加为密钥 CF_API_TOKEN，同时设置 CF_ACCOUNT_ID。",
    my: "Cloudflare API token မထည့်ရသေးလို့ account စုစုပေါင်း မပြနိုင်ပါ။ အပေါ်က ဂဏန်းတွေက Muxel ကိုယ်တိုင် တိုင်းတာထားတာပါ။ Account ဂဏန်းတွေ ကြည့်ချင်ရင် Account Analytics: Read ခွင့်ပြုချက်ပါတဲ့ token တစ်ခု ဆောက်ပြီး CF_ACCOUNT_ID နဲ့အတူ CF_API_TOKEN secret အဖြစ် ထည့်ပါ။",
  },
  usgUnreachable: {
    en: "Cloudflare could not be reached, or the token lacks Account Analytics: Read. Muxel's own measurements are above.",
    th: "ติดต่อ Cloudflare ไม่ได้ หรือ token ไม่มีสิทธิ์ Account Analytics: Read ตัวเลขด้านบนคือค่าที่ Muxel วัดเอง",
    zh: "无法连接 Cloudflare，或该 token 缺少 Account Analytics: Read 权限。上方为 Muxel 自己的统计。",
    my: "Cloudflare ကို ဆက်သွယ်လို့ မရပါ၊ ဒါမှမဟုတ် token မှာ Account Analytics: Read ခွင့်ပြုချက် မပါပါ။ အပေါ်က ဂဏန်းတွေက Muxel ကိုယ်တိုင် တိုင်းတာထားတာပါ။",
  },

  // Updates -------------------------------------------------------------------
  btnUpdates: { en: "Updates", th: "อัปเดต", zh: "更新", my: "အပ်ဒိတ်" },
  updTitle: { en: "Updates", th: "อัปเดต", zh: "更新", my: "အပ်ဒိတ်" },
  updCurrent: {
    en: "This deployment is up to date, running {running}.",
    th: "ระบบนี้เป็นเวอร์ชันล่าสุดแล้ว กำลังใช้ {running}",
    zh: "此部署已是最新版本，正在运行 {running}。",
    my: "ဤ deployment သည် နောက်ဆုံးဗားရှင်း ဖြစ်ပါသည် — {running} ကို သုံးနေပါသည်။",
  },
  updBehind: {
    en: "Muxel {latest} is available. This deployment is running {running}.",
    th: "มี Muxel {latest} แล้ว ระบบนี้กำลังใช้ {running}",
    zh: "Muxel {latest} 已发布。此部署正在运行 {running}。",
    my: "Muxel {latest} ထွက်ပါပြီ။ ဤ deployment က {running} ကို သုံးနေပါသည်။",
  },
  updUnknown: {
    en: "GitHub could not be reached, so the latest version is unknown. This deployment is running {running}.",
    th: "ติดต่อ GitHub ไม่ได้ จึงไม่ทราบเวอร์ชันล่าสุด ระบบนี้กำลังใช้ {running}",
    zh: "无法连接 GitHub，暂时无法得知最新版本。此部署正在运行 {running}。",
    my: "GitHub ကို ဆက်သွယ်လို့ မရလို့ နောက်ဆုံးဗားရှင်း မသိရပါ။ ဤ deployment က {running} ကို သုံးနေပါသည်။",
  },
  updHow: {
    en: "Updating is a manual step, because the one click deploy copies this project without a link back to it. Open {repo} and follow \"Staying up to date\". Your businesses, data and bots are not touched.",
    th: "การอัปเดตต้องทำเอง เพราะการติดตั้งแบบคลิกเดียวจะคัดลอกโปรเจกต์โดยไม่มีลิงก์กลับ เปิด {repo} แล้วทำตามหัวข้อ \"Staying up to date\" ธุรกิจ ข้อมูล และบอทของคุณจะไม่ถูกแตะต้อง",
    zh: "更新需要手动进行，因为一键部署复制的副本没有指回本项目的链接。请打开 {repo} 并按照 \"Staying up to date\" 操作。你的商家、数据和机器人不会受到影响。",
    my: "One click deploy က ဤ project ကို ပြန်ချိတ်ဆက်မှု မပါဘဲ ကူးယူတာဖြစ်လို့ update ကို ကိုယ်တိုင် လုပ်ရပါမည်။ {repo} ကို ဖွင့်ပြီး \"Staying up to date\" အတိုင်း လုပ်ပါ။ သင့် business, data နှင့် bot များကို မထိပါ။",
  },
  btnCheckAgain: {
    en: "Check again",
    th: "ตรวจสอบอีกครั้ง",
    zh: "重新检查",
    my: "ထပ်စစ်မည်",
  },

  // Console bot -------------------------------------------------------------
  btnConsoleBot: { en: "Console bot", th: "บอทคอนโซล", zh: "控制台机器人", my: "Console bot" },
  consoleBotTitle: { en: "Console bot", th: "บอทคอนโซล", zh: "控制台机器人", my: "Console bot" },
  consoleBotBody: {
    en: "This bot, @{username}, is your private control panel. It manages every business and no customer can reach it. It is never attached to a business.",
    th: "บอทนี้ @{username} คือแผงควบคุมส่วนตัวของคุณ ใช้จัดการทุกธุรกิจ และลูกค้าเข้าถึงไม่ได้ อีกทั้งไม่ผูกกับธุรกิจใด",
    zh: "这个机器人 @{username} 是你的私人控制面板。它管理所有商家，客户无法访问，也不会归属于任何一个商家。",
    my: "ဤ bot @{username} သည် သင့်သီးသန့် ထိန်းချုပ်ရာနေရာဖြစ်သည်။ လုပ်ငန်းအားလုံးကို စီမံပြီး customer မရောက်နိုင်ပါ။ လုပ်ငန်းတစ်ခုနှင့်မှ တွဲမထားပါ။",
  },
  bizModel: { en: "Model", th: "โมเดล", zh: "模型", my: "Model" },
  bizLanguage: { en: "Reply language", th: "ภาษาที่ตอบ", zh: "回复语言", my: "ဖြေမည့် ဘာသာစကား" },
  bizDocuments: { en: "Data files", th: "ไฟล์ข้อมูล", zh: "数据文件", my: "ဒေတာ ဖိုင်" },
  bizProducts: { en: "Products", th: "สินค้า", zh: "商品", my: "ကုန်ပစ္စည်း" },
  bizCustomers: { en: "Customers", th: "ลูกค้า", zh: "客户", my: "customer" },
  bizInstructions: { en: "Instructions", th: "คำสั่ง", zh: "指令", my: "ညွှန်ကြားချက်" },
  bizDefault: { en: "default", th: "ค่าเริ่มต้น", zh: "默认", my: "မူလအတိုင်း" },
  bizToday: {
    en: "Today: {messages} messages, {tokens} tokens",
    th: "วันนี้: {messages} ข้อความ, {tokens} โทเคน",
    zh: "今日：{messages} 条消息，{tokens} 个 token",
    my: "ဒီနေ့: message {messages} ခု, token {tokens}",
  },
  btnData: { en: "Data", th: "ข้อมูล", zh: "数据", my: "ဒေတာ" },
  btnProducts: { en: "Products", th: "สินค้า", zh: "商品", my: "ကုန်ပစ္စည်း" },
  btnCustomers: { en: "Customers", th: "ลูกค้า", zh: "客户", my: "customer" },
  btnInstructions: { en: "Instructions", th: "คำสั่ง", zh: "指令", my: "ညွှန်ကြားချက်" },
  btnBots: { en: "Bots", th: "บอท", zh: "机器人", my: "Bot" },
  btnModel: { en: "Change model", th: "เปลี่ยนโมเดล", zh: "更换模型", my: "Model ပြောင်း" },
  btnDeleteBusiness: { en: "Delete business", th: "ลบธุรกิจ", zh: "删除商家", my: "လုပ်ငန်း ဖျက်" },
  bizDeleteConfirm: {
    en: "Delete {name}?\n\nThis removes its data files, products, customers and bots. It cannot be undone.",
    th: "ลบ {name} หรือไม่?\n\nการดำเนินการนี้จะลบไฟล์ข้อมูล สินค้า ลูกค้า และบอททั้งหมด และไม่สามารถย้อนกลับได้",
    zh: "删除 {name}？\n\n这会移除其数据文件、商品、客户与机器人，且无法撤销。",
    my: "{name} ကို ဖျက်မလား?\n\nဒေတာဖိုင်၊ ကုန်ပစ္စည်း၊ customer နှင့် bot အားလုံး ပျက်သွားပါမည်။ ပြန်ရလို့ မရပါ။",
  },

  // Data --------------------------------------------------------------------
  dataTitle: { en: "Data for {name}", th: "ข้อมูลของ {name}", zh: "{name} 的数据", my: "{name} ၏ ဒေတာ" },
  dataEmpty: { en: "Nothing yet.", th: "ยังไม่มี", zh: "暂无内容。", my: "ဘာမှ မရှိသေးပါ။" },
  dataHint: {
    en: "Accepted: PDF, Word, Excel, CSV, TXT, Markdown, JSON and JSONL.",
    th: "รองรับ: PDF, Word, Excel, CSV, TXT, Markdown, JSON และ JSONL",
    zh: "支持：PDF、Word、Excel、CSV、TXT、Markdown、JSON 和 JSONL。",
    my: "လက်ခံသည်: PDF, Word, Excel, CSV, TXT, Markdown, JSON, JSONL",
  },
  btnAddData: { en: "Add data", th: "เพิ่มข้อมูล", zh: "添加数据", my: "ဒေတာ ထည့်" },
  btnSeeData: { en: "See data", th: "ดูข้อมูล", zh: "查看数据", my: "ဒေတာ ကြည့်" },
  dataAddTitle: { en: "Add data", th: "เพิ่มข้อมูล", zh: "添加数据", my: "ဒေတာ ထည့်" },
  dataAddBody: {
    en: "Send the file to this chat now.",
    th: "ส่งไฟล์มาที่แชทนี้ได้เลย",
    zh: "现在把文件发送到此聊天。",
    my: "ဖိုင်ကို ဤ chat ထဲ ပို့လိုက်ပါ။",
  },
  dataReading: { en: "Reading the file...", th: "กำลังอ่านไฟล์...", zh: "正在读取文件…", my: "ဖိုင် ဖတ်နေသည်..." },
  dataAdded: {
    en: "Added {name} as {chunks} pieces.",
    th: "เพิ่ม {name} แล้ว แบ่งเป็น {chunks} ส่วน",
    zh: "已添加 {name}，共 {chunks} 段。",
    my: "{name} ကို အပိုင်း {chunks} ခုအဖြစ် ထည့်ပြီးပါပြီ။",
  },
  dataWorking: {
    en: "Adding {name}",
    th: "กำลังเพิ่ม {name}",
    zh: "正在添加 {name}",
    my: "{name} ကို ထည့်နေသည်",
  },
  dataStepIndexing: {
    en: "Reading and indexing the contents",
    th: "กำลังอ่านและจัดทำดัชนีเนื้อหา",
    zh: "正在读取并建立内容索引",
    my: "အကြောင်းအရာကို ဖတ်ပြီး index လုပ်နေသည်",
  },
  dataStepSettling: {
    en: "Waiting for the search index to catch up",
    th: "กำลังรอให้ดัชนีค้นหาพร้อมใช้งาน",
    zh: "正在等待搜索索引同步",
    my: "ရှာဖွေရေး index လိုက်မီအောင် စောင့်နေသည်",
  },
  dataCheckPrompt: {
    en: "The index is still catching up. Press below to check whether the assistant can find it yet, rather than testing and being told nobody knows.",
    th: "ดัชนียังไม่พร้อม กดด้านล่างเพื่อตรวจว่าผู้ช่วยค้นเจอแล้วหรือยัง จะได้ไม่ต้องลองแล้วได้คำตอบว่าไม่ทราบ",
    zh: "索引还在同步。点击下面即可查看助手是否已经能找到它，不必先去测试却被告知不知道。",
    my: "Index က လိုက်နေဆဲပါ။ စမ်းပြီးမှ \"မသိပါ\" ဆိုတဲ့ အဖြေ မရအောင်၊ assistant ရှာတွေ့ပြီလားဆိုတာ အောက်က ခလုတ်နဲ့ စစ်ကြည့်ပါ။",
  },
  btnDataCheck: {
    en: "Check if it is ready",
    th: "ตรวจว่าพร้อมหรือยัง",
    zh: "检查是否就绪",
    my: "အဆင်သင့် ဖြစ်ပြီလား စစ်မည်",
  },
  dataCheckReady: {
    en: "Ready. The assistant can find your data now, so go ahead and test it.",
    th: "พร้อมแล้ว ผู้ช่วยค้นข้อมูลของคุณเจอแล้ว ทดสอบได้เลย",
    zh: "已就绪。助手现在可以找到你的数据了，可以开始测试。",
    my: "အဆင်သင့် ဖြစ်ပါပြီ။ assistant က သင့် data ကို ရှာတွေ့ပါပြီ — စမ်းကြည့်လို့ ရပါပြီ။",
  },
  dataCheckWaiting: {
    en: "Not yet. The index is still catching up, which usually takes under a minute in total. Press again in a moment.",
    th: "ยังไม่พร้อม ดัชนียังตามอยู่ ปกติใช้เวลารวมไม่ถึงหนึ่งนาที กดอีกครั้งในอีกสักครู่",
    zh: "还没有。索引仍在同步，通常总共不到一分钟。请稍后再点一次。",
    my: "မဖြစ်သေးပါ။ Index က လိုက်နေဆဲပါ — စုစုပေါင်း တစ်မိနစ်အောက်သာ ကြာလေ့ရှိပါတယ်။ ခဏနေ ထပ်နှိပ်ကြည့်ပါ။",
  },
  dataIndexing: {
    en: "Added {name} as {chunks} pieces. The search index needs about a minute to catch up, so the assistant will say it does not know until then. Wait a moment before you test it.",
    th: "เพิ่ม {name} แล้ว แบ่งเป็น {chunks} ส่วน ดัชนีค้นหาต้องใช้เวลาราวหนึ่งนาทีจึงจะพร้อม ระหว่างนี้ผู้ช่วยจะตอบว่าไม่ทราบ กรุณารอสักครู่ก่อนทดสอบ",
    zh: "已添加 {name}，共 {chunks} 段。搜索索引大约需要一分钟才能同步，在那之前助手会回答不知道。请稍等片刻再测试。",
    my: "{name} ကို အပိုင်း {chunks} ခုအဖြစ် ထည့်ပြီးပါပြီ။ ရှာဖွေရေး index က တစ်မိနစ်ခန့် အချိန်ယူပါသေးတယ် — အဲဒီအထိ assistant က \"မသိပါ\" လို့ ဖြေပါလိမ့်မယ်။ ခဏစောင့်ပြီးမှ စမ်းပါ။",
  },
  dataFailed: { en: "Could not add that file: {reason}", th: "เพิ่มไฟล์ไม่สำเร็จ: {reason}", zh: "无法添加该文件：{reason}", my: "ဖိုင် မထည့်နိုင်ပါ: {reason}" },
  dataNoBusiness: {
    en: "Choose a business first, then send the file.",
    th: "เลือกธุรกิจก่อน แล้วจึงส่งไฟล์",
    zh: "请先选择商家，然后再发送文件。",
    my: "လုပ်ငန်းတစ်ခု အရင်ရွေးပါ၊ ပြီးမှ ဖိုင်ပို့ပါ။",
  },
  dataDetail: {
    en: "{name}\n\nStatus: {status}\nPieces: {chunks}\nSize: {size}\nAdded: {added}",
    th: "{name}\n\nสถานะ: {status}\nส่วน: {chunks}\nขนาด: {size}\nเพิ่มเมื่อ: {added}",
    zh: "{name}\n\n状态：{status}\n段数：{chunks}\n大小：{size}\n添加时间：{added}",
    my: "{name}\n\nအခြေအနေ: {status}\nအပိုင်း: {chunks}\nအရွယ်: {size}\nထည့်သည့်ရက်: {added}",
  },
  btnDeleteData: { en: "Delete this file", th: "ลบไฟล์นี้", zh: "删除此文件", my: "ဤဖိုင် ဖျက်" },
  dataDeleteConfirm: {
    en: "Delete {name} from the knowledge?",
    th: "ลบ {name} ออกจากคลังความรู้หรือไม่?",
    zh: "从知识库中删除 {name}？",
    my: "{name} ကို knowledge ထဲက ဖျက်မလား?",
  },

  // Products ----------------------------------------------------------------
  prodTitle: { en: "Products of {name}", th: "สินค้าของ {name}", zh: "{name} 的商品", my: "{name} ၏ ကုန်ပစ္စည်း" },
  prodEmpty: {
    en: "No products yet. Add them one at a time, or upload a file.",
    th: "ยังไม่มีสินค้า เพิ่มทีละรายการ หรืออัปโหลดไฟล์",
    zh: "还没有商品。可逐个添加，或上传文件。",
    my: "ကုန်ပစ္စည်း မရှိသေးပါ။ တစ်ခုချင်း ထည့်ပါ၊ သို့မဟုတ် ဖိုင် တင်ပါ။",
  },
  btnAddProduct: { en: "Add one product", th: "เพิ่มสินค้าทีละรายการ", zh: "添加单个商品", my: "တစ်ခုချင်း ထည့်" },
  btnBulkProducts: { en: "Upload a product file", th: "อัปโหลดไฟล์สินค้า", zh: "上传商品文件", my: "ကုန်ပစ္စည်းဖိုင် တင်" },
  prodAddTitle: { en: "Add a product", th: "เพิ่มสินค้า", zh: "添加商品", my: "ကုန်ပစ္စည်း ထည့်" },
  prodAddBody: {
    en: "Send one line:\n\nname | price | description\n\nThe price and description are optional.",
    th: "ส่งหนึ่งบรรทัด:\n\nชื่อ | ราคา | รายละเอียด\n\nราคาและรายละเอียดใส่หรือไม่ก็ได้",
    zh: "发送一行：\n\n名称 | 价格 | 描述\n\n价格与描述可省略。",
    my: "တစ်ကြောင်း ပို့ပါ:\n\nအမည် | ဈေးနှုန်း | ဖော်ပြချက်\n\nဈေးနှုန်းနှင့် ဖော်ပြချက် မထည့်လည်း ရပါသည်။",
  },
  prodAddInvalid: {
    en: "Send at least a product name.",
    th: "กรุณาส่งอย่างน้อยชื่อสินค้า",
    zh: "请至少提供商品名称。",
    my: "အနည်းဆုံး ကုန်ပစ္စည်းအမည် ပို့ပါ။",
  },
  prodDerived: {
    en: "Read from your uploaded data. To change what is here, change the data, or correct a single item from its own page.",
    th: "อ่านจากข้อมูลที่คุณอัปโหลด หากต้องการแก้ไข ให้แก้ที่ข้อมูล หรือแก้ทีละรายการจากหน้าของรายการนั้น",
    zh: "读取自你上传的数据。要修改内容，请修改数据，或在单个条目的页面里更正它。",
    my: "သင်တင်ထားတဲ့ data ကနေ ဖတ်ထားတာပါ။ ပြောင်းချင်ရင် data ကို ပြောင်းပါ၊ ဒါမှမဟုတ် တစ်ခုချင်းရဲ့ စာမျက်နှာကနေ ပြင်ပါ။",
  },
  prodScanning: {
    en: "Still reading your latest upload. Check back in a minute.",
    th: "กำลังอ่านไฟล์ล่าสุดของคุณอยู่ กรุณากลับมาดูอีกครั้งในหนึ่งนาที",
    zh: "还在读取你最近上传的文件，请稍后再看。",
    my: "နောက်ဆုံးတင်ထားတဲ့ ဖိုင်ကို ဖတ်နေဆဲပါ။ တစ်မိနစ်လောက်နေ ပြန်ကြည့်ပါ။",
  },
  prodEmptyDerived: {
    en: "No products or services found in your data yet. Upload a price list under Add data, or add one item by typing.",
    th: "ยังไม่พบสินค้าหรือบริการในข้อมูลของคุณ อัปโหลดรายการราคาที่ Add data หรือพิมพ์เพิ่มทีละรายการ",
    zh: "还没有在你的数据中找到商品或服务。请在 Add data 上传价格表，或手动输入添加。",
    my: "သင့် data ထဲမှာ ကုန်ပစ္စည်း ဒါမှမဟုတ် ဝန်ဆောင်မှု မတွေ့သေးပါ။ Add data ကနေ ဈေးနှုန်းစာရင်း တင်ပါ၊ ဒါမှမဟုတ် စာရိုက်ပြီး တစ်ခုချင်း ထည့်ပါ။",
  },
  btnRescanProducts: {
    en: "Re-read from data",
    th: "อ่านจากข้อมูลใหม่",
    zh: "重新从数据读取",
    my: "Data ကနေ ပြန်ဖတ်မည်",
  },
  prodSource: { en: "From: {name}", th: "จาก: {name}", zh: "来自：{name}", my: "မှ: {name}" },
  prodTyped: {
    en: "Added by you from the console.",
    th: "คุณเพิ่มเองจากคอนโซล",
    zh: "由你在控制台添加。",
    my: "Console ကနေ သင်ကိုယ်တိုင် ထည့်ထားတာပါ။",
  },
  prodEditedNote: {
    en: "Corrected by you. Your correction wins over the documents.",
    th: "คุณแก้ไขแล้ว การแก้ไขของคุณมีผลเหนือเอกสาร",
    zh: "已被你更正。你的更正优先于文档内容。",
    my: "သင် ပြင်ထားပါတယ်။ သင့်ပြင်ဆင်ချက်က document ထက် အနိုင်ရပါတယ်။",
  },
  btnFixProduct: {
    en: "Correct this item",
    th: "แก้ไขรายการนี้",
    zh: "更正此条目",
    my: "ဒီတစ်ခုကို ပြင်မည်",
  },
  btnRemoveProduct: {
    en: "No longer sold",
    th: "เลิกขายแล้ว",
    zh: "已停售",
    my: "မရောင်းတော့ပါ",
  },
  prodFixBody: {
    en: "{name} is currently {price}. Send the correct price, or price | description.\n\nThe assistant learns this immediately, and it wins over what the documents say.",
    th: "ตอนนี้ {name} ราคา {price} ส่งราคาที่ถูกต้อง หรือ ราคา | รายละเอียด\n\nผู้ช่วยจะรู้ทันที และข้อมูลนี้มีผลเหนือเอกสาร",
    zh: "{name} 目前为 {price}。发送正确的价格，或 价格 | 描述。\n\n助手会立即学到，并且它优先于文档中的内容。",
    my: "{name} က လက်ရှိ {price} ပါ။ မှန်ကန်တဲ့ ဈေးနှုန်း ဒါမှမဟုတ် ဈေးနှုန်း | ဖော်ပြချက် ပို့ပါ။\n\nAssistant က ချက်ချင်း သိသွားပြီး document ထဲက အချက်ထက် ဒါက အနိုင်ရပါတယ်။",
  },
  prodRemoveConfirm: {
    en: "Mark {name} as no longer available? The assistant will tell customers it is gone, whatever the documents say. Your documents are not touched.",
    th: "ทำเครื่องหมายว่า {name} เลิกขายแล้ว? ผู้ช่วยจะบอกลูกค้าว่าไม่มีแล้ว ไม่ว่าเอกสารจะว่าอย่างไร เอกสารของคุณจะไม่ถูกแก้ไข",
    zh: "将 {name} 标记为不再供应？无论文档怎么写，助手都会告诉客户它已下架。你的文档不会被改动。",
    my: "{name} ကို မရောင်းတော့ဘူးလို့ မှတ်မလား? Document ထဲမှာ ဘယ်လိုပဲရေးထားထား assistant က ဝယ်သူတွေကို မရှိတော့ကြောင်း ပြောပါလိမ့်မယ်။ သင့် document တွေကို မထိပါ။",
  },
  prodNotAList: {
    en: "That file does not read as a product list. Each line needs a name and its fields separated by | or a comma, like: Whole Milk | $2.40 | 1 gallon. A PDF cannot be read this way, because its text arrives as loose fragments. Send the price list under Add data instead, where the assistant reads it as a document, or upload a CSV or Excel file here.",
    th: "ไฟล์นี้อ่านเป็นรายการสินค้าไม่ได้ แต่ละบรรทัดต้องมีชื่อและแยกฟิลด์ด้วย | หรือจุลภาค เช่น Whole Milk | $2.40 | 1 gallon ไฟล์ PDF อ่านแบบนี้ไม่ได้ เพราะข้อความจะออกมาเป็นชิ้นส่วนกระจัดกระจาย กรุณาส่งรายการราคาผ่าน Add data เพื่อให้ผู้ช่วยอ่านเป็นเอกสาร หรืออัปโหลดไฟล์ CSV หรือ Excel ที่นี่",
    zh: "这个文件无法作为商品清单读取。每一行都需要有名称，字段之间用 | 或逗号分隔，例如：Whole Milk | $2.40 | 1 gallon。PDF 无法这样读取，因为它的文字会变成零散的片段。请改用 Add data 上传价格表，让助手把它当作文档来读，或者在这里上传 CSV 或 Excel 文件。",
    my: "ဒီဖိုင်ကို ကုန်ပစ္စည်းစာရင်းအဖြစ် ဖတ်လို့ မရပါ။ စာကြောင်းတိုင်းမှာ အမည်ပါရမည်ဖြစ်ပြီး field များကို | သို့မဟုတ် ကော်မာနဲ့ ခွဲရပါမည်။ ဥပမာ: Whole Milk | $2.40 | 1 gallon။ PDF ကို ဒီနည်းနဲ့ ဖတ်လို့ မရပါ — စာသားက အပိုင်းအစလေးတွေအဖြစ် ထွက်လာလို့ပါ။ ဈေးနှုန်းစာရင်းကို Add data ကနေ ပို့ပါ၊ assistant က document အဖြစ် ဖတ်ပါလိမ့်မယ်။ ဒါမှမဟုတ် CSV သို့မဟုတ် Excel ဖိုင်ကို ဒီမှာ တင်ပါ။",
  },
  btnClearProducts: {
    en: "Remove every product",
    th: "ลบสินค้าทั้งหมด",
    zh: "删除所有商品",
    my: "ကုန်ပစ္စည်းအားလုံး ဖျက်",
  },
  prodClearConfirm: {
    en: "Remove all {count} products from {name}? Your documents are not touched.",
    th: "ลบสินค้าทั้งหมด {count} รายการออกจาก {name} หรือไม่? เอกสารของคุณจะไม่ถูกแตะต้อง",
    zh: "要从 {name} 中删除全部 {count} 件商品吗？你的文档不会受到影响。",
    my: "{name} က ကုန်ပစ္စည်း {count} ခုလုံး ဖျက်မလား? သင့် document များကို မထိပါ။",
  },
  prodCleared: {
    en: "Removed {count} products.",
    th: "ลบสินค้าแล้ว {count} รายการ",
    zh: "已删除 {count} 件商品。",
    my: "ကုန်ပစ္စည်း {count} ခု ဖျက်ပြီးပါပြီ။",
  },
  btnDeleteProduct: { en: "Delete this product", th: "ลบสินค้านี้", zh: "删除此商品", my: "ဤပစ္စည်း ဖျက်" },
  prodDeleteConfirm: { en: "Delete {name}?", th: "ลบ {name} หรือไม่?", zh: "删除 {name}？", my: "{name} ကို ဖျက်မလား?" },
  prodSynced: {
    en: "The assistant now knows about {count} products.",
    th: "ผู้ช่วยรู้จักสินค้า {count} รายการแล้ว",
    zh: "助手现在了解 {count} 件商品。",
    my: "အခု assistant က ကုန်ပစ္စည်း {count} မျိုး သိပါပြီ။",
  },

  // Instructions ------------------------------------------------------------
  instTitle: { en: "Instructions for {name}", th: "คำสั่งสำหรับ {name}", zh: "{name} 的指令", my: "{name} အတွက် ညွှန်ကြားချက်" },
  instBody: {
    en: "Tone, rules and anything the assistant should always know. This is your own text and is trusted, unlike uploaded files.",
    th: "น้ำเสียง กฎ และสิ่งที่ผู้ช่วยควรรู้เสมอ ข้อความนี้เป็นของคุณเองและเชื่อถือได้ ต่างจากไฟล์ที่อัปโหลด",
    zh: "语气、规则，以及助手应始终知道的内容。这是你自己撰写的文本，与上传文件不同，会被信任。",
    my: "လေသံ၊ စည်းမျဉ်းနှင့် assistant အမြဲသိထားရမည့် အရာများ။ ဤစာမှာ သင် ကိုယ်တိုင် ရေးသောကြောင့် ယုံကြည်ရသည် — တင်ထားသော ဖိုင်များနှင့် မတူပါ။",
  },
  instUsingDefault: { en: "Using the default instructions.", th: "กำลังใช้คำสั่งค่าเริ่มต้น", zh: "正在使用默认指令。", my: "မူလ ညွှန်ကြားချက် သုံးနေသည်။" },
  btnEditInstructions: { en: "Replace", th: "แทนที่", zh: "替换", my: "အစားထိုး" },
  btnUndoInstructions: { en: "Undo last change", th: "ย้อนการแก้ไขล่าสุด", zh: "撤销上次更改", my: "နောက်ဆုံးပြင်ဆင်မှု ပြန်ဖျက်" },
  btnResetInstructions: { en: "Reset to default", th: "รีเซ็ตเป็นค่าเริ่มต้น", zh: "恢复默认", my: "မူလအတိုင်း ပြန်ထား" },
  instEditBody: {
    en: "Send the new instructions as a message, or send a .md or .txt file. Up to {limit} characters.",
    th: "ส่งคำสั่งใหม่เป็นข้อความ หรือส่งไฟล์ .md หรือ .txt ได้สูงสุด {limit} ตัวอักษร",
    zh: "以消息形式发送新指令，或发送 .md 或 .txt 文件。最多 {limit} 个字符。",
    my: "ညွှန်ကြားချက်အသစ်ကို message အဖြစ် ပို့ပါ၊ သို့မဟုတ် .md / .txt ဖိုင် ပို့ပါ။ စာလုံး {limit} အထိ။",
  },
  instNothing: { en: "Nothing to save.", th: "ไม่มีข้อมูลให้บันทึก", zh: "没有可保存的内容。", my: "သိမ်းစရာ မရှိပါ။" },

  // Customers ---------------------------------------------------------------
  custTitle: { en: "Customers of {name}", th: "ลูกค้าของ {name}", zh: "{name} 的客户", my: "{name} ၏ customer များ" },
  custEmpty: { en: "Nobody has written yet.", th: "ยังไม่มีใครทักมา", zh: "还没有人来消息。", my: "ဘယ်သူမှ မစာမပို့ရသေးပါ။" },
  custRecent: { en: "{count} most recent.", th: "ล่าสุด {count} ราย", zh: "最近 {count} 位。", my: "နောက်ဆုံး {count} ဦး။" },
  custStage: { en: "Stage", th: "สถานะ", zh: "阶段", my: "အဆင့်" },
  custMessages: { en: "Messages", th: "ข้อความ", zh: "消息数", my: "message" },
  custFirstSeen: { en: "First seen", th: "พบครั้งแรก", zh: "首次出现", my: "ပထမဆုံး တွေ့သည့်ရက်" },
  custNote: { en: "Note", th: "บันทึก", zh: "备注", my: "မှတ်ချက်" },
  custRemembered: { en: "Remembered", th: "สิ่งที่จำได้", zh: "已记住", my: "မှတ်ထားသည်များ" },
  custNothingKnown: { en: "Nothing remembered yet.", th: "ยังไม่ได้จำอะไร", zh: "尚未记住任何内容。", my: "ဘာမှ မမှတ်ရသေးပါ။" },
  btnAddNote: { en: "Add note", th: "เพิ่มบันทึก", zh: "添加备注", my: "မှတ်ချက် ထည့်" },
  btnMarkAs: { en: "Mark as {stage}", th: "ตั้งเป็น {stage}", zh: "标记为 {stage}", my: "{stage} အဖြစ် သတ်မှတ်" },
  btnForgetFacts: { en: "Forget what is remembered", th: "ลืมสิ่งที่จำไว้", zh: "忘记已记住的内容", my: "မှတ်ထားသည်များ မေ့ပစ်" },
  btnDeleteCustomer: { en: "Delete customer", th: "ลบลูกค้า", zh: "删除客户", my: "customer ဖျက်" },
  custNoteBody: {
    en: "Send the note as a message. It replaces the current one.",
    th: "ส่งบันทึกเป็นข้อความ ระบบจะแทนที่บันทึกเดิม",
    zh: "以消息形式发送备注，将替换现有备注。",
    my: "မှတ်ချက်ကို message အဖြစ် ပို့ပါ။ ရှိပြီးသားကို အစားထိုးပါမည်။",
  },
  stageNew: { en: "new", th: "ใหม่", zh: "新", my: "အသစ်" },
  stageLead: { en: "lead", th: "ผู้สนใจ", zh: "潜在", my: "စိတ်ဝင်စား" },
  stageCustomer: { en: "customer", th: "ลูกค้า", zh: "客户", my: "customer" },
  stageBlocked: { en: "blocked", th: "ถูกบล็อก", zh: "已屏蔽", my: "ပိတ်ထား" },

  // Bots --------------------------------------------------------------------
  botsTitle: { en: "Bots for {name}", th: "บอทของ {name}", zh: "{name} 的机器人", my: "{name} ၏ bot များ" },
  botsEmpty: { en: "No bots connected yet.", th: "ยังไม่ได้เชื่อมต่อบอท", zh: "尚未连接机器人。", my: "bot မချိတ်ရသေးပါ။" },
  botConsole: { en: "Console", th: "คอนโซล", zh: "控制台", my: "Console" },
  botCustomer: { en: "Customer", th: "ลูกค้า", zh: "客户", my: "Customer" },
  btnConnectBot: { en: "Connect customer bot", th: "เชื่อมต่อบอทลูกค้า", zh: "连接客户机器人", my: "customer bot ချိတ်" },
  btnReplaceConsole: { en: "Replace console bot", th: "เปลี่ยนบอทคอนโซล", zh: "更换控制台机器人", my: "console bot ပြောင်း" },
  botAddBody: {
    en: "Create a bot with @BotFather, then send its token here. The token is encrypted before storage and your message is deleted straight away.",
    th: "สร้างบอทด้วย @BotFather แล้วส่งโทเคนมาที่นี่ โทเคนจะถูกเข้ารหัสก่อนจัดเก็บ และข้อความของคุณจะถูกลบทันที",
    zh: "用 @BotFather 创建机器人，然后把 token 发到这里。token 会在存储前加密，你的消息会被立即删除。",
    my: "@BotFather နှင့် bot ဆောက်ပြီး token ကို ဤနေရာ ပို့ပါ။ token ကို သိမ်းမီ encrypt လုပ်ပြီး သင့် message ကို ချက်ချင်း ဖျက်ပါမည်။",
  },
  botReplaceWarning: {
    en: "The current console bot stops responding as soon as this succeeds, so continue in the new one.",
    th: "บอทคอนโซลปัจจุบันจะหยุดตอบทันทีที่สำเร็จ กรุณาใช้งานต่อในบอทใหม่",
    zh: "一旦成功，当前控制台机器人将停止响应，请在新机器人中继续。",
    my: "အောင်မြင်သည်နှင့် လက်ရှိ console bot ရပ်သွားမည်ဖြစ်၍ bot အသစ်တွင် ဆက်လုပ်ပါ။",
  },
  botRejected: { en: "Telegram rejected that token.", th: "Telegram ปฏิเสธโทเคนนี้", zh: "Telegram 拒绝了该 token。", my: "Telegram က အဲဒီ token ကို ငြင်းပယ်ပါသည်။" },
  botMoved: {
    en: "Console moved to @{username}. Send /start here to continue.",
    th: "ย้ายคอนโซลไปที่ @{username} แล้ว ส่ง /start ที่นี่เพื่อดำเนินการต่อ",
    zh: "控制台已迁移到 @{username}。在此发送 /start 继续。",
    my: "Console ကို @{username} သို့ ပြောင်းပြီးပါပြီ။ ဆက်လုပ်ရန် /start ပို့ပါ။",
  },

  // Model -------------------------------------------------------------------
  modelTitle: { en: "Model for {name}", th: "โมเดลของ {name}", zh: "{name} 的模型", my: "{name} အတွက် model" },
  modelBody: {
    en: "Pick the model that answers customers. Models marked with a key need a provider key in your AI Gateway. Your Cloudflare login covers the unmarked ones.",
    th: "เลือกโมเดลที่จะตอบลูกค้า โมเดลที่ระบุว่าต้องใช้คีย์ ต้องมีคีย์ผู้ให้บริการใน AI Gateway ของคุณ ส่วนที่ไม่ระบุใช้บัญชี Cloudflare ของคุณได้เลย",
    zh: "选择用于回复客户的模型。标记需要密钥的模型必须在你的 AI Gateway 中配置提供商密钥；未标记的可直接使用你的 Cloudflare 账户。",
    my: "customer ကို ဖြေမည့် model ရွေးပါ။ key လိုသည်ဟု မှတ်ထားသော model များအတွက် သင့် AI Gateway တွင် provider key လိုအပ်သည်။ မမှတ်ထားသူများကို သင့် Cloudflare account ဖြင့် ရပါသည်။",
  },
  modelCurrent: { en: "current", th: "ใช้อยู่", zh: "当前", my: "လက်ရှိ" },

  // Language ----------------------------------------------------------------
  langTitle: { en: "Language", th: "ภาษา", zh: "语言", my: "ဘာသာစကား" },
  langBody: {
    en: "This changes the console only. Each business answers customers in its own language.",
    th: "การตั้งค่านี้เปลี่ยนเฉพาะคอนโซล แต่ละธุรกิจจะตอบลูกค้าด้วยภาษาของตนเอง",
    zh: "此设置仅更改控制台。每个商家仍以各自的语言回复客户。",
    my: "ဤအရာက console ကိုသာ ပြောင်းသည်။ လုပ်ငန်းတစ်ခုစီသည် သူ့ဘာသာစကားဖြင့် customer ကို ဖြေပါမည်။",
  },

  // Help --------------------------------------------------------------------
  helpTitle: { en: "Help", th: "ช่วยเหลือ", zh: "帮助", my: "အကူအညီ" },
  helpBody: {
    en: [
      "Everything runs inside your own Cloudflare account. No data leaves it.",
      "",
      "<b>Two kinds of bot</b>",
      "This bot is the console. It is private, it manages every business, and",
      "no customer can reach it. It belongs to no business.",
      "A business bot is the one customers write to. Each business has its own,",
      "created at @BotFather and connected here.",
      "",
      "<b>Getting started</b>",
      "1. Add business. Create a bot at @BotFather named after the business,",
      "   then send its token here. The bot name becomes the business name.",
      "2. Open the business, then Data, then Add data, and send a file.",
      "3. Write to the business bot as if you were a customer.",
      "",
      "<b>Data and Products</b>",
      "Data is files: PDF, Word, Excel, CSV, TXT, Markdown, JSON, JSONL.",
      "Products are entered one at a time and can be corrected or removed",
      "individually, which files cannot.",
      "",
      "<b>Instructions</b>",
      "Your own rules for the assistant. Files are facts it may quote,",
      "instructions are rules it follows. A sentence inside a file can never",
      "change how the assistant behaves.",
      "",
      "<b>Customers</b>",
      "Everyone who writes gets a record. The assistant remembers durable",
      "facts about them so they need not repeat themselves. Blocking someone",
      "stops the assistant answering them.",
      "",
      "If the assistant says it does not know, the answer is not in its data.",
      "Add it under Data or Products.",
    ].join("\n"),
    th: [
      "ทุกอย่างทำงานภายในบัญชี Cloudflare ของคุณเอง ไม่มีข้อมูลออกไปข้างนอก",
      "",
      "<b>บอทมีสองแบบ</b>",
      "บอทนี้คือคอนโซล เป็นส่วนตัว ใช้จัดการทุกธุรกิจ และลูกค้าเข้าถึงไม่ได้",
      "อีกทั้งไม่ผูกกับธุรกิจใด",
      "บอทธุรกิจคือบอทที่ลูกค้าทักเข้ามา แต่ละธุรกิจมีของตัวเอง",
      "สร้างที่ @BotFather แล้วเชื่อมต่อที่นี่",
      "",
      "<b>เริ่มต้นใช้งาน</b>",
      "1. เพิ่มธุรกิจ สร้างบอทที่ @BotFather โดยตั้งชื่อตามธุรกิจ",
      "   แล้วส่งโทเคนมาที่นี่ ชื่อบอทจะกลายเป็นชื่อธุรกิจ",
      "2. เปิดธุรกิจ ไปที่ ข้อมูล แล้ว เพิ่มข้อมูล และส่งไฟล์",
      "3. ทักไปที่บอทธุรกิจเสมือนคุณเป็นลูกค้า",
      "",
      "<b>ข้อมูลและสินค้า</b>",
      "ข้อมูลคือไฟล์: PDF, Word, Excel, CSV, TXT, Markdown, JSON, JSONL",
      "สินค้าจะเพิ่มทีละรายการ และแก้ไขหรือลบเป็นรายการได้ ซึ่งไฟล์ทำไม่ได้",
      "",
      "<b>คำสั่ง</b>",
      "คือกฎของคุณเองสำหรับผู้ช่วย ไฟล์คือข้อเท็จจริงที่อ้างอิงได้",
      "ส่วนคำสั่งคือกฎที่ต้องปฏิบัติตาม ข้อความในไฟล์ไม่สามารถ",
      "เปลี่ยนพฤติกรรมของผู้ช่วยได้",
      "",
      "<b>ลูกค้า</b>",
      "ทุกคนที่ทักมาจะมีระเบียนของตนเอง ผู้ช่วยจะจำข้อเท็จจริงที่คงอยู่",
      "เพื่อไม่ให้ลูกค้าต้องพูดซ้ำ การบล็อกจะทำให้ผู้ช่วยไม่ตอบคนนั้น",
      "",
      "หากผู้ช่วยบอกว่าไม่ทราบ แปลว่าคำตอบยังไม่อยู่ในข้อมูล",
      "กรุณาเพิ่มที่ ข้อมูล หรือ สินค้า",
    ].join("\n"),
    zh: [
      "一切都在你自己的 Cloudflare 账户中运行，数据不会外流。",
      "",
      "<b>两种机器人</b>",
      "本机器人是控制台：私有、管理所有商家、客户无法访问，",
      "也不归属于任何商家。",
      "商家机器人才是客户联系的那一个。每个商家各有一个，",
      "在 @BotFather 创建后在此连接。",
      "",
      "<b>开始使用</b>",
      "1. 添加商家。在 @BotFather 用商家名称创建机器人，",
      "   把 token 发到这里。机器人名称就是商家名称。",
      "2. 打开商家，进入「数据」，点「添加数据」，然后发送文件。",
      "3. 以客户身份给商家机器人发消息试试。",
      "",
      "<b>数据与商品</b>",
      "数据是文件：PDF、Word、Excel、CSV、TXT、Markdown、JSON、JSONL。",
      "商品是逐个录入的，可以单独修改或删除，文件则不行。",
      "",
      "<b>指令</b>",
      "你为助手设定的规则。文件是它可以引用的事实，指令是它必须遵守的",
      "规则。文件里的任何句子都无法改变助手的行为。",
      "",
      "<b>客户</b>",
      "每个来消息的人都会有记录。助手会记住关于他们的长期事实，",
      "免得他们重复说明。屏蔽某人后，助手将不再回复他。",
      "",
      "如果助手说不知道，说明答案不在它的数据里。请在「数据」或",
      "「商品」中补充。",
    ].join("\n"),
    my: [
      "အားလုံးသည် သင့်ကိုယ်ပိုင် Cloudflare account ထဲတွင်သာ အလုပ်လုပ်သည်။ ဒေတာ ပြင်ပသို့ မထွက်ပါ။",
      "",
      "<b>Bot နှစ်မျိုး ရှိသည်</b>",
      "ဤ bot သည် console ဖြစ်သည်။ သီးသန့်ဖြစ်ပြီး လုပ်ငန်းအားလုံးကို စီမံသည်၊",
      "customer မရောက်နိုင်ပါ။ လုပ်ငန်းတစ်ခုနှင့်မှ တွဲမထားပါ။",
      "လုပ်ငန်း bot ကတော့ customer တွေ စာပို့မယ့်ဟာဖြစ်သည်။ လုပ်ငန်းတစ်ခုစီမှာ",
      "ကိုယ်ပိုင်ရှိပြီး @BotFather မှာ ဆောက်ကာ ဤနေရာတွင် ချိတ်ရသည်။",
      "",
      "<b>စတင်ရန်</b>",
      "၁။ လုပ်ငန်း အသစ်ထည့် — @BotFather မှာ လုပ်ငန်းအမည်နှင့် bot ဆောက်ပြီး",
      "   token ကို ဤနေရာ ပို့ပါ။ bot ရဲ့ အမည်က လုပ်ငန်းအမည် ဖြစ်သွားပါမည်။",
      "၂။ လုပ်ငန်းကို ဖွင့်ပြီး ဒေတာ → ဒေတာ ထည့် → ဖိုင် ပို့ပါ။",
      "၃။ လုပ်ငန်း bot ကို customer တစ်ယောက်လို စာပို့ကြည့်ပါ။",
      "",
      "<b>ဒေတာနှင့် ကုန်ပစ္စည်း</b>",
      "ဒေတာ ဆိုသည်မှာ ဖိုင်များ: PDF, Word, Excel, CSV, TXT, Markdown, JSON, JSONL။",
      "ကုန်ပစ္စည်းကို တစ်ခုချင်း ထည့်ပြီး တစ်ခုချင်း ပြင်နိုင် ဖျက်နိုင်သည် —",
      "ဖိုင်များက အဲဒီလို မရပါ။",
      "",
      "<b>ညွှန်ကြားချက်</b>",
      "assistant အတွက် သင့်ကိုယ်ပိုင် စည်းမျဉ်းများ။ ဖိုင်များသည် ကိုးကားနိုင်သော",
      "အချက်အလက်ဖြစ်ပြီး ညွှန်ကြားချက်များသည် လိုက်နာရမည့် စည်းမျဉ်းဖြစ်သည်။",
      "ဖိုင်ထဲက စာကြောင်းတစ်ကြောင်းက assistant ၏ အပြုအမူကို ဘယ်တော့မှ မပြောင်းနိုင်ပါ။",
      "",
      "<b>Customer များ</b>",
      "စာပို့သူတိုင်း မှတ်တမ်း ရရှိသည်။ assistant က သူတို့အကြောင်း တည်မြဲသော",
      "အချက်များကို မှတ်ထားသဖြင့် ထပ်ပြောစရာ မလိုပါ။ ပိတ်လိုက်လျှင်",
      "assistant က အဲဒီသူကို မဖြေတော့ပါ။",
      "",
      "assistant က မသိဟု ဆိုလျှင် အဖြေသည် ဒေတာထဲတွင် မရှိသေးပါ။",
      "ဒေတာ သို့မဟုတ် ကုန်ပစ္စည်း တွင် ထည့်ပါ။",
    ].join("\n"),
  },
} satisfies Record<string, Entry>;

export type MessageKey = keyof typeof STRINGS;

/**
 * Looks up a translated string and fills in any placeholders.
 *
 * English is used when a language has no entry, so a gap shows as untranslated
 * text rather than as an identifier.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  const entry = STRINGS[key] as Entry;
  const template = entry[locale] || entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}
