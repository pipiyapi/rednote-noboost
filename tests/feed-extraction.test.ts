import { describe, expect, it } from "vitest";
import { extractNoteText } from "../extension/src/content/extractor";
import { extractNoteId } from "../extension/src/content/feedObserver";

function fakeCard(options: {
  noteId?: string;
  href?: string;
  title?: string;
}): Element {
  return {
    getAttribute(name: string) {
      return name === "data-note-id" ? (options.noteId ?? null) : null;
    },
    querySelector(selector: string) {
      if (selector === 'a[href*="/explore/"]' && options.href) {
        return { href: options.href };
      }
      if (selector === "a.title" && options.title !== undefined) {
        return { textContent: options.title };
      }
      return null;
    },
  } as unknown as Element;
}

describe("小红书首页卡片提取", () => {
  it("优先从稳定的 data-note-id 读取 24 位笔记 ID", () => {
    const card = fakeCard({
      noteId: "6ab21002000000003400cb6b",
      href: "https://www.xiaohongshu.com/explore/ffffffffffffffffffffffff",
    });

    expect(extractNoteId(card)).toBe("6ab21002000000003400cb6b");
  });

  it("data-note-id 缺失时从 explore 链接降级提取", () => {
    const card = fakeCard({
      href: "https://www.xiaohongshu.com/explore/6ab21002000000003400cb6b?xsec_token=test",
    });

    expect(extractNoteId(card)).toBe("6ab21002000000003400cb6b");
  });

  it("从 a.title 提取标题，首页无正文时标记为 title 来源", () => {
    const card = fakeCard({ title: "  为什么互联网曾如此迷恋毛玻璃  " }) as HTMLElement;

    expect(extractNoteText(card)).toEqual({
      text: "为什么互联网曾如此迷恋毛玻璃",
      title: "为什么互联网曾如此迷恋毛玻璃",
      pageText: null,
      source: "title",
    });
  });

  it("空标题或占位短文本不送去计费判定", () => {
    expect(extractNoteText(fakeCard({ title: "  嗯  " }) as HTMLElement)).toBeNull();
  });
});
