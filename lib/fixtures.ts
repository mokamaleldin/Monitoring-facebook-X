import type { Media, Platform, Source, Space } from "./model.ts";

// Synthetic copy and media for the demo. Source labels identify the example workspaces.
export const demoSpaces: Space[] = [
  { id: "10000000-0000-4000-9000-000000000001", name: "مزيد", role: "editor" },
  { id: "10000000-0000-4000-9000-000000000002", name: "رصد", role: "editor" }
];
const sourceId = (i: number) => "20000000-0000-4000-9000-00000000000" + i;
export const catalog: Source[] = [
  { id: sourceId(1), name: "اليوم السابع", platform: "facebook", kind: "page", locator: "facebook:page:youm7" },
  { id: sourceId(2), name: "مزيد", platform: "facebook", kind: "page", locator: "facebook:page:mazidstories" },
  { id: sourceId(3), name: "شبكة رصد", platform: "facebook", kind: "page", locator: "facebook:page:rassdnewsn" },
  { id: sourceId(4), name: "اليوم السابع", platform: "x", kind: "account", locator: "x:account:youm7" }
];
export type Fixture = {
  id: string; platform: Platform; media: Media; text: string; asset: string | null;
  published: string | null; appearances: { sourceId: string; seen: string }[]
};
function fixture(index: number, media: Media, text: string, at: string, ids: number[], asset: string | null = null): Fixture {
  return { id: "30000000-0000-4000-9000-00000000000" + index, platform: ids[0] === 4 ? "x" : "facebook",
    media, text, asset, published: "2026-11-18T" + at + ":00Z",
    appearances: ids.map((id, pos) => ({sourceId: sourceId(id), seen: "2026-11-18T" + at + ":" + (pos ? "55" : "28") + "Z"})) };
}
export const fixtures = [
  fixture(1, "photo", "برنامج اليوم في معرض الكتاب. ثلاث محطات من افتتاح القاعات صباحًا إلى اللقاء المفتوح مع القراء بعد الظهر.", "10:15", [1], "/demo/program.png"),
  fixture(2, "text", "كيف تختار المكتبات المشاركة عناوينها؟ نفتح ملف القراءة العامة، ونجمع أسئلة القراء للقاء المساء.", "09:48", [2]),
  fixture(3, "text", "دليل الوصول إلى المعرض. تتوزع نقاط الاستعلام عند المداخل، ويضم البرنامج جولة للتعريف بالقاعات.", "09:36", [3]),
  fixture(4, "video", "مواعيد معرض الكتاب في مقطع قصير، من فتح الأبواب إلى بداية الجلسة الثقافية.", "09:10", [1], "/demo/program.mp4"),
  fixture(5, "text", "معرض الكتاب يخصص لقاءً مفتوحًا للقراء ضمن برنامج اليوم. نتابع الأسئلة التي تهم الزوار.", "08:42", [1, 3]),
  fixture(6, "text", "برنامج معرض الكتاب يجمع جلسة ثقافية ولقاءً مفتوحًا للقراء. #معرض_الكتاب", "08:22", [4])
];
export const startingFollows: Record<string, string[]> = {
  [demoSpaces[0].id]: [sourceId(1), sourceId(2)],
  [demoSpaces[1].id]: [sourceId(1), sourceId(3)]
};
