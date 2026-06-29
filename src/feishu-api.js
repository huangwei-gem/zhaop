// 飞书开放平台API封装 v2.0
const https = require("https");
const BASE_URL = "open.feishu.cn";
const BASE_PATH = "/open-apis";
let cachedToken = null, tokenExp = 0;

function req(method, host, p, h, body) {
  return new Promise((res, rej) => {
    const opts = { hostname: host, path: p, method, headers: { "Content-Type": "application/json; charset=utf-8", ...h } };
    const r = https.request(opts, (resp) => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { res(JSON.parse(d)); } catch(e) { res({code:-1,msg:"Parse error"}); } }); });
    r.on("error", rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

async function getToken() {
  const n = Date.now();
  if (cachedToken && n < tokenExp) return cachedToken;
  const r = await req("POST", BASE_URL, BASE_PATH + "/auth/v3/tenant_access_token/internal", {}, { app_id: process.env.APP_ID, app_secret: process.env.APP_SECRET });
  if (r.code !== 0) throw new Error("Token: " + (r.msg || JSON.stringify(r)));
  cachedToken = r.tenant_access_token;
  tokenExp = n + (r.expire - 60) * 1000;
  return cachedToken;
}

async function auth(method, p, body) { return await req(method, BASE_URL, p, { Authorization: "Bearer " + await getToken() }, body); }

async function listAll(bt, tid, opts) {
  let items = [], pt = null;
  while (true) {
    const o = { ...opts, pageSize: 500 }; if (pt) o.pageToken = pt;
    const r = await listRec(bt, tid, o);
    if (r.code !== 0 || !r.data || !r.data.items) break;
    items.push(...r.data.items);
    if (!r.data.has_more || !r.data.page_token) break;
    pt = r.data.page_token;
  }
  return items;
}

async function listRec(bt, tid, opts) {
  const p = [];
  if (opts && opts.viewId) p.push("view_id=" + encodeURIComponent(opts.viewId));
  if (opts && opts.pageSize) p.push("page_size=" + opts.pageSize);
  if (opts && opts.pageToken) p.push("page_token=" + encodeURIComponent(opts.pageToken));
  if (opts && opts.fieldNames) p.push("field_names=" + encodeURIComponent(JSON.stringify(opts.fieldNames)));
  if (opts && opts.displayFormulaRef) p.push("display_formula_ref=true");
  if (opts && opts.automaticFields) p.push("automatic_fields=true");
  return await auth("GET", BASE_PATH + "/bitable/v1/apps/" + bt + "/tables/" + tid + "/records" + (p.length ? "?" + p.join("&") : ""));
}

async function updateRec(bt, tid, rid, fields) {
  return await auth("PUT", BASE_PATH + "/bitable/v1/apps/" + bt + "/tables/" + tid + "/records/" + rid, { fields });
}

async function sendMsg(cid, type, content) {
  const c = typeof content === "string" ? content : JSON.stringify(content);
  return await auth("POST", BASE_PATH + "/im/v1/messages?receive_id_type=chat_id", { receive_id: cid, msg_type: type, content: c });
}

async function sendPersonalMsg(openId, type, content) {
  const c = typeof content === "string" ? content : JSON.stringify(content);
  return await auth("POST", BASE_PATH + "/im/v1/messages?receive_id_type=open_id", { receive_id: openId, msg_type: type, content: c });
}

async function findGroup(kw) {
  // 先搜索
  let r = await auth("GET", BASE_PATH + "/im/v1/chats/search?query=" + encodeURIComponent(kw));
  if (r.code === 0 && r.data && r.data.items) for (const c of r.data.items) if (c.name && c.name.includes(kw)) return c;
  // 再遍历
  let pt = null;
  while (true) {
    let pp = BASE_PATH + "/im/v1/chats?page_size=50"; if (pt) pp += "&page_token=" + encodeURIComponent(pt);
    r = await auth("GET", pp);
    if (r.code !== 0 || !r.data || !r.data.items) break;
    for (const c of r.data.items) if (c.name && c.name.includes(kw)) return c;
    if (!r.data.has_more || !r.data.page_token) break; pt = r.data.page_token;
  }
  return null;
}

async function updateMsgCard(token, msgId, card) {
  if (!msgId) return { code: -1, msg: "no msgId" };
  const body = { msg_type: "interactive", content: JSON.stringify(card) };
  return await req("PATCH", BASE_URL, BASE_PATH + "/im/v1/messages/" + msgId, {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json"
  }, body);
}

async function getUsers(openIds) {
  if (!openIds || openIds.length === 0) return [];
  const ids = Array.isArray(openIds) ? openIds : [openIds];
  const r = await auth("POST", BASE_PATH + "/im/v1/users/batch_get_id", { open_ids: ids });
  if (r.code === 0 && r.data && r.data.user_list) return r.data.user_list;
  return [];
}

module.exports = { getToken, listAll, listRec, updateRec, sendMsg, sendPersonalMsg, findGroup, updateMsgCard, getUsers };
