import type {
  ExternalTrendItem,
  ExtractedHashtag,
  ExtractedTopic,
  FacebookTrendsAnalysis,
  Post,
  TrendEvidence,
} from "./model.ts";

// Comprehensive Arabic + Egyptian dialect + newsroom boilerplate stopword list
const STOPWORDS = new Set(
  [
    // Standard Arabic function words
    "في", "من", "على", "علي", "عن", "الي", "إلى", "الى", "ان", "أن", "إن",
    "وان", "وأن", "وإن", "انها", "انه", "انهم", "بأن", "بان", "لأن", "لان",
    "هذا", "هذه", "هؤلاء", "ذلك", "تلك", "التي", "الذي", "الذين", "اللاتي",
    "مع", "بعد", "قبل", "خلال", "بين", "عند", "منذ", "حتى", "حتي", "نحو",
    "كل", "بعض", "اي", "أي", "او", "أو", "ام", "أم", "ثم", "بل", "لكن", "ولكن",
    "هو", "هي", "هم", "هن", "نحن", "انا", "أنا", "انت", "أنت", "انتم",
    "لا", "لم", "لن", "ما", "ماذا", "كيف", "لماذا", "اين", "أين", "متى", "متي",
    "كما", "حيث", "اذا", "إذا", "لو", "كي", "لكي", "قد", "لقد", "سوف", "غير",
    "فقط", "ايضا", "أيضا", "جدا", "جدًا", "الان", "الآن", "اليوم", "امس", "غدا",
    "هنا", "هناك", "عبر", "ضد", "دون", "بدون", "حول", "فوق", "تحت", "امام", "أمام",
    "كان", "كانت", "كانوا", "يكون", "تكون", "ليس", "ليست", "اصبح", "أصبح",
    "تم", "تتم", "يتم", "بها", "بهم", "فيها", "فيه", "فيهم", "منها", "منه", "منهم",
    "عليها", "عليه", "عليهم", "عنها", "عنه", "اليها", "اليه", "لها", "له", "لهم",
    "معها", "معه", "التي", "الذي", "بشكل", "ضمن", "لدى", "لدي", "بداية", "نهاية",
    "بحلول", "أثناء", "اثناء", "أكثر", "اكثر", "أقل", "اقل", "نفس", "نفسه", "نفسها",
    "أول", "اول", "ثاني", "اخر", "آخر", "أخرى", "اخري", "جديد", "جديدة", "الجدد",
    "عام", "سنة", "سنه", "شهر", "اسبوع", "ساعة", "وقت", "مرة", "مرات", "عدد",
    // Newsroom reporting verbs & filler
    "قال", "وقال", "قالت", "اضاف", "أضاف", "واضاف", "أكد", "اكد", "واكد",
    "اوضح", "أوضح", "كشف", "كشفت", "تكشف", "يكشف", "اعلن", "أعلن", "اعلنت", "أعلنت",
    "اشار", "أشار", "مؤكدة", "مؤكدا", "تدين", "أدان", "ادان", "يسعى", "تسعى", "تسعي",
    "يجب", "ينبغي", "يتوقف", "وقوفها", "بأشد", "باشد", "العبارات", "بيان", "تواجه", "يواجه",
    "تؤثر", "يوثر", "مرتبط", "مرتبطة", "الامر", "الأمر", "والامر", "والأمر",
    "مصادر", "تابع", "تابعونا", "التفاصيل", "للتفاصيل", "المزيد", "عاجل",
    "بالصور", "بالفيديو", "فيديو", "صور", "صورة", "اخبار", "أخبار", "خبر",
    "شاهد", "موقع", "رابط", "مباشر", "بث", "لايف", "مشاهد", "مؤثرة", "مؤثر",
    "اليوم", "السابع", "رصد", "شبكة", "مزيد", "إشارة", "اشارة", "دعونا", "نرحب",
    // Egyptian colloquial & emotional filler
    "اللي", "اللى", "ده", "دي", "دى", "دول", "دا", "عشان", "علشان", "ياجماعة",
    "ياجماعه", "جماعة", "جماعه", "النهاردة", "النهارده", "انهارده", "إنهارده",
    "كده", "يعني", "يعنى", "بقى", "بقي", "بس", "حاجة", "حاجه", "واحد", "واحدة",
    "واحده", "راجل", "الراجل", "ست", "مش", "مفيش", "معانا", "معايا", "الولد",
    "للأسف", "للاسف", "الشديد", "حول", "قوة", "قوه", "بالله", "الله", "العظيم",
    "الرحيم", "الكريم", "العرش", "حسبنا", "الوكيل", "دعواتكم", "يشفيه", "يارب",
    "تنسى", "تنسي", "الصلاة", "النبي", "اهلا", "أهلا", "سهلا", "صباح", "مساء",
    "بنت", "ابوها", "أبوها", "اهربي", "شوفتيها", "وانا", "وأنا", "لقيت", "طلعت",
    "طلع", "عنده", "عندها", "اخده", "أخده", "بسبب", "الامر", "الأمر", "مقومات",
    "الثقة", "العالم", "الكبرى", "الكبري", "الدول", "حياتنا",
    // Generic single-word Latin filler
    "the", "and", "for", "with", "from", "this", "that", "http", "https", "www",
    "com", "facebook", "watch", "reel", "posts", "share", "live",
  ].map(foldKey),
);

