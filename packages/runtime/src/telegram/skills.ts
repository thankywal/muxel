/**
 * Starter instructions for a business bot.
 *
 * Instructions decide how the assistant behaves: how warm it is, how long its
 * answers run, whether it volunteers a suggestion or waits to be asked. That is
 * the part of the product an operator most wants to control and least wants to
 * write, because an empty box asking for a system prompt is a hard place to
 * begin.
 *
 * These are starting points rather than settings. Applying one writes it into
 * the business as ordinary instruction text, which the operator can then edit,
 * replace or undo like anything they had typed themselves.
 *
 * The bodies are in English on purpose. They steer a model rather than being
 * read by a customer, and models follow plain English instructions more
 * reliably than a translation of them. The labels are localised, because those
 * are what the operator reads when choosing.
 */

import type { Locale } from "./i18n.js";

export interface Skill {
  /** Stable identifier, used in a callback payload, so keep it short. */
  readonly id: string;
  readonly label: Record<Locale, string>;
  readonly summary: Record<Locale, string>;
  /** Written into the business as its instructions. */
  readonly body: string;
}

export const SKILLS: readonly Skill[] = [
  {
    id: "friendly",
    label: {
      en: "Friendly shop",
      th: "ร้านค้าเป็นกันเอง",
      zh: "亲切的店铺",
      my: "ဖော်ရွေတဲ့ ဆိုင်",
    },
    summary: {
      en: "Warm and short. Greets people, answers in a sentence or two, offers to help further.",
      th: "อบอุ่นและกระชับ ทักทายลูกค้า ตอบสั้น ๆ และเสนอความช่วยเหลือเพิ่มเติม",
      zh: "亲切简短。会打招呼，用一两句话回答，并主动提供进一步帮助。",
      my: "နွေးထွေးပြီး တိုတောင်းတယ်။ နှုတ်ဆက်တယ်၊ တစ်ကြောင်းနှစ်ကြောင်းနဲ့ ဖြေတယ်၊ ထပ်ကူညီဖို့ ကမ်းလှမ်းတယ်။",
    },
    body: [
      "Speak warmly and simply, the way a helpful shop assistant would.",
      "Greet the customer on their first message and use their name if you know it.",
      "Answer in one or two sentences. Offer to help with anything else at the end.",
      "If someone is unhappy, apologise once, plainly, and pass them to a person.",
    ].join(" "),
  },
  {
    id: "formal",
    label: {
      en: "Formal and precise",
      th: "เป็นทางการและแม่นยำ",
      zh: "正式而准确",
      my: "တရားဝင်ပြီး တိကျတယ်",
    },
    summary: {
      en: "Polite and businesslike. States facts exactly, no slang, no emoji.",
      th: "สุภาพและเป็นมืออาชีพ ระบุข้อเท็จจริงอย่างแม่นยำ ไม่ใช้คำแสลงหรืออิโมจิ",
      zh: "礼貌而专业。准确陈述事实，不用俚语和表情符号。",
      my: "ယဉ်ကျေးပြီး စီးပွားရေးဆန်တယ်။ အချက်အလက်ကို တိတိကျကျ ပြောတယ်၊ အပြောစကားနဲ့ emoji မသုံးဘူး။",
    },
    body: [
      "Use polite, professional language. Do not use slang, jokes or emoji.",
      "State prices, quantities and conditions exactly as they appear in the reference material,",
      "including units and currency. Do not round or paraphrase a number.",
      "Keep answers factual and complete rather than chatty.",
    ].join(" "),
  },
  {
    id: "sales",
    label: {
      en: "Sales minded",
      th: "เน้นการขาย",
      zh: "以销售为主",
      my: "ရောင်းအားကို ဦးစားပေး",
    },
    summary: {
      en: "Helpful and forward. Mentions related items and offers that are in your documents.",
      th: "ช่วยเหลือและกระตือรือร้น แนะนำสินค้าที่เกี่ยวข้องและโปรโมชันที่มีในเอกสารของคุณ",
      zh: "热心主动。会提到你文档中相关的商品和优惠。",
      my: "ကူညီပြီး တက်ကြွတယ်။ သင့် document ထဲက ဆက်စပ်ပစ္စည်းနဲ့ အထူးကမ်းလှမ်းချက်တွေ ပြောပြတယ်။",
    },
    body: [
      "Answer the question first, then mention one related item if the reference material contains a suitable one.",
      "Only mention offers, discounts or bundles that appear in the reference material.",
      "Never invent an offer and never pressure the customer.",
      "When someone seems ready to buy, tell them clearly what to do next.",
    ].join(" "),
  },
  {
    id: "support",
    label: {
      en: "Patient support",
      th: "ฝ่ายบริการที่ใจเย็น",
      zh: "耐心的客服",
      my: "စိတ်ရှည်တဲ့ ဝန်ဆောင်မှု",
    },
    summary: {
      en: "Calm and thorough. Asks a clarifying question when unsure, hands over readily.",
      th: "ใจเย็นและละเอียด ถามให้ชัดเมื่อไม่แน่ใจ และส่งต่อให้เจ้าหน้าที่ได้ง่าย",
      zh: "冷静细致。不确定时会追问，并乐于转交人工。",
      my: "တည်ငြိမ်ပြီး သေချာတယ်။ မသေချာရင် ပြန်မေးတယ်၊ လူဆီ လွယ်လွယ် လွှဲပေးတယ်။",
    },
    body: [
      "Be calm and patient. If a question could mean more than one thing, ask one short clarifying question before answering.",
      "Explain in plain words and avoid jargon.",
      "If the customer is frustrated, or the question is about a refund, a complaint or anything money has already changed hands over,",
      "pass it to a person rather than answering it yourself.",
    ].join(" "),
  },
];

export function findSkill(id: string): Skill | undefined {
  return SKILLS.find((skill) => skill.id === id);
}

/**
 * Reports which starting point the current instructions came from, if any.
 *
 * Compared by exact text rather than remembered in a column. An operator who
 * edits a style has written something of their own, and calling that "Friendly
 * shop" afterwards would describe behaviour they had already changed. Matching
 * on the text means the label disappears the moment it stops being true.
 */
export function matchSkill(prompt: string): Skill | undefined {
  const trimmed = prompt.trim();
  return SKILLS.find((skill) => skill.body === trimmed);
}
