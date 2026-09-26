// 设置页。只做三件事：读写 chrome.storage.local、显示结果、不碰密钥以外的数据。
//
// 注意：这里【不】发送任何请求，也【不】把 Key 传给 content script。
// 密钥只有 service worker 读取并使用。

const KEYS = {
  apiKey: "typesafeApiKey",
} as const;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`options.html 缺少元素 #${id}`);
  return node as T;
}

const apiKeyInput = el<HTMLInputElement>("api-key");
const saveKeyButton = el<HTMLButtonElement>("save-key");
const keyStatus = el<HTMLSpanElement>("key-status");

chrome.storage.local.get(
  [KEYS.apiKey],
  (res: Record<string, unknown>) => {
    if (typeof res[KEYS.apiKey] === "string" && res[KEYS.apiKey] !== "") {
      // 只回显「已保存」，绝不把 Key 写回页面（避免被截屏或复制走）。
      apiKeyInput.placeholder = "•••• 已保存 ••••";
    }
  },
);

saveKeyButton.addEventListener("click", () => {
  const value = apiKeyInput.value.trim();
  if (value === "") {
    keyStatus.textContent = "请先填入 Key";
    keyStatus.className = "err";
    return;
  }
  chrome.storage.local.set({ [KEYS.apiKey]: value }, () => {
    apiKeyInput.value = "";
    apiKeyInput.placeholder = "•••• 已保存 ••••";
    keyStatus.textContent = "已保存";
    keyStatus.className = "ok";
  });
});
