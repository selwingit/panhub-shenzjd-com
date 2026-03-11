import { load } from "cheerio";
import { ofetch } from "ofetch";
import type { SearchResult } from "../types/models";

export interface TgFetchOptions {
  limitPerChannel?: number;
  userAgent?: string;
}

export async function fetchTgChannelPosts(
  channel: string,
  keyword: string,
  options: TgFetchOptions = {}
): Promise<SearchResult[]> {
  const url = `https://t.me/s/${encodeURIComponent(channel)}`;
  const ua =
    options.userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
  let html = "";
  try {
    html = await ofetch<string>(url, { headers: { "user-agent": ua } });
  } catch (e) {
    // ignore, try fallback below
  }
  // 如果直连失败或页面不包含目标结构，尝试使用只读代理镜像（无跨域、仅返回渲染后的 HTML 文本）
  if (!html || !html.includes("tgme_widget_message")) {
    const mirrors = [
      `https://r.jina.ai/http://t.me/s/${encodeURIComponent(channel)}`,
      `https://r.jina.ai/https://t.me/s/${encodeURIComponent(channel)}`,
      `https://r.jina.ai/http://t.me/${encodeURIComponent(channel)}`,
      `https://r.jina.ai/https://t.me/${encodeURIComponent(channel)}`,
    ];
    for (const m of mirrors) {
      try {
        html = await ofetch<string>(m, { headers: { "user-agent": ua } });
        if (html && html.includes("tgme_widget_message")) break;
      } catch {}
    }
  }
  const $ = load(html || "");

  const results: SearchResult[] = [];
  const limit = options.limitPerChannel ?? 50;
  const kw = keyword.trim().toLowerCase();

  const deproxyUrl = (raw: string): string => {
    try {
      const u = new URL(raw);
      // 处理 r.jina.ai 只读代理，形如 https://r.jina.ai/https://pan.quark.cn/s/...
      if (u.hostname === "r.jina.ai") {
        const path = decodeURIComponent(u.pathname || "");
        if (path.startsWith("/http://") || path.startsWith("/https://")) {
          return path.slice(1);
        }
      }
      return raw;
    } catch {
      return raw;
    }
  };

  const classifyByHostname = (hostname: string, href: string): string => {
    const host = hostname.toLowerCase();
    // 屏蔽 telegram 自身域名
    if (host === "t.me" || host.endsWith(".t.me")) return "";
    if (host === "r.jina.ai") return ""; // 代理本身不算

    // 阿里云盘（含新域名 alipan.com）
    if (host.endsWith("alipan.com") || host.endsWith("aliyundrive.com")) {
      return "aliyun";
    }
    // 百度网盘（限定 pan 子域）
    if (host === "pan.baidu.com") return "baidu";
    // 夸克网盘
    if (host === "pan.quark.cn") return "quark";
    // 迅雷云盘
    if (host === "pan.xunlei.com") return "xunlei";
    // 123 网盘
    if (host.endsWith("123pan.com")) return "123";
    // 天翼云
    if (host === "cloud.189.cn") return "tianyi";
    // 115 网盘
    if (host === "115.com" || host.endsWith(".115.com")) return "115";
    // UC 网盘
    if (host === "drive.uc.cn") return "uc";
    // 移动云盘
    if (host === "yun.139.com") return "mobile";
    return "";
  };

  $(".tgme_widget_message_wrap").each((i, el) => {
    if (results.length >= limit) return false;
    const root = $(el);
    const text = root.find(".tgme_widget_message_text").text().trim();
    const dateTitle = root.find("time").attr("datetime") || "";
    const postId = root.find(".tgme_widget_message").attr("data-post") || "";

    // 提取第一行
    const firstLine = text.split("\n")[0] || text.slice(0, 80);

    // 关键词过滤（包含即可）
    if (kw && kw.length > 0) {
      const hay = (firstLine + " " + text).toLowerCase();
      if (!hay.includes(kw)) return;
    }

    // 简单提取常见网盘链接（包括文本与 a[href]）
    const links: { type: string; url: string; password: string }[] = [];
    const seenUrls = new Set<string>();
    // 更严格的 URL 匹配（仅 RFC3986 允许的字符，避免把中文等拼进去）
    const urlPattern =
      /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/g;
    const passwdPattern = /(?:提取码|密码|pwd|pass)[:：\s]*([a-zA-Z0-9]{3,6})/i;

    const addUrl = (raw: string) => {
      const deproxied = deproxyUrl(raw);
      let host = "";
      try {
        host = new URL(deproxied).hostname || "";
      } catch {
        return; // 非法 URL
      }
      const type = classifyByHostname(host, deproxied);
      if (!type) return; // 非白名单域名，跳过

      const key = deproxied.toLowerCase();
      if (seenUrls.has(key)) return;
      seenUrls.add(key);

      const m = text.match(passwdPattern);
      const password = m ? m[1] : "";
      links.push({ type, url: deproxied, password });
    };

    const urlsFromText = text.match(urlPattern) || [];
    for (const u of urlsFromText) addUrl(u);

    root.find(".tgme_widget_message_text a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (href) addUrl(href);
    });

    // 生成 title：移除 URL，保留其他文本
    let title = firstLine;
    for (const link of links) {
      const escaped = link.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      title = title.replace(new RegExp(escaped, "g"), "");
    }
    // 移除常见的分隔符和平台名称（但保留其他内容）
    title = title
      .replace(/(夸克|UC|百度|阿里|迅雷|115|天翼|123|移动|提取码|密码|：|:|，|,|。|\.|、|\||-)+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    // 如果清理后为空，使用原始第一行
    if (!title) title = firstLine.slice(0, 80);

    // 生成 content：移除 URL 和密码
    let content = text;
    for (const link of links) {
      const escaped = link.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      content = content.replace(new RegExp(escaped, "g"), "");
      if (link.password) {
        content = content.replace(new RegExp(`(?:提取码|密码|pwd|pass)[:：\\s]*${link.password}`, "gi"), "");
      }
    }
    // 移除平台名称和多余空格
    content = content
      .replace(/(夸克|UC|百度|阿里|迅雷|115|天翼|123|移动|：|:|，|,|。|\.|、|\||-)+/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const sr: SearchResult = {
      message_id: postId,
      unique_id: `tg-${channel}-${postId || i}`,
      channel,
      datetime: dateTitle ? new Date(dateTitle).toISOString() : "",
      title,
      content,
      links,
    };
    results.push(sr);
  });

  return results;
}