const PUBLISHER_AND_JUNK_HASHTAGS = new Set(
  [
    "عاجل", "فيديو", "صور", "صورة", "بالصور", "بالفيديو", "اخبار", "خبر",
    "ترند", "لايف", "بث", "بث_مباشر", "شاهد", "تابع", "مزيد", "رصد",
    "شبكة_رصد", "اليوم_السابع", "المزيد", "التفاصيل", "حصري",
  ].map(foldKey),
);

const STEM_ALIASES: Record<string, string> = {
  اسعار: "سعر",
  وزير: "وزار",
  وزيره: "وزار",
  وزاره: "وزار",
  مصري: "مصر",
  مصريه: "مصر",
  قاهره: "مصر",
  تركي: "تركيا",
  تركيه: "تركيا",
  محافظات: "محافظه",
  مباريات: "مباراه",
  اهداف: "هدف",
  شائعات: "شائعه",
  معلومات: "معلومه",
  طلاب: "طالب",
  اجهزه: "جهاز",
  دبلوماسي: "دبلوماس",
  دبلوماسيه: "دبلوماس",
  اقليمي: "اقليم",
  اقليميه: "اقليم",
  بنوك: "بنك",
  مصارف: "بنك",
  مستشفيات: "مستشفي",
  جامعات: "جامعه",
  امريكي: "امريكا",
  امريكيه: "امريكا",
  سعودي: "سعوديه",
};

// Egypt-focused institutional, geographic, economic, social & regional relevance cues
const EGYPT_LEXICON = new Set(
  [
    "مصر", "المصري", "المصرية", "القاهرة", "الجيزة", "الإسكندرية", "الدقهلية",
    "محافظة الدقهلية", "محافظة الدقهليه", "الإخوان واستقطاب الشباب",
    "التربية العسكرية", "المدينة المنورة", "مستشفى منية النصر",
    "الشرقية", "المنوفية", "القليوبية", "الغربية", "البحيرة", "أسيوط", "سوهاج",
    "المنيا", "الأقصر", "أسوان", "سيناء", "العريش", "رفح", "السويس", "بورسعيد",
    "الإسماعيلية", "مطروح", "الفيوم", "بني سويف", "دمياط", "كفر الشيخ", "قنا",
    "العاصمة الإدارية", "منية النصر", "بني عبيد", "ميت سويد",
    "مجلس النواب", "البرلمان", "مجلس الوزراء", "الحكومة", "رئيس الوزراء",
    "وزارة الصحة", "الصحة", "وزارة الخارجية", "الخارجية", "وزارة التضامن",
    "التضامن الاجتماعي", "وزارة التربية", "التربية العسكرية", "التربية والتعليم",
    "وزارة الداخلية", "وزارة المالية", "وزارة التموين", "وزارة الكهرباء",
    "وزارة البترول", "وزارة النقل", "البنك المركزي", "الأزهر", "قناة السويس",
    "الجنيه", "الدولار", "الذهب", "البنزين", "السولار", "الكهرباء", "التموين",
    "المعاشات", "التأمينات", "الثانوية العامة", "الجامعات", "المترو", "القطار",
    "الأهلي", "الزمالك", "منتخب مصر", "الدوري المصري", "بيراميدز", "محمد صلاح",
    "محمد بركات", "مهرجان القاهرة", "معرض الكتاب", "برنامج مودة", "توطين",
    "التصوير الطبي", "الإخوان", "الشائعات", "المعلومات المضللة", "سد النهضة",
    "النيل", "البحر الأحمر", "غزة", "فلسطين", "المدينة المنورة", "السعودية",
    "التقارب التركي", "التقارب التركي المصري", "السودان", "ليبيا",
  ].map(foldKey),
);

