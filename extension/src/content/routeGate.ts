// 路由闸门：判断当前是否处于「首页推荐流」，并在 SPA 路由变化时通知上层。
//
// 为什么必须有这个模块（基线 4.1 的实现基础）：
//   manifest 的 content_scripts.matches 只在【注入时】判断一次，它是门禁卡，
//   不是考勤机。小红书是 SPA：从首页点开一篇笔记时 URL 变化但页面不重载，
//   content script 会继续活着。没有这个闸门，扩展就会在笔记详情页继续过滤，
//   直接违反基线 4.1 的 MUST NOT。

/** 首页推荐流的路径。详情页形如 /explore/{24位hex}，必须排除。TODO(探针 A)：实测确认。 */
const HOME_PATHNAMES = new Set(["/", "/explore"]);

export function isHomeFeed(url: URL = new URL(location.href)): boolean {
  if (url.hostname !== "www.xiaohongshu.com") return false;
  return HOME_PATHNAMES.has(url.pathname);
}

const ROUTE_POLL_MS = 600;

/**
 * 订阅路由变化。返回取消订阅函数。
 *
 * 注意一个容易踩的原理问题：不能靠重写 history.pushState 来拦截页面的跳转。
 * content script 运行在隔离世界（isolated world），它拿到的 history 只是
 * 同一个底层对象的【本世界包装】，覆写本世界的 pushState 拦不到页面世界
 * （main world）发出的调用。
 *
 * 因此这里用两条一定能工作的路径：
 *   1. popstate —— 浏览器前进/后退会触发；
 *   2. 轮询 location.href —— location 是跨世界共享的真实状态，永远可靠。
 * 若后续实测确认 Navigation API（window.navigation 的 navigate 事件）在隔离
 * 世界可见，可以替换掉轮询（TODO 探针 A）。
 */
export function onRouteChange(handler: (url: URL) => void): () => void {
  let lastHref = location.href;

  const check = (): void => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    handler(new URL(lastHref));
  };

  window.addEventListener("popstate", check);
  const timer = window.setInterval(check, ROUTE_POLL_MS);

  return () => {
    window.removeEventListener("popstate", check);
    window.clearInterval(timer);
  };
}
