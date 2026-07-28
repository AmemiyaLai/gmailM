import { describe, it, expect, vi, beforeEach } from "vitest";
import { initEmailList } from "../lib/emailListClient";

interface MockElement {
  tagName: string;
  _className: string;
  className: string;
  dataset: Record<string, string>;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    toggle: (c: string, force?: boolean) => boolean;
    contains: (c: string) => boolean;
  };
  parentElement: MockElement | null;
  children: MockElement[];
  _innerHTML: string;
  innerHTML: string;
  textContent: string;
  checked?: boolean;
  indeterminate?: boolean;
  title?: string;
  attributes: Record<string, string>;
  listeners: Record<string, ((e: any) => void)[]>;
  querySelector: (sel: string) => MockElement | null;
  querySelectorAll: (sel: string) => MockElement[];
  closest: (sel: string) => MockElement | null;
  matches: (sel: string) => boolean;
  insertBefore: (newChild: MockElement, refChild: MockElement) => void;
  addEventListener: (event: string, fn: (e: any) => void) => void;
  dispatchEvent: (e: any) => void;
  remove: () => void;
  setAttribute: (key: string, val: string) => void;
  getAttribute: (key: string) => string | null;
}

function createMockElement(tagName = "DIV", initialClassName = ""): MockElement {
  const classes = new Set<string>(initialClassName.split(" ").filter(Boolean));
  const attrs: Record<string, string> = {};
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const children: MockElement[] = [];

  const el: MockElement = {
    tagName: tagName.toUpperCase(),
    _className: Array.from(classes).join(" "),
    get className() { return Array.from(classes).join(" "); },
    set className(val: string) {
      classes.clear();
      val.split(" ").filter(Boolean).forEach((c) => classes.add(c));
    },
    dataset: {},
    classList: {
      add(c: string) { classes.add(c); },
      remove(c: string) { classes.delete(c); },
      toggle(c: string, force?: boolean) {
        const has = force !== undefined ? force : !classes.has(c);
        if (has) classes.add(c); else classes.delete(c);
        return has;
      },
      contains(c: string) { return classes.has(c); },
    },
    parentElement: null,
    children,
    _innerHTML: "",
    get innerHTML() { return el._innerHTML; },
    set innerHTML(html: string) {
      el._innerHTML = html;
      children.length = 0;
      if (html.includes('class="bulk-toolbar-count"')) {
        const countSpan = createMockElement("SPAN", "bulk-toolbar-count");
        appendChild(el, countSpan);
      }
      if (html.includes('data-bulk="read"')) {
        const btn = createMockElement("BUTTON", "btn btn-outline");
        btn.dataset.bulk = "read";
        appendChild(el, btn);
      }
      if (html.includes('data-bulk="archive"')) {
        const btn = createMockElement("BUTTON", "btn btn-outline");
        btn.dataset.bulk = "archive";
        appendChild(el, btn);
      }
      if (html.includes('data-bulk="trash"')) {
        const btn = createMockElement("BUTTON", "btn btn-outline");
        btn.dataset.bulk = "trash";
        appendChild(el, btn);
      }
    },
    textContent: "",
    attributes: attrs,
    listeners,
    querySelector(sel: string) {
      const all = el.querySelectorAll(sel);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(sel: string) {
      const results: MockElement[] = [];
      function matchRecursive(node: MockElement) {
        for (const child of node.children) {
          if (child.matches(sel)) results.push(child);
          matchRecursive(child);
        }
      }
      matchRecursive(el);
      return results;
    },
    closest(sel: string) {
      let curr: MockElement | null = el;
      while (curr) {
        if (curr.matches(sel)) return curr;
        curr = curr.parentElement;
      }
      return null;
    },
    matches(sel: string) {
      if (sel.includes(" ")) {
        const parts = sel.split(" ");
        const lastPart = parts[parts.length - 1];
        return el.matches(lastPart);
      }
      if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        return classes.has(cls);
      }
      if (sel.startsWith("details")) {
        const parts = sel.split(".");
        if (parts[0] === "details" && el.tagName === "DETAILS") {
          return parts[1] ? classes.has(parts[1]) : true;
        }
      }
      if (sel.includes("data-id")) {
        if (sel === "[data-id]") return "id" in el.dataset;
        const idMatch = sel.match(/\[data-id="([^"]+)"\]/);
        if (idMatch) return el.dataset.id === idMatch[1];
        return "id" in el.dataset;
      }
      if (sel.startsWith("[")) {
        if (sel === "[data-bulk]") return "bulk" in el.dataset;
      }
      return false;
    },
    insertBefore(newChild: MockElement, refChild: MockElement) {
      const idx = children.indexOf(refChild);
      newChild.parentElement = el;
      if (idx >= 0) children.splice(idx, 0, newChild);
      else children.push(newChild);
    },
    addEventListener(event: string, fn: (e: any) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    dispatchEvent(e: any) {
      const handlers = listeners[e.type] || [];
      handlers.forEach(h => h(e));
    },
    remove() {
      if (el.parentElement) {
        const idx = el.parentElement.children.indexOf(el);
        if (idx >= 0) el.parentElement.children.splice(idx, 1);
        el.parentElement = null;
      }
    },
    setAttribute(key: string, val: string) { attrs[key] = val; },
    getAttribute(key: string) { return attrs[key] ?? null; },
  };

  return el;
}

function appendChild(parent: MockElement, child: MockElement) {
  child.parentElement = parent;
  parent.children.push(child);
}

describe("initEmailList unit tests", () => {
  const originalDocument = globalThis.document;
  const originalCSS = globalThis.CSS;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.CSS = { escape: (s: string) => s } as typeof CSS;
    const doc = {
      createElement: (tag: string) => createMockElement(tag),
    };
    globalThis.document = doc as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.CSS = originalCSS;
  });

  it("應初始化 bulk toolbar 傳入容器的父元素", () => {
    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    initEmailList(container as unknown as HTMLElement);

    expect(parent.children.length).toBe(2);
    const toolbar = parent.children[0];
    expect(toolbar.classList.contains("bulk-toolbar")).toBe(true);
  });

  it("觸發 change 事件應正確切換 selected set 與 toolbar 狀態", () => {
    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row");
    row.dataset.id = "msg-1";
    const cb = createMockElement("INPUT", "email-checkbox");
    cb.checked = true;
    appendChild(row, cb);
    appendChild(container, row);

    initEmailList(container as unknown as HTMLElement);

    const event = { type: "change", target: cb };
    container.dispatchEvent(event);

    const toolbar = parent.children[0];
    expect(toolbar.classList.contains("bulk-toolbar--visible")).toBe(true);

    cb.checked = false;
    container.dispatchEvent(event);
    expect(toolbar.classList.contains("bulk-toolbar--visible")).toBe(false);
  });

  it("觸發 group-select-all change 事件應更新群組內的 checkbox 與 selected 數量", () => {
    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const group = createMockElement("DETAILS", "sender-group");
    const selectAll = createMockElement("INPUT", "group-select-all");
    selectAll.checked = true;
    appendChild(group, selectAll);

    const row1 = createMockElement("DIV", "email-row");
    row1.dataset.id = "msg-1";
    const cb1 = createMockElement("INPUT", "email-checkbox");
    appendChild(row1, cb1);
    appendChild(group, row1);

    appendChild(container, group);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({ type: "change", target: selectAll });
    expect(cb1.checked).toBe(true);

    selectAll.checked = false;
    container.dispatchEvent({ type: "change", target: selectAll });
    expect(cb1.checked).toBe(false);
  });

  it("單一 email-checkbox 變動時應呼叫 syncGroupSelectAll 設定 indeterminate/checked 狀態", () => {
    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const group = createMockElement("DETAILS", "sender-group");
    const selectAll = createMockElement("INPUT", "group-select-all");
    appendChild(group, selectAll);

    const row1 = createMockElement("DIV", "email-row");
    row1.dataset.id = "msg-1";
    const cb1 = createMockElement("INPUT", "email-checkbox");
    appendChild(row1, cb1);
    appendChild(group, row1);

    const row2 = createMockElement("DIV", "email-row");
    row2.dataset.id = "msg-2";
    const cb2 = createMockElement("INPUT", "email-checkbox");
    appendChild(row2, cb2);
    appendChild(group, row2);

    appendChild(container, group);

    initEmailList(container as unknown as HTMLElement);

    cb1.checked = true;
    container.dispatchEvent({ type: "change", target: cb1 });
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);

    cb2.checked = true;
    container.dispatchEvent({ type: "change", target: cb2 });
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
  });

  it("點擊 star-btn 應更新星號樣式與 dataset，失敗時恢復原狀", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row");
    row.dataset.id = "msg-100";
    row.dataset.starred = "false";

    const starBtn = createMockElement("BUTTON", "star-btn");
    const starIcon = createMockElement("SPAN", "star-icon");
    appendChild(starBtn, starIcon);
    appendChild(row, starBtn);
    appendChild(container, row);

    initEmailList(container as unknown as HTMLElement);

    const event = {
      type: "click",
      target: starBtn,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    container.dispatchEvent(event);

    expect(row.dataset.starred).toBe("true");
    expect(starIcon.classList.contains("starred")).toBe(true);

    fetchMock.mockRejectedValueOnce(new Error("Network fail"));
    container.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));
    expect(row.dataset.starred).toBe("true");
  });

  it("點擊 read action 按鈕應呼叫 API 並切換狀態", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row email-row--unread");
    row.dataset.id = "msg-200";
    row.dataset.read = "false";

    const actionBtn = createMockElement("BUTTON", "action-btn");
    actionBtn.dataset.action = "read";
    actionBtn.title = "標示為已讀";
    appendChild(row, actionBtn);
    appendChild(container, row);

    initEmailList(container as unknown as HTMLElement);

    const event = {
      type: "click",
      target: actionBtn,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    container.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith("/api/emails/msg-200/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    expect(row.dataset.read).toBe("true");
  });

  it("點擊 toolbar bulk action 按鈕應執行批次操作並移除成功的 row (非 read 操作)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ succeeded: ["msg-1"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const group = createMockElement("DETAILS", "sender-group");
    const header = createMockElement("DIV", "sender-group-header");
    const badge = createMockElement("SPAN", "badge");
    badge.textContent = "2 封";
    appendChild(header, badge);
    appendChild(group, header);

    const row1 = createMockElement("DIV", "email-row");
    row1.dataset.id = "msg-1";
    const cb1 = createMockElement("INPUT", "email-checkbox");
    cb1.checked = true;
    appendChild(row1, cb1);
    appendChild(group, row1);

    const row2 = createMockElement("DIV", "email-row");
    row2.dataset.id = "msg-2";
    appendChild(group, row2);

    appendChild(container, group);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({ type: "change", target: cb1 });

    const toolbar = parent.children[0];
    const bulkBtn = toolbar.children.find((c) => c.dataset.bulk === "archive")!;

    toolbar.dispatchEvent({ type: "click", target: bulkBtn });

    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith("/api/emails/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["msg-1"], action: "archive" }),
    });
    expect(badge.textContent).toBe("1 封");
  });

  it("在 unreadOnly 模式下點擊 toolbar bulk read 按鈕應移除 successful row", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ succeeded: ["msg-1"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    container.dataset.unreadOnly = "true";
    appendChild(parent, container);

    const group = createMockElement("DETAILS", "sender-group");
    const row = createMockElement("DIV", "email-row email-row--unread");
    row.dataset.id = "msg-1";
    const cb = createMockElement("INPUT", "email-checkbox");
    cb.checked = true;
    appendChild(row, cb);
    appendChild(group, row);
    appendChild(container, group);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({ type: "change", target: cb });

    const toolbar = parent.children[0];
    const bulkBtn = toolbar.children.find((c) => c.dataset.bulk === "read")!;

    toolbar.dispatchEvent({ type: "click", target: bulkBtn });

    await new Promise((r) => setTimeout(r, 0));

    expect(group.parentElement).toBeNull();
  });


  it("在 unreadOnly=false 模式下進行 bulk read 操作時，應更新 row 狀態而不移除 row", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ succeeded: ["msg-1"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row email-row--unread");
    row.dataset.id = "msg-1";
    row.dataset.read = "false";
    const cb = createMockElement("INPUT", "email-checkbox");
    cb.checked = true;
    appendChild(row, cb);
    appendChild(container, row);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({ type: "change", target: cb });

    const toolbar = parent.children[0];
    const bulkBtn = toolbar.children.find((c) => c.dataset.bulk === "read")!;

    toolbar.dispatchEvent({ type: "click", target: bulkBtn });

    await new Promise((r) => setTimeout(r, 0));

    expect(row.dataset.read).toBe("true");
    expect(row.classList.contains("email-row--unread")).toBe(false);
    expect(cb.checked).toBe(false);
  });

  it("在 unreadOnly 模式點擊已讀操作，應正確移除 row", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    container.dataset.unreadOnly = "true";
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row email-row--unread");
    row.dataset.id = "msg-300";
    row.dataset.read = "false";

    const actionBtn = createMockElement("BUTTON", "action-btn");
    actionBtn.dataset.action = "read";
    appendChild(row, actionBtn);
    appendChild(container, row);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({
      type: "click",
      target: actionBtn,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(container.children.length).toBe(0);
  });

  it("當 read 操作 API 發生異常時，應 capture 錯誤", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error("read api fail"));
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row");
    row.dataset.id = "msg-400";
    row.dataset.read = "false";

    const actionBtn = createMockElement("BUTTON", "action-btn");
    actionBtn.dataset.action = "read";
    appendChild(row, actionBtn);
    appendChild(container, row);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({
      type: "click",
      target: actionBtn,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("當 bulk 操作 API 發生異常時，應 capture 錯誤", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error("bulk api fail"));
    vi.stubGlobal("fetch", fetchMock);

    const parent = createMockElement("DIV");
    const container = createMockElement("DIV");
    appendChild(parent, container);

    const row = createMockElement("DIV", "email-row");
    row.dataset.id = "msg-500";
    appendChild(container, row);

    const actionBtn = createMockElement("BUTTON", "action-btn");
    actionBtn.dataset.action = "archive";
    appendChild(row, actionBtn);

    initEmailList(container as unknown as HTMLElement);

    container.dispatchEvent({
      type: "click",
      target: actionBtn,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

