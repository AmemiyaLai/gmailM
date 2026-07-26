import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();
const mockGet = vi.fn();
const mockModify = vi.fn();
const mockTrash = vi.fn();
const mockWatch = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          list: mockList,
          get: mockGet,
          modify: mockModify,
          trash: mockTrash,
        },
        watch: mockWatch,
        history: {
          list: mockList,
        },
      },
    })),
  },
}));

vi.stubEnv("GMAIL_OAUTH_CLIENT_ID", "test-client-id");
vi.stubEnv("GMAIL_OAUTH_CLIENT_SECRET", "test-client-secret");
vi.stubEnv("GMAIL_OAUTH_REFRESH_TOKEN", "test-refresh-token");
vi.stubEnv("GCP_PROJECT_ID", "test-project");
vi.stubEnv("PUBSUB_TOPIC", "test-topic");

import {
  listMessages,
  getMessage,
  markAsRead,
  markAsUnread,
  setStarred,
  archiveMessage,
  trashMessage,
  startWatch,
  listHistory,
} from "../lib/gmail";

describe("gmail.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listMessages()", () => {
    it("應回傳訊息 ID 陣列", async () => {
      mockList.mockResolvedValue({
        data: {
          messages: [{ id: "msg-1" }, { id: "msg-2" }],
          nextPageToken: undefined,
        },
      });

      const ids = await listMessages(2);
      expect(ids).toEqual(["msg-1", "msg-2"]);
    });

    it("無訊息時應回傳空陣列", async () => {
      mockList.mockResolvedValue({ data: { messages: [] } });

      const ids = await listMessages(10);
      expect(ids).toEqual([]);
    });

    it("應支援分頁", async () => {
      mockList
        .mockResolvedValueOnce({
          data: { messages: [{ id: "msg-1" }], nextPageToken: "token-1" },
        })
        .mockResolvedValueOnce({
          data: { messages: [{ id: "msg-2" }], nextPageToken: undefined },
        });

      const ids = await listMessages(2);
      expect(ids).toEqual(["msg-1", "msg-2"]);
      expect(mockList).toHaveBeenCalledTimes(2);
    });

    it("id 為 undefined 的訊息應被過濾", async () => {
      mockList.mockResolvedValue({
        data: {
          messages: [{ id: "msg-1" }, { id: undefined }, { id: "msg-3" }],
        },
      });

      const ids = await listMessages(5);
      expect(ids).toEqual(["msg-1", "msg-3"]);
    });
  });

  describe("getMessage()", () => {
    it("應正確解析郵件內容", async () => {
      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "thread-1",
          snippet: "Hello world",
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "From", value: "sender@example.com" },
              { name: "To", value: "me@example.com" },
              { name: "Subject", value: "Test Subject" },
              { name: "Date", value: "2026-07-26T08:00:00Z" },
            ],
            mimeType: "text/plain",
            body: { data: undefined },
            parts: [],
          },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.id).toBe("msg-1");
      expect(msg.sender).toBe("sender@example.com");
      expect(msg.recipient).toBe("me@example.com");
      expect(msg.subject).toBe("Test Subject");
      expect(msg.snippet).toBe("Hello world");
    });

    it("UNREAD label 應使 isRead=false", async () => {
      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: ["INBOX", "UNREAD"],
          payload: { headers: [], parts: [] },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.isRead).toBe(false);
    });

    it("無 UNREAD label 應使 isRead=true", async () => {
      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: ["INBOX"],
          payload: { headers: [], parts: [] },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.isRead).toBe(true);
    });

    it("應從 parts 提取 HTML body", async () => {
      const htmlContent = "<p>Hello</p>";
      const encodedData = Buffer.from(htmlContent).toString("base64url");

      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: [],
          payload: {
            headers: [],
            parts: [
              {
                mimeType: "text/html",
                body: { data: encodedData },
                parts: [],
              },
            ],
          },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.bodyHtml).toBe(htmlContent);
    });

    it("應從 parts 提取 plain text body", async () => {
      const plainContent = "Hello plain text";
      const encodedData = Buffer.from(plainContent).toString("base64url");

      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: [],
          payload: {
            headers: [],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: encodedData },
                parts: [],
              },
            ],
          },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.bodyPlain).toBe(plainContent);
    });

    it("應遞迴處理巢狀 parts", async () => {
      const htmlContent = "<p>Nested</p>";
      const encodedData = Buffer.from(htmlContent).toString("base64url");

      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: [],
          payload: {
            headers: [],
            parts: [
              {
                mimeType: "multipart/alternative",
                body: {},
                parts: [
                  {
                    mimeType: "text/html",
                    body: { data: encodedData },
                    parts: [],
                  },
                ],
              },
            ],
          },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.bodyHtml).toBe(htmlContent);
    });

    it("缺失的 header 應回傳空字串", async () => {
      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: [],
          payload: { headers: [], parts: [] },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.sender).toBe("");
      expect(msg.subject).toBe("");
    });

    it("labelIds 為空時 labels 應為空陣列", async () => {
      mockGet.mockResolvedValue({
        data: {
          id: "msg-1",
          threadId: "t1",
          snippet: "",
          labelIds: undefined,
          payload: { headers: [], parts: [] },
        },
      });

      const msg = await getMessage("msg-1");
      expect(msg.labels).toEqual([]);
    });
  });

  describe("markAsRead()", () => {
    it("應呼叫 modify 並移除 UNREAD label", async () => {
      mockModify.mockResolvedValue({});
      await markAsRead("msg-1");
      expect(mockModify).toHaveBeenCalledWith({
        userId: "me",
        id: "msg-1",
        requestBody: { removeLabelIds: ["UNREAD"] },
      });
    });
  });

  describe("markAsUnread()", () => {
    it("應呼叫 modify 並添加 UNREAD label", async () => {
      mockModify.mockResolvedValue({});
      await markAsUnread("msg-1");
      expect(mockModify).toHaveBeenCalledWith({
        userId: "me",
        id: "msg-1",
        requestBody: { addLabelIds: ["UNREAD"] },
      });
    });
  });

  describe("setStarred()", () => {
    it("starred=true 應添加 STARRED label", async () => {
      mockModify.mockResolvedValue({});
      await setStarred("msg-1", true);
      expect(mockModify).toHaveBeenCalledWith({
        userId: "me",
        id: "msg-1",
        requestBody: { addLabelIds: ["STARRED"] },
      });
    });

    it("starred=false 應移除 STARRED label", async () => {
      mockModify.mockResolvedValue({});
      await setStarred("msg-1", false);
      expect(mockModify).toHaveBeenCalledWith({
        userId: "me",
        id: "msg-1",
        requestBody: { removeLabelIds: ["STARRED"] },
      });
    });
  });

  describe("archiveMessage()", () => {
    it("應移除 INBOX label", async () => {
      mockModify.mockResolvedValue({});
      await archiveMessage("msg-1");
      expect(mockModify).toHaveBeenCalledWith({
        userId: "me",
        id: "msg-1",
        requestBody: { removeLabelIds: ["INBOX"] },
      });
    });
  });

  describe("trashMessage()", () => {
    it("應呼叫 trash", async () => {
      mockTrash.mockResolvedValue({});
      await trashMessage("msg-1");
      expect(mockTrash).toHaveBeenCalledWith({
        userId: "me",
        id: "msg-1",
      });
    });
  });

  describe("startWatch()", () => {
    it("應回傳 historyId 和 expiration", async () => {
      mockWatch.mockResolvedValue({
        data: { historyId: "12345", expiration: "9999999999" },
      });

      const result = await startWatch();
      expect(result.historyId).toBe("12345");
      expect(result.expiration).toBe("9999999999");
    });
  });

  describe("listHistory()", () => {
    it("應回傳歷史記錄中的訊息", async () => {
      mockList.mockResolvedValue({
        data: {
          historyId: "999",
          history: [
            {
              messagesAdded: [
                { message: { id: "msg-1" } },
                { message: { id: "msg-2" } },
              ],
            },
          ],
          nextPageToken: undefined,
        },
      });

      const result = await listHistory("100");
      expect(result.historyId).toBe("999");
      expect(result.messages).toEqual([
        { messageId: "msg-1" },
        { messageId: "msg-2" },
      ]);
    });

    it("應支援分頁", async () => {
      mockList
        .mockResolvedValueOnce({
          data: {
            historyId: "999",
            history: [{ messagesAdded: [{ message: { id: "msg-1" } }] }],
            nextPageToken: "page-2",
          },
        })
        .mockResolvedValueOnce({
          data: {
            historyId: "1000",
            history: [{ messagesAdded: [{ message: { id: "msg-2" } }] }],
            nextPageToken: undefined,
          },
        });

      const result = await listHistory("100");
      expect(result.messages).toHaveLength(2);
    });

    it("messagesAdded 為空時應回傳空陣列", async () => {
      mockList.mockResolvedValue({
        data: {
          historyId: "999",
          history: [],
          nextPageToken: undefined,
        },
      });

      const result = await listHistory("100");
      expect(result.messages).toEqual([]);
    });

    it("message.id 為 undefined 應被過濾", async () => {
      mockList.mockResolvedValue({
        data: {
          historyId: "999",
          history: [
            {
              messagesAdded: [
                { message: { id: "msg-1" } },
                { message: { id: undefined } },
              ],
            },
          ],
          nextPageToken: undefined,
        },
      });

      const result = await listHistory("100");
      expect(result.messages).toEqual([{ messageId: "msg-1" }]);
    });
  });
});