// High-value journalistic headwords that signal real news topics (not personal chatter)
const NEWS_CUE_HEADWORDS = new Set(
  [
    "وزارة", "وزيرة", "وزير", "مجلس", "النواب", "البرلمان", "الحكومة", "التربية",
    "العسكرية", "الصحة", "الخارجية", "التضامن", "الاجتماعي", "الداخلية", "التعليم",
    "التقارب", "التركي", "المصري", "دبلوماسية", "استهداف", "المدينة", "المنورة",
    "صاروخ", "باليستي", "توطين", "التصوير", "الطبي", "برنامج", "مودة", "الإخوان",
    "استقطاب", "الشائعات", "المضللة", "الترشح", "رئاسة", "أمريكا", "الحزب",
    "الديمقراطي", "زفاف", "بركات", "العناية", "المركزة", "مستشفى", "الدقهلية",
    "الاهلي", "الزمالك", "منتخب", "الدولار", "الذهب", "البنزين", "الكهرباء",
    "التموين", "المعاشات", "الثانوية", "قناة", "السويس", "غزة", "فلسطين",
    "السعودية", "تركيا", "السودان", "إثيوبيا", "البحر", "الأحمر", "مهرجان",
    "الانتخابات", "القانون", "المحكمة", "النيابة", "العمرة", "المطار", "وفاة",
    "حادث", "حريق", "أسعار", "سعر", "أزمة", "قرار", "خطة", "مشروع", "اتفاق",
  ].map(foldKey),
);

const GENERIC_EXTERNAL_TOKENS = new Set(
  ["مصر", "محمد", "اليوم", "الجمعة", "الخميس", "الله", "ترند", "عاجل", "egypt"].map(
    foldKey,
  ),
);

// Words that should never be left dangling at the start or end of an Arabic topic phrase
const DANGLING_START = new Set(
  [
    "عضو", "مستشار", "مديره", "مدير", "المصري", "المصريه", "التركي", "التركيه",
    "لتركي", "توفي", "دعاء", "حسن", "الخاتمه", "السيطره", "توجه", "خطه", "عبيد",
  ].map(foldKey),
);

const DANGLING_END = new Set(
  [
    "وزيره", "وزير", "وزاره", "برنامج", "خطه", "عضو", "مستشار", "مديره", "مدير",
    "رئيس", "محافظه", "مركز", "مستشفي", "جهاز", "اجهزه", "توطين", "تدريس",
    "استهداف", "زفاف", "ابنه", "فتحي", "محمد", "عبدول", "راندا", "ملفات",
    "استقطاب", "واستقطاب",
  ].map(foldKey),
);

