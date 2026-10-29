import { useStore, uid, type Conv } from "./store";

export const DEMO_CONTACTS = [
  { id: "d1", name: "نریمان احمدی", phone: "07901112233", color: 1 },
  { id: "d2", name: "سارا کریمی", phone: "07902223344", color: 2 },
  { id: "d3", name: "الیاس صمد", phone: "07903334455", color: 4 },
  { id: "d4", name: "تیم پشتیبانی دل", phone: "07900000000", color: 5 },
];

const SEED: Record<string, [boolean, string, number][]> = {
  // [mine, text, minutesAgo]
  d1: [
    [false, "سلام! خوبی؟ 😊", 1450],
    [true, "سلام نریمان جان، ممنون. تو چطوری؟", 1440],
    [false, "خدا را شکر. فردا ساعت ۸ جلسه داریم، یادت نره.", 1435],
    [true, "چشم، حتماً. یادداشت می‌کنم ✍️", 1430],
  ],
  d2: [
    [false, "سلام سارا", 380],
    [false, "فایل گزارش را برایت فرستادم، دیدی؟", 375],
    [true, "سلام! آره دیدم، عالی شده 👌", 360],
    [false, "خوشحالم که پسندیدی. باز هم کاری بود در خدمتم.", 355],
  ],
  d3: [[false, "سلام برادر! آخر هفته می‌بینیمت 😎", 95]],
  d4: [
    [false, "به دل خوش آمدید! 🎉", 60],
    [false, "این نسخه آزمایشی (Alpha) است. برای اتصال به سرور واقعی، آدرس آن را در تنظیمات وارد کنید.", 60],
  ],
};

const BOT_REPLIES = [
  "باشه، چشم 👍",
  "آهان، فهمیدم!",
  "ممنون که خبر دادی 🙏",
  "الان کمی سرم شلوغ است، بعداً دقیق می‌خوانم.",
  "خیلی خوب شد که گفتی!",
  "قرار است فردا صحبت کنیم؟",
  "حله، من هم آماده‌ام 😊",
  "باشد، منتظرت هستم.",
];

export function seedDemo() {
  const st = useStore.getState();
  const me = st.user;
  if (!me) return;

  const now = Date.now();
  const convs: Conv[] = DEMO_CONTACTS.map((c, i) => ({
    id: uid() + i,
    peer: { id: c.id, name: c.name, phone: c.phone, color: c.color },
    unread: 0,
    typing: false,
    messages: (SEED[c.id] ?? []).map(([mine, text, minsAgo]) => ({
      id: uid(),
      mine,
      text,
      at: now - minsAgo * 60_000,
      status: mine ? ("read" as const) : ("read" as const),
    })),
  }));
  // one unread for realism
  convs[0].unread = 1;
  convs[0].messages[convs[0].messages.length - 1].at = now - 3 * 60_000;

  useStore.setState({
    contacts: DEMO_CONTACTS,
    convs,
    screen: "chats",
  });
}

let botTimer: ReturnType<typeof setTimeout> | null = null;

/** Demo bot: reacts after user sends a message in demo mode */
export function demoBotReply(convId: string) {
  const st = useStore.getState();
  // typing indicator shortly after send
  setTimeout(() => {
    useStore.setState((s) => ({
      convs: s.convs.map((c) => (c.id === convId ? { ...c, typing: true } : c)),
    }));
    if (botTimer) clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      const reply = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
      useStore.getState().receiveMsg(convId, reply);
      // mark my messages as read once they reply
      useStore.getState().markRead(convId);
    }, 1400 + Math.random() * 1600);
  }, 700);
}
