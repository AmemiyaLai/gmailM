import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initSenderJumpNav,
  senderMatchesQuery,
  setActiveSenderLink,
} from "../lib/senderJumpNavClient";

type Listener = (event: { type: string; key?: string; target?: unknown }) => void;

class MockClassList {
  private values = new Set<string>();

  add(value: string) { this.values.add(value); }
  remove(value: string) { this.values.delete(value); }
  contains(value: string) { return this.values.has(value); }
  toggle(value: string, force?: boolean) {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }
}

class MockElement {
  dataset: Record<string, string> = {};
  classList = new MockClassList();
  hidden = false;
  value = "";
  tagName = "DIV";
  open = false;
  focused = false;
  attributes: Record<string, string> = {};
  listeners = new Map<string, Set<Listener>>();
  single = new Map<string, MockElement>();
  multiple = new Map<string, MockElement[]>();

  querySelector(selector: string) {
    return this.single.get(selector) ?? null;
  }

  querySelectorAll(selector: string) {
    return this.multiple.get(selector) ?? [];
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Partial<Parameters<Listener>[0]> = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target: this, ...event });
    }
  }

  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  focus() { this.focused = true; }
  contains(target: unknown) {
    return target === this || [...this.single.values()].includes(target as MockElement)
      || [...this.multiple.values()].flat().includes(target as MockElement);
  }
}

describe("senderJumpNavClient", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let documentListeners: Map<string, Set<Listener>>;
  let ids: Map<string, MockElement>;

  beforeEach(() => {
    documentListeners = new Map();
    ids = new Map();
    globalThis.window = {} as Window & typeof globalThis;
    globalThis.document = {
      getElementById: (id: string) => ids.get(id) ?? null,
      addEventListener: (type: string, listener: Listener) => {
        const listeners = documentListeners.get(type) ?? new Set<Listener>();
        listeners.add(listener);
        documentListeners.set(type, listeners);
      },
      removeEventListener: (type: string, listener: Listener) => {
        documentListeners.get(type)?.delete(listener);
      },
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  it("搜尋應忽略前後空白與大小寫", () => {
    expect(senderMatchesQuery("Alice ALICE@EXAMPLE.COM", " alice ")).toBe(true);
    expect(senderMatchesQuery("Bob bob@example.com", "alice")).toBe(false);
  });

  it("應正確設定目前寄件者連結", () => {
    const first = new MockElement();
    first.dataset.target = "sender-1";
    const second = new MockElement();
    second.dataset.target = "sender-2";

    setActiveSenderLink(
      [first, second] as unknown as HTMLAnchorElement[],
      "sender-2",
    );

    expect(first.classList.contains("is-active")).toBe(false);
    expect(second.classList.contains("is-active")).toBe(true);
    expect(second.attributes["aria-current"]).toBe("location");
  });

  it("應支援抽屜開關、搜尋、Escape 與折疊群組展開", () => {
    const root = new MockElement();
    const trigger = new MockElement();
    const close = new MockElement();
    const search = new MockElement();
    const empty = new MockElement();
    empty.hidden = true;
    const link = new MockElement();
    link.dataset.target = "sender-1";
    link.dataset.search = "Alice alice@example.com";
    const details = new MockElement();
    details.tagName = "DETAILS";
    ids.set("sender-1", details);

    root.single.set(".sender-jump-trigger", trigger);
    root.single.set(".sender-jump-close", close);
    root.single.set('input[type="search"]', search);
    root.single.set(".sender-jump-empty", empty);
    root.multiple.set(".sender-jump-link", [link]);

    const cleanup = initSenderJumpNav(root as unknown as HTMLElement);

    trigger.dispatch("click");
    expect(root.classList.contains("sender-jump--open")).toBe(true);
    expect(trigger.attributes["aria-expanded"]).toBe("true");
    expect(search.focused).toBe(true);

    search.value = "nobody";
    search.dispatch("input");
    expect(link.hidden).toBe(true);
    expect(empty.hidden).toBe(false);

    search.value = "alice@example.com";
    search.dispatch("input");
    expect(link.hidden).toBe(false);

    link.dispatch("click");
    expect(details.open).toBe(true);
    expect(link.classList.contains("is-active")).toBe(true);
    expect(root.classList.contains("sender-jump--open")).toBe(false);

    trigger.dispatch("click");
    for (const listener of documentListeners.get("keydown") ?? []) {
      listener({ type: "keydown", key: "Escape" });
    }
    expect(root.classList.contains("sender-jump--open")).toBe(false);
    expect(trigger.focused).toBe(true);

    cleanup();
    expect(root.dataset.ready).toBeUndefined();
  });
});