export function foldKey(input: string): string {
  return (input || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stemArabic(foldedWord: string): string {
  let w = foldedWord;
  if (w.length > 5 && /^(وال|بال|كال|فال)/u.test(w)) {
    w = w.slice(3);
  } else if (w.length > 4 && (w.startsWith("ال") || w.startsWith("لل"))) {
    w = w.slice(2);
  } else if (w.length > 4 && /^[وبفل]/u.test(w)) {
    const candidate = w.slice(1);
    if (STEM_ALIASES[candidate] || EGYPT_LEXICON.has(candidate)) {
      w = candidate;
    }
  }
  return STEM_ALIASES[w] || w;
}

/**
 * Detects non-news boilerplate/spam posts that produce junk topics:
 * - Facebook auto-welcome member lists ("دعونا نرحب بأعضائنا الجدد!")
 * - Promotional giveaways / raffles / WhatsApp group ads
 */
export function isNoisePost(text: string): boolean {
  const clean = (text || "").trim();
  if (!clean || clean.length < 18) return true;

  const folded = foldKey(clean);

  // Facebook auto-generated member welcome lists
  if (
    folded.includes("نرحب باعضائنا الجدد") ||
    folded.includes("دعونا نرحب بالاعضاء") ||
    folded.includes("اعضائنا الجدد")
  ) {
    return true;
  }

  // Huge comma-separated list of personal names
  const commas = (clean.match(/[,،]/g) || []).length;
  if (commas >= 15 && clean.length > 600) {
    return true;
  }

  // Commercial giveaways, raffles, and tiny WhatsApp/shop ads
  if (
    /مين هيكسب|مسابقه.*جائز|جائزتين نقديتين|باكد[جچ]|للحجز والاستعلام/u.test(
      folded,
    )
  ) {
    return true;
  }

  const withoutUrls = clean.replace(/https?:\/\/\S+/gu, "").trim();
  const wordCount = withoutUrls.split(/\s+/u).filter(Boolean).length;
  if (clean.includes("chat.whatsapp.com") && wordCount < 15) {
    return true;
  }
  if (wordCount < 5) return true;

  return false;
}

function stripUrlsAndHandles(text: string): string {
  return (text || "")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/@[\p{L}\p{N}_]+/gu, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/["'«»“”()[\]{}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function makeHeadline(text: string): string {
  const cleaned = stripUrlsAndHandles(text);
  const words = cleaned.split(/\s+/u).filter(Boolean);
  return words.slice(0, 14).join(" ").slice(0, 140);
}

type TokenPair = { raw: string; folded: string; stem: string; stop: boolean };

function tokenizeClause(clause: string): TokenPair[] {
  const matches = clause.match(/[\p{L}\p{N}]+/gu) || [];
  const out: TokenPair[] = [];
  for (const raw of matches) {
    // Skip pure short numbers unless meaningful year (e.g. 2030)
    if (/^\d+$/u.test(raw) && !/^20[2-4]\d$/u.test(raw)) continue;
    const folded = foldKey(raw);
    if (folded.length < 2) continue;
    const stem = stemArabic(folded);
    const bareWa =
      folded.length > 3 && folded.startsWith("و") ? folded.slice(1) : folded;
    const stop =
      STOPWORDS.has(folded) ||
      STOPWORDS.has(stem) ||
      STOPWORDS.has(bareWa) ||
      STOPWORDS.has(stemArabic(bareWa));
    out.push({ raw, folded, stem, stop });
  }
  return out;
}

function splitClauses(text: string): string[] {
  return stripUrlsAndHandles(text)
    .split(/[.!؟،:؛\n—–-]+|\.{2,}/u)
    .map((c) => c.trim())
    .filter((c) => c.length >= 4);
}

function hasEgyptRelevance(foldedText: string, stems: Set<string>): boolean {
  for (const cue of EGYPT_LEXICON) {
    if (cue.includes(" ")) {
      if (` ${foldedText} `.includes(` ${cue} `)) return true;
    } else if (stems.has(stemArabic(cue)) || ` ${foldedText} `.includes(` ${cue} `)) {
      return true;
    }
  }
  return false;
}

function signalMatchesPost(foldedText: string, signal: ExternalTrendItem): boolean {
  const label = foldKey(signal.name.replace(/^#/, ""));
  if (!label) return false;
  const tokens = label.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  if (!tokens.length) return false;
  if (
    tokens.length === 1 &&
    (tokens[0].length < 4 || GENERIC_EXTERNAL_TOKENS.has(tokens[0]))
  ) {
    return false;
  }
  return ` ${foldedText} `.includes(` ${label} `);
}

function formatSuggestedHashtag(title: string): string {
  const cleaned = title
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 4)
    .join("_");
  return cleaned ? `#${cleaned}` : "";
}

function engagementScore(post: Post): number {
  const e = post.engagement;
  if (!e) return 0;
  return (e.reactions ?? 0) + (e.comments ?? 0) * 2 + (e.shares ?? 0) * 3;
}

type PhraseCandidate = {
  key: string; // stemmed key for dedupe/clustering
  display: string; // clean original Arabic surface form
  informativeCount: number;
  clauseIndex: number;
  hasEgyptCue: boolean;
  hasNewsCue: boolean;
  stems: string[];
};

function extractPostPhrases(text: string): {
  stems: Map<string, number>;
  phrases: PhraseCandidate[];
  folded: string;
} {
  const clauses = splitClauses(text);
  const stems = new Map<string, number>();
  const seenKeys = new Map<string, PhraseCandidate>();
  const foldedAll = foldKey(stripUrlsAndHandles(text));

  for (let ci = 0; ci < clauses.length; ci += 1) {
    const tokens = tokenizeClause(clauses[ci]);
    for (const tok of tokens) {
      if (!tok.stop) {
        stems.set(tok.stem, (stems.get(tok.stem) || 0) + 1);
      }
    }

    for (const size of [2, 3, 4]) {
      for (let i = 0; i <= tokens.length - size; i += 1) {
        const slice = tokens.slice(i, i + size);
        const first = slice[0];
        const last = slice[slice.length - 1];
        // Clean Arabic phrase boundaries: no stopwords or dangling words at edges
        if (first.stop || last.stop) continue;
        if (DANGLING_START.has(first.folded) || DANGLING_END.has(last.folded)) {
          continue;
        }
        // Avoid starting a phrase with conjunction "و..." unless it's a real word like وزارة/وزير/وفاة
        if (
          first.folded.startsWith("و") &&
          !["وزاره", "وزير", "وزيره", "وفاه", "وطن", "وطني"].includes(first.folded) &&
          first.folded.length > 4 &&
          (STOPWORDS.has(first.folded.slice(1)) ||
            first.folded.startsWith("وال") ||
            first.folded.startsWith("ومدير") ||
            first.folded.startsWith("واستقطاب"))
        ) {
          continue;
        }
        // Max 1 internal connector stopword (allows e.g. "أجهزة التصوير الطبي")
        const stopCount = slice.filter((t) => t.stop).length;
        if (size === 2 && stopCount > 0) continue;
        if (size >= 3 && stopCount > 1) continue;

        const informative = slice.filter((t) => !t.stop);
        if (informative.length < 2) continue;

        const key = informative.map((t) => t.stem).join(" ");
        const display = slice.map((t) => t.raw).join(" ");
        const foldedPhrase = foldKey(display);

        const hasEgyptCue =
          EGYPT_LEXICON.has(foldedPhrase) ||
          slice.some(
            (t) => EGYPT_LEXICON.has(t.folded) || EGYPT_LEXICON.has(t.stem),
          );
        const hasNewsCue = slice.some(
          (t) =>
            NEWS_CUE_HEADWORDS.has(t.folded) || NEWS_CUE_HEADWORDS.has(t.stem),
        );

        if (!seenKeys.has(key)) {
          seenKeys.set(key, {
            key,
            display,
            informativeCount: informative.length,
            clauseIndex: ci,
            hasEgyptCue,
            hasNewsCue,
            stems: informative.map((t) => t.stem),
          });
        }
      }
    }
  }

  return { stems, phrases: [...seenKeys.values()], folded: foldedAll };
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function analyzeFacebookTrends(
  posts: Post[],
  externalSignals: ExternalTrendItem[] = [],
  options: {
    country?: "EG";
    maxTopics?: number;
    maxHashtags?: number;
    referenceAt?: string | null;
    referenceLabel?: string | null;
  } = {},
): FacebookTrendsAnalysis {
  const maxTopics = options.maxTopics ?? 15;
  const maxHashtags = options.maxHashtags ?? 15;

  // Deduplicate posts by id & keep only Facebook posts
  const uniqueMap = new Map<string, Post>();
  for (const p of posts) {
    if (p.platform === "facebook") uniqueMap.set(p.id, p);
  }
  const allFbPosts = [...uniqueMap.values()];

  // Collect normalized publisher names so self-tags like #مزيد or #اليوم_السابع are excluded
  const publisherKeys = new Set<string>();
  const allSourceIds = new Set<string>();
  for (const p of allFbPosts) {
    for (const s of p.sources) {
      allSourceIds.add(s.id);
      const compact = foldKey(s.name).replace(/\s+/g, "");
      if (compact) publisherKeys.add(compact);
      for (const part of foldKey(s.name).split(" ")) {
        if (part.length >= 3) publisherKeys.add(part);
      }
    }
  }

  // Layer 1: Filter out empty & non-news spam/boilerplate posts
  const validPosts: Post[] = [];
  let noiseFilteredCount = 0;
  for (const p of allFbPosts) {
    if (isNoisePost(p.text)) {
      noiseFilteredCount += 1;
    } else {
      validPosts.push(p);
    }
  }

  // Layer 2: Explicit real hashtags extraction (excluding publisher self-tags & filler)
  const hashtagMap = new Map<
    string,
    { display: string; postIds: Set<string>; sourceIds: Set<string>; evidence: TrendEvidence[]; eng: number }
  >();

  for (const p of validPosts) {
    const rawTags = p.text.match(/(?<!\p{L})#[\p{L}\p{N}\u064b-\u065f_]{2,60}/gu) || [];
    const seenInPost = new Set<string>();
    const primarySource = p.sources[0] || { id: "unknown", name: "مصدر" };
    const ev: TrendEvidence = {
      postId: p.id,
      sourceId: primarySource.id,
      sourceName: p.sources.map((s) => s.name).join(" · "),
      headline: makeHeadline(p.text),
      url: p.originalUrl,
      seenAt: p.seenAt,
    };

    for (const rawTag of rawTags) {
      const bare = foldKey(rawTag.slice(1));
      const compact = bare.replace(/\s+/g, "");
      if (!bare || bare.length < 2 || /^\d+$/.test(compact)) continue;
      if (PUBLISHER_AND_JUNK_HASHTAGS.has(bare) || PUBLISHER_AND_JUNK_HASHTAGS.has(compact)) {
        continue;
      }
      if (publisherKeys.has(compact) || publisherKeys.has(bare)) continue;
      if (seenInPost.has(bare)) continue;
      seenInPost.add(bare);

      const entry = hashtagMap.get(bare) || {
        display: rawTag,
        postIds: new Set<string>(),
        sourceIds: new Set<string>(),
        evidence: [],
        eng: 0,
      };
      entry.postIds.add(p.id);
      for (const s of p.sources) entry.sourceIds.add(s.id);
      if (entry.evidence.length < 4) entry.evidence.push(ev);
      entry.eng += engagementScore(p);
      hashtagMap.set(bare, entry);
    }
  }

  const hashtags: ExtractedHashtag[] = [...hashtagMap.values()]
    .sort(
      (a, b) =>
        b.sourceIds.size - a.sourceIds.size ||
        b.postIds.size - a.postIds.size ||
        b.eng - a.eng ||
        a.display.localeCompare(b.display, "ar"),
    )
    .slice(0, maxHashtags)
    .map((h) => ({
      tag: h.display,
      postCount: h.postIds.size,
      sourceCount: h.sourceIds.size,
      evidence: h.evidence,
    }));

  // Layer 3: TF-IDF + Phrase Extraction + Cross-Platform Anchoring + Topic Clustering
  const parsedPosts = validPosts.map((post) => {
    const extracted = extractPostPhrases(post.text);
    const stemSet = new Set(extracted.stems.keys());
    const egyptRelated = hasEgyptRelevance(extracted.folded, stemSet);
    const matchedSignals = externalSignals.filter((sig) =>
      signalMatchesPost(extracted.folded, sig),
    );
    return {
      post,
      ...extracted,
      stemSet,
      egyptRelated,
      matchedSignals,
    };
  });

  // Document frequency for TF-IDF across the org's posts
  const docFreq = new Map<string, number>();
  for (const item of parsedPosts) {
    for (const s of item.stemSet) {
      docFreq.set(s, (docFreq.get(s) || 0) + 1);
    }
  }
  const N = Math.max(parsedPosts.length, 1);

  const vectors = parsedPosts.map((item) => {
    const vec = new Map<string, number>();
    let normSq = 0;
    for (const [stem, count] of item.stems.entries()) {
      const df = docFreq.get(stem) || 1;
      const tfidf = (1 + Math.log(count)) * (1 + Math.log((N + 1) / (df + 1)));
      vec.set(stem, tfidf);
      normSq += tfidf * tfidf;
    }
    const len = Math.sqrt(normSq) || 1;
    for (const [k, v] of vec.entries()) vec.set(k, v / len);
    return vec;
  });

  const phraseSets = parsedPosts.map(
    (item) => new Set(item.phrases.map((ph) => ph.key)),
  );

  // Pairwise similarity for clustering related posts
  const pairScores = new Map<string, number>();
  for (let a = 0; a < parsedPosts.length; a += 1) {
    for (let b = a + 1; b < parsedPosts.length; b += 1) {
      let commonStems = 0;
      let cosine = 0;
      for (const [stem, va] of vectors[a].entries()) {
        const vb = vectors[b].get(stem);
        if (vb !== undefined) {
          commonStems += 1;
          cosine += va * vb;
        }
      }
      let sharedPhrase = false;
      for (const pk of phraseSets[a]) {
        if (phraseSets[b].has(pk)) {
          sharedPhrase = true;
          break;
        }
      }
      const sharedSignal = parsedPosts[a].matchedSignals.some((sa) =>
        parsedPosts[b].matchedSignals.some(
          (sb) => foldKey(sa.name) === foldKey(sb.name),
        ),
      );
      const related =
        sharedSignal ||
        sharedPhrase ||
        (commonStems >= 3 && cosine >= 0.26) ||
        (commonStems >= 2 && cosine >= 0.34);

      if (related) {
        const boost = (sharedSignal ? 0.5 : 0) + (sharedPhrase ? 0.25 : 0);
        pairScores.set(`${a}:${b}`, cosine + boost);
      }
    }
  }

  // Greedy clique clustering (consistent with topic_links.py, deterministic)
  const clusters: number[][] = [];
  const used = new Set<number>();
  const sortedPairs = [...pairScores.entries()].sort((a, b) => b[1] - a[1]);

  for (const [pairKey] of sortedPairs) {
    const [a, b] = pairKey.split(":").map(Number);
    if (used.has(a) || used.has(b)) continue;
    const group = [a, b];
    for (let cand = 0; cand < parsedPosts.length; cand += 1) {
      if (used.has(cand) || group.includes(cand)) continue;
      const connectedToAll = group.every((m) => {
        const lo = Math.min(cand, m);
        const hi = Math.max(cand, m);
        return pairScores.has(`${lo}:${hi}`);
      });
      if (connectedToAll) group.push(cand);
    }
    for (const idx of group) used.add(idx);
    clusters.push(group);
  }

  // Single-post important news items (strictly filtered so casual chatter is dropped!)
  for (let i = 0; i < parsedPosts.length; i += 1) {
    if (used.has(i)) continue;
    const item = parsedPosts[i];
    const hasStrongPhrase = item.phrases.some(
      (ph) => ph.hasEgyptCue || ph.hasNewsCue,
    );
    const eng = engagementScore(item.post);
    const isGenuineNewsTopic =
      item.matchedSignals.length > 0 ||
      (item.egyptRelated && item.phrases.length > 0) ||
      hasStrongPhrase ||
      (eng >= 15 && item.phrases.length > 0);

    if (isGenuineNewsTopic) {
      clusters.push([i]);
    }
  }

  // Score phrases inside each cluster to pick the sharpest journalistic Arabic title
  const rawTopics: (Omit<ExtractedTopic, "rank"> & { stems: string[] })[] = [];

  for (const group of clusters) {
    const members = group.map((idx) => parsedPosts[idx]);
    const sourceIds = new Set<string>();
    let totalEng = 0;
    const matchedMap = new Map<
      string,
      { name: string; platform: "X" | "Google"; url: string; count: number }
    >();

    for (const m of members) {
      for (const s of m.post.sources) sourceIds.add(s.id);
      totalEng += engagementScore(m.post);
      for (const sig of m.matchedSignals) {
        const k = `${sig.platform}:${foldKey(sig.name)}`;
        const prev = matchedMap.get(k);
        if (prev) prev.count += 1;
        else
          matchedMap.set(k, {
            name: sig.name,
            platform: sig.platform,
            url: sig.url,
            count: 1,
          });
      }
    }

    const matchedTrends = [...matchedMap.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ name, platform, url }) => ({ name, platform, url }));

    // Aggregate phrase candidates across cluster members
    const phraseScores = new Map<
      string,
      { candidate: PhraseCandidate; count: number; score: number }
    >();
    for (const m of members) {
      for (const ph of m.phrases) {
        const idfMean =
          ph.stems.reduce((acc, st) => {
            const df = docFreq.get(st) || 1;
            return acc + (1 + Math.log((N + 1) / (df + 1)));
          }, 0) / ph.stems.length;
        const exactEgyptMatch = EGYPT_LEXICON.has(foldKey(ph.display));
        const baseScore =
          idfMean * 2.2 +
          (exactEgyptMatch ? 4.5 : ph.hasEgyptCue ? 2.6 : 0) +
          (ph.hasNewsCue ? 2.2 : 0) +
          (ph.clauseIndex === 0 ? 1.5 : ph.clauseIndex === 1 ? 0.7 : 0) +
          (ph.informativeCount === 3 ? 1.8 : ph.informativeCount === 2 ? 1.5 : 0.9);

        const prev = phraseScores.get(ph.key);
        if (prev) {
          prev.count += 1;
          prev.score += baseScore + 4.0; // strong multi-post repetition bonus
        } else {
          phraseScores.set(ph.key, {
            candidate: ph,
            count: 1,
            score: baseScore,
          });
        }
      }
    }

    const bestPhrase = [...phraseScores.values()].sort(
      (a, b) =>
        b.count - a.count ||
        b.score - a.score ||
        b.candidate.informativeCount - a.candidate.informativeCount,
    )[0];

    let title = "";
    let titleStems: string[] = [];

    if (matchedTrends.length > 0 && members.length >= 2) {
      title = matchedTrends[0].name;
      titleStems = foldKey(title).split(" ").map(stemArabic);
    } else if (bestPhrase) {
      title = bestPhrase.candidate.display;
      titleStems = bestPhrase.candidate.stems;
    } else if (matchedTrends.length > 0) {
      title = matchedTrends[0].name;
      titleStems = foldKey(title).split(" ").map(stemArabic);
    } else {
      continue;
    }

    const suggestedHashtag = formatSuggestedHashtag(title);
    if (!title || !suggestedHashtag) continue;

    const egyptRelated =
      members.some((m) => m.egyptRelated) ||
      Boolean(bestPhrase?.candidate.hasEgyptCue) ||
      matchedTrends.length > 0;

    // Composite newsroom importance score (0..100)
    const multiSourcePts = Math.min(sourceIds.size * 22, 44);
    const postCountPts = Math.min(members.length * 10, 24);
    const trendMatchPts = matchedTrends.length > 0 ? 18 : 0;
    const egyptPts = egyptRelated ? 10 : 0;
    const newsCuePts = bestPhrase?.candidate.hasNewsCue ? 6 : 0;
    const engPts = totalEng > 0 ? Math.min(Math.round(Math.log10(totalEng + 1) * 5), 12) : 0;
    const score = Math.min(
      100,
      multiSourcePts + postCountPts + trendMatchPts + egyptPts + newsCuePts + engPts,
    );

    const tier: ExtractedTopic["tier"] =
      sourceIds.size >= 2 || matchedTrends.length > 0 || score >= 62
        ? "high"
        : score >= 44
          ? "medium"
          : "watch";

    const evidence: TrendEvidence[] = members.slice(0, 5).map((m) => ({
      postId: m.post.id,
      sourceId: m.post.sources[0]?.id || "unknown",
      sourceName: m.post.sources.map((s) => s.name).join(" · "),
      headline: makeHeadline(m.post.text),
      url: m.post.originalUrl,
      seenAt: m.post.seenAt,
    }));

    // Pick a crisp search query (first 2 words of title so Arabic search matches reliably)
    const searchQuery = title.split(/\s+/u).slice(0, 2).join(" ");

    rawTopics.push({
      title,
      suggestedHashtag,
      searchQuery,
      score,
      tier,
      egyptRelated,
      postCount: members.length,
      sourceCount: sourceIds.size,
      engagementTotal: totalEng,
      matchedTrends,
      evidence,
      stems: titleStems,
    });
  }

  // Sort by importance and deduplicate highly overlapping topic titles
  rawTopics.sort(
    (a, b) =>
      b.sourceCount - a.sourceCount ||
      b.postCount - a.postCount ||
      b.matchedTrends.length - a.matchedTrends.length ||
      Number(b.egyptRelated) - Number(a.egyptRelated) ||
      b.score - a.score ||
      b.engagementTotal - a.engagementTotal ||
      a.title.localeCompare(b.title, "ar"),
  );

  const topics: ExtractedTopic[] = [];
  const chosenStems: string[][] = [];
  for (const cand of rawTopics) {
    if (chosenStems.some((prev) => jaccard(prev, cand.stems) >= 0.6)) continue;
    chosenStems.push(cand.stems);
    const { stems: _ignored, ...cleanTopic } = cand;
    topics.push({ rank: topics.length + 1, ...cleanTopic });
    if (topics.length >= maxTopics) break;
  }

  return {
    country: options.country ?? "EG",
    totalPostsConsidered: allFbPosts.length,
    analyzedPosts: validPosts.length,
    noiseFilteredCount,
    sourceCount: allSourceIds.size,
    hashtags,
    topics,
    referenceAt: options.referenceAt ?? null,
    referenceLabel: options.referenceLabel ?? null,
  };
}
