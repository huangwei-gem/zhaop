// 飞书招聘人才库监控机器人 v7.0
const lark = require("@larksuiteoapi/node-sdk");
const feishu = require("./feishu-api");
const card = require("./card-builder");

const { APP_ID, APP_SECRET, INTERVAL = 30,
  BASE_TOKEN = "NVh9bDiNRaF0ZysxjeLc5ID2n9c",
  TALENT_TABLE = "tblWkwsoTIPhzusI", TALENT_VIEW = "vewhPWSFb4",
  TASK_TABLE = "tblEiMBFXcvSspQd", TASK_VIEW = "vew6FrrDnU"
} = process.env;

const processed = new Set();
const processedTasks = new Set();
const sentCards = new Map(); // record_id -> { msgId, chatId }
let taskCache = [];
let groupCache = {};
let optIdToName = {};

const F = card.F2;

function optName(val) {
  if (!val) return "";
  const ids = Array.isArray(val) ? val : [val];
  return ids.map(id => optIdToName[id] || id).filter(Boolean).join(",");
}

async function init() {
  if (!APP_ID || !APP_SECRET) { console.error("[错误] 请设置 APP_ID 和 APP_SECRET"); process.exit(1); }
  await feishu.getToken();
  console.log("[启动] Token 获取成功");
  await refreshTasks();
  await loadOptionMap();
  try {
    const r = await feishu.listAll(BASE_TOKEN, TALENT_TABLE, { viewId: TALENT_VIEW });
    if (r && r.length) {
      for (const rec of r) processed.add(rec.record_id);
      console.log("[启动] 已加载 " + processed.size + " 条已有记录");
    }
  } catch (e) { console.error("[启动] 加载已有记录失败:", e.message); }
    // 加载已有任务ID到processedTasks
  for (const t of taskCache) processedTasks.add(t.record_id);
  // 测试阶段: 保留最后3行待建群, 其余标记为已处理
  var last3Rows = taskCache.slice(-3);
  for (const t of last3Rows) processedTasks.delete(t.record_id);
  console.log("[启动] 保留最后 " + last3Rows.length + " 行待建群, 其余 " + processedTasks.size + " 条已标记");
  console.log("[启动] 初始化完成");
}

async function loadOptionMap() {
  console.log("[缓存] 加载选项映射...");
  try {
    const token = await feishu.getToken();
    const https = require("https");
    const url = "/open-apis/bitable/v1/apps/" + BASE_TOKEN + "/tables/" + TASK_TABLE + "/fields";
    const r = await new Promise((res, rej) => {
      const opts = { hostname: "open.feishu.cn", path: url, method: "GET",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } };
      const req = https.request(opts, resp => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => res(JSON.parse(d))); });
      req.on("error", rej); req.end();
    });
    if (r.code === 0 && r.data && r.data.items) {
      const map = {};
      for (const f of r.data.items)
        if (f.property && f.property.options)
          for (const o of f.property.options) map[o.id] = o.name;
      optIdToName = map;
      console.log("[缓存] 加载了 " + Object.keys(map).length + " 个选项映射");
    }
  } catch (e) { console.error("[缓存] 选项映射失败:", e.message); }
}

async function refreshTasks() {
  console.log("[缓存] 刷新招聘任务...");
  try {
    const r = await feishu.listRec(BASE_TOKEN, TASK_TABLE, { viewId: TASK_VIEW, pageSize: 500, automaticFields: true });
    if (r.code === 0 && r.data && r.data.items) {
      taskCache = r.data.items;
      console.log("[缓存] 加载了 " + taskCache.length + " 条任务");
    }
  } catch (e) { console.error("[缓存] 刷新失败:", e.message); }
}

// ====== 自动建群 ======
// 用user_access_token(黄维身份)建群拉人
var userTokenCache = null;
var userTokenExp = 0;

async function getUserToken() {
	var now = Date.now();
	if (userTokenCache && now < userTokenExp) return userTokenCache;
	var f2=require("fs");
	var tf=__dirname+"/../user_token.json";
	var rt=null;
	try{var td=JSON.parse(f2.readFileSync(tf,"utf8"));rt=td.refresh_token;}catch(e){}
	if(!rt){console.log("[建群] 无refresh_token,请先授权");return null;}
	var https=require("https");
	var b=JSON.stringify({grant_type:"refresh_token",refresh_token:rt,app_id:APP_ID,app_secret:APP_SECRET});
	var r=await new Promise(function(res,rej){
		var o={hostname:"open.feishu.cn",path:"/open-apis/authen/v1/refresh_access_token",method:"POST",headers:{"Content-Type":"application/json; charset=utf-8"}};
		var req=https.request(o,function(rp){var d="";rp.on("data",function(c){d+=c;});rp.on("end",function(){res(JSON.parse(d));});});
		req.on("error",rej);req.write(b);req.end();
	});
	if(r.code===0&&r.data&&r.data.access_token){
		userTokenCache=r.data.access_token;
		userTokenExp=now+(r.data.expires_in-60)*1000;
		f2.writeFileSync(tf,JSON.stringify({refresh_token:r.data.refresh_token}),"utf8");
		console.log("[建群] token刷新成功");
		return userTokenCache;
	}
	console.error("[建群] token刷新失败:"+r.msg);
	return null;
}

async function autoCreateGroup() {
  try {
    var userToken = await getUserToken();
    if (!userToken) { console.log("[建群] 未授权,跳过建群"); return; }
    var r = await feishu.listRec(BASE_TOKEN, TASK_TABLE, { viewId: TASK_VIEW, pageSize: 500, automaticFields: true });
    if (r.code !== 0 || !r.data || !r.data.items) return;
    var tasks = r.data.items;
    console.log("[建群] 读取到 " + tasks.length + " 个任务, processedTasks=" + processedTasks.size);

    // 过滤: 跳过已处理任务, 只处理招聘中的
    var active = [];
    for (var task of tasks) {
      if (processedTasks.has(task.record_id)) continue;
      processedTasks.add(task.record_id);
      var tf = (task && task.fields) || {};
      var st = Array.isArray(tf["招聘状态"])
        ? ((tf["招聘状态"][0] && tf["招聘状态"][0].name) ? tf["招聘状态"][0].name : String(tf["招聘状态"][0] || ""))
        : String(tf["招聘状态"] || "");
      if (st === "招聘中") active.push(task);
    }
    console.log("[建群] 待处理新任务: " + active.length + " 个");

    // 按面试官组合去重: 用所有面试官ID排序后拼接成唯一key
    var combos = {};
    for (var task of active) {
      var tf = (task && task.fields) || {};
      var biz1 = Array.isArray(tf["业务一面"]) ? tf["业务一面"] : [];
      var hr2 = Array.isArray(tf["HR二面"]) ? tf["HR二面"] : [];
      var fin = Array.isArray(tf["终面"]) ? tf["终面"] : [];
      var ids = []; var ns = []; var oids = [];
      function collect(arr) {
        for (var i = 0; i < arr.length; i++) { var x = arr[i]; if (x && x.id) ids.push(x.id); if (x && x.name) ns.push(x.name); if (x && x.id) oids.push(x.id); }
      }
      collect(biz1); collect(hr2); collect(fin);
      if (ids.length === 0) continue;
      var key = ids.slice().sort().join(",");
      if (!combos[key]) combos[key] = { names: [], openIds: [] };
      for (var nm of ns) { if (combos[key].names.indexOf(nm) === -1) combos[key].names.push(nm); }
      for (var oi of oids) { if (combos[key].openIds.indexOf(oi) === -1) combos[key].openIds.push(oi); }
    }
    console.log("[建群] 唯一面试官组合数: " + Object.keys(combos).length);
    for (var k in combos) console.log("[建群]   组合: " + combos[k].names.join("、"));

    // 为每个唯一组合建一个群
    for (var k in combos) {
      var c = combos[k];
      var gn = c.names.join("、") + "招聘群";
      var ex = await feishu.findGroup(gn);
      if (ex) { console.log("[建群] " + gn + " 已存在跳过"); continue; }
      console.log("[建群] 创建群: " + gn);
      if (c.openIds.length === 0) { console.log("[建群] 无面试官ID"); continue; }
      var https = require("https");
      var body = JSON.stringify({
        name: gn, description: "招聘群", only_at: false, membership_approval: false,
        chat_type: "private", owner_id: "ou_2b11f9d276ced64c5aa10e8cea8fcb65",
        user_id_list: c.openIds, bot_id_list: ["cli_aab1ca3228f91cef"]
      });
      console.log("[建群] 请求:", body);
      var cr = await new Promise(function (res, rej) {
        var opts = {
          hostname: "open.feishu.cn", path: "/open-apis/im/v1/chats?set_bot_manager=true",
          method: "POST", headers: { Authorization: "Bearer " + userToken, "Content-Type": "application/json; charset=utf-8" }
        };
        var req = https.request(opts, function (rp) { var d = ""; rp.on("data", function (c) { d += c; }); rp.on("end", function () { res(JSON.parse(d)); }); });
        req.on("error", rej); req.write(body); req.end();
      });
      console.log("[建群] 响应:", JSON.stringify(cr));
      if (cr.code === 0 && cr.data && cr.data.chat_id) {
        console.log("[建群] 成功: " + gn + " chat_id:" + cr.data.chat_id);
        groupCache[gn] = cr.data.chat_id;
      } else {
        console.error("[建群] 失败:", cr.msg);
      }
    }
    console.log("[建群] 全部处理完成");
  } catch (e) { console.error("[建群] 错误:", e.message); }
}
// ====== 群搜索 ======// ====== 群搜索 ======
function getGroupKeyword(task) {
  const tf = (task && task.fields) || {};
  const names = [];
  if (Array.isArray(tf["业务一面"])) tf["业务一面"].forEach(x => { if (x && x.name) names.push(x.name); });
  if (Array.isArray(tf["HR二面"])) tf["HR二面"].forEach(x => { if (x && x.name) names.push(x.name); });
  if (Array.isArray(tf["终面"])) tf["终面"].forEach(x => { if (x && x.name) names.push(x.name); });
  return names.join("、") + "招聘群";
}

async function findGroupChatId(task) {
  if (!task) return null;
  const kw = getGroupKeyword(task);
  if (groupCache[kw]) return groupCache[kw];
  console.log("[群] 搜索: " + kw);
  let chat = await feishu.findGroup(kw);
  if (!chat) {
    const names = kw.replace("招聘群", "").split("、");
    for (const n of names) {
      if (!n) continue;
      chat = await feishu.findGroup(n);
      if (chat) { console.log("[群] 通过人名 \"" + n + "\" 找到群: \"" + chat.name + "\""); break; }
    }
  }
  if (chat) { groupCache[kw] = chat.chat_id; return chat.chat_id; }
  return null;
}

// ====== 匹配逻辑 ======
function matchRecordToTask(rec) {
  const f = (rec && rec.fields) || {};
  const d2Name = optName(f[F.dept2]);
  const d3Name = optName(f[F.dept3]);
  const posName = optName(f[F.pos]);
  const loc = f[F.loc] || optName(f[F.belongCity]) || "";
  if (!d2Name && !d3Name && !posName) return null;
  const PREFER = ["招聘中", "待招聘", "储备简历"];
  let bestMatch = null, bestScore = -1;
  for (const t of taskCache) {
    const tf = (t && t.fields) || {};
    const td2 = String(tf["二级部门"] || "");
    const td3 = String(tf["三级部门"] || "");
    const tpos = String(tf["招聘岗位"] || "");
    const tloc = String(tf["城市"] || "");
    const tstat = Array.isArray(tf["招聘状态"])
      ? ((tf["招聘状态"][0] && tf["招聘状态"][0].name) ? tf["招聘状态"][0].name : String(tf["招聘状态"][0] || ""))
      : String(tf["招聘状态"] || "");
    let score = 0;
    if (d2Name && td2.includes(d2Name)) score += 3;
    if (d3Name && td3.includes(d3Name)) score += 2;
    if (posName && tpos.includes(posName)) score += 3;
    if (loc && tloc.includes(loc)) score += 2;
    if (PREFER.includes(tstat)) score += 2;
    if (score > bestScore) { bestScore = score; bestMatch = t; }
  }
  return bestScore > 0 ? bestMatch : null;
}

// ====== 处理新记录 ======
async function processRecord(rec) {
  const f = (rec && rec.fields) || {};
  const name = f[F.name] || "未知";
  const recordId = rec.record_id;
  const aiRaw = f[F.aiResult];
  const aiVal = aiRaw ? (Array.isArray(aiRaw) ? String(aiRaw[0] || "") : String(aiRaw)) : "";
  if (!aiVal) { console.log("[处理] " + name + " AI为空 跳过"); return; }
  console.log("[处理] " + name + " id:" + recordId + " AI:" + aiVal.substring(0, 20));
  const d2Name = optName(f[F.dept2]);
  const d3Name = optName(f[F.dept3]);
  const posName = optName(f[F.pos]);
  const loc = f[F.loc] || optName(f[F.belongCity]) || "";
  console.log("[处理] 部门:" + d2Name + "/" + d3Name + " 岗位:" + posName + " 城市:" + loc);
  const task = matchRecordToTask(rec);
  if (!task) { console.log("[处理] " + name + " 未匹配"); return; }
  console.log("[处理] " + name + " -> 任务:" + task.record_id);
  const tf = task.fields || {};
  const hr2 = Array.isArray(tf["HR二面"]) ? tf["HR二面"].map(x => x.name).join(",") : "";
  const biz1 = Array.isArray(tf["业务一面"]) ? tf["业务一面"].map(x => x.name).join(",") : "";
  console.log("[处理] 面试官: 业务一面=" + biz1 + " HR二面=" + hr2);
  const chatId = await findGroupChatId(task);
  if (!chatId) { console.log("[处理] " + name + " 无群"); return; }
  console.log("[处理] 群 chat_id:" + chatId);
  const cardBody = card.build(rec, task);
  console.log("[处理] 发送卡片...");
  const r = await feishu.sendMsg(chatId, "interactive", JSON.stringify(cardBody));
  if (r.code === 0) {
    const msgId = (r.data && r.data.message_id) || "";
    sentCards.set(recordId, { msgId, chatId });
    console.log("[处理] 成功: " + name + " -> " + getGroupKeyword(task) + " msg:" + msgId);
  } else {
    console.error("[处理] 失败:", r.code, r.msg || JSON.stringify(r));
  }
}

// ====== 定时检查 ======
async function check() {
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  console.log("[检查] " + now + " 开始...");
  try {
    const r = await feishu.listRec(BASE_TOKEN, TALENT_TABLE, { viewId: TALENT_VIEW, pageSize: 500 });
    if (r.code !== 0 || !r.data || !r.data.items) { console.log("[检查] 失败 code:" + r.code); return; }
    console.log("[检查] " + r.data.items.length + " 条");
    let newCount = 0;
    for (const rec of r.data.items) {
      if (processed.has(rec.record_id)) continue;
      const aiRaw = rec.fields ? rec.fields[F.aiResult] : "";
      const aiVal = aiRaw ? (Array.isArray(aiRaw) ? String(aiRaw[0] || "") : String(aiRaw)) : "";
      if (aiVal) {
        processed.add(rec.record_id);
        newCount++;
        console.log("[检查] #" + newCount + " ID:" + rec.record_id + " " + ((rec.fields && rec.fields[F.name]) || "无") + " AI:" + aiVal.substring(0, 20));
        await processRecord(rec);
      } else {
        console.log("[检查] AI空 等待下次");
      }
    }
    if (newCount > 0) console.log("[检查] 处理 " + newCount + " 条");
    else console.log("[检查] " + now + " 无新增");
  } catch (e) { console.error("[检查] 错误:", e.message); }
}

// ====== 消息处理 ======
async function handleMessage(data) {
	try {
		const message = (data && data.message) || (data && data.event && data.event.message);
		if (!message) return;
		const contentStr = message.content;
		if (!contentStr || message.message_type !== "text") return;
		let content;
		try { content = JSON.parse(contentStr); } catch (e) { content = { text: contentStr }; }
		const text = content.text || "";
		const cleanText = text.replace(/<at[^>]*>[^<]*<\/at>/g, "").trim();
	
	// === 建群命令 ===
		if (cleanText === "建群") {
			console.log("[消息] 触发手动建群");
			const chatId = message.chat_id;
			await feishu.sendMsg(chatId, "text", JSON.stringify({text: "正在检查招聘任务并建群..."}));
			await autoCreateGroup();
			await feishu.sendMsg(chatId, "text", JSON.stringify({text: "建群检查完成"}));
			return;
		}
	
	// === 一面评价 ===
		const reviewMatch = cleanText.match(/([^\s@]+)\s*一面评价[\uFF1A:]?\s*(.*)/);
		if (reviewMatch) {
			const targetName = reviewMatch[1].trim();
			const reviewContent = (reviewMatch[2] || "").trim();
			const chatId = message.chat_id;
			if (!chatId || !targetName) { console.log("[消息] 缺参数"); return; }
			console.log("[消息] 候选人:" + targetName + " 内容:" + (reviewContent || "空"));
			let recId = null;
			let fullName = targetName;
			try {
				const r = await feishu.listRec(BASE_TOKEN, TALENT_TABLE, { viewId: TALENT_VIEW, pageSize: 500 });
				if (r.code === 0 && r.data && r.data.items) {
					for (const rec of r.data.items) {
						const name = (rec.fields && rec.fields[F.name]) || "";
						if (name === targetName || name.includes(targetName)) {
							recId = rec.record_id;
							fullName = name;
							break;
						}
					}
				}
			} catch (e) { console.error("[消息] 查人才库失败:", e.message); }
			if (!recId) {
				console.log("[消息] 未找到:" + targetName);
				await feishu.sendMsg(chatId, "text", JSON.stringify({text: "未找到【" + targetName + "】，请确认姓名正确"}));
				return;
			}
			if (!reviewContent) {
				await feishu.sendMsg(chatId, "text", JSON.stringify({text: "请发送完整格式：" + fullName + " 一面评价：你的评价内容"}));
				return;
			}
			console.log("[消息] 写入一面建议: " + fullName + " -> " + reviewContent);
			if (recId) {
				const upRes = await feishu.updateRec(BASE_TOKEN, TALENT_TABLE, recId, { [F.interviewAdvice]: reviewContent });
				console.log("[消息] 写入:", upRes.code === 0 ? "成功" : JSON.stringify(upRes));
				if (upRes.code === 0) {
					await feishu.sendMsg(chatId, "text", JSON.stringify({text: "✅ 已记录【" + fullName + "】的一面评价"}));
				}
			}
			return;
		}
	
	// === 面试情况统计 ===
		if (cleanText.includes("面试情况")) {
			console.log("[消息] 触发面试统计");
			await sendInterviewStats();
			return;
		}
	} catch (e) { console.error("[消息] 错误:", e.message); }
}
// ====== 卡片回调处理 ======
async function handleCardAction(data) {
  const action = data && data.action;
  const operator = data && data.operator;
  console.log("[卡片回调] 收到", JSON.stringify({
    value: (action && action.value) || {},
    op: { user_id: (operator && operator.user_id) || "", open_id: (operator && operator.open_id) || "" }
  }).substring(0, 500));

  const v = action && action.value;
  if (!v || !v.record_id) return { toast: { type: "error", content: "参数错误" } };

  const { record_id, result, action: act, name: vname } = v;
  const operatorName = (operator && (operator.user_id || operator.open_id)) || "未知";

  // === 一面评价（已废弃卡片方案，改用消息文本解析） ===
  if (act === "interview_ask_reason" || act === "interview_submit" || act === "interview_custom_reason" || act === "submit_interview_review") {
    console.log("[回调] 收到旧卡片交互，忽略: " + act);
    return { toast: { type: "info", content: "请在群里发送: 姓名 一面评价：内容" } };
  }
  // === HR/业务复核 ===
  console.log("[回调] " + act + " -> " + result + " 记录:" + record_id);
  const fields = {};
  if (act === "hr_review") fields[F.hrResult] = (result === "pass") ? "通过" : "淘汰";
  if (act === "biz_review") fields[F.bizResult] = (result === "pass") ? "通过" : "淘汰";
  console.log("[回调] 写入:", JSON.stringify(fields));
  const updateRes = await feishu.updateRec(BASE_TOKEN, TALENT_TABLE, record_id, fields);
  console.log("[回调] 写入:", updateRes.code === 0 ? "成功" : JSON.stringify(updateRes));

  const sent = sentCards.get(record_id);
  if (sent && sent.msgId) {
    const token = await feishu.getToken();
    const doneBody = card.doneCard(vname || "未知", act, result, operatorName);
    console.log("[回调] 更新卡片 msg:" + sent.msgId);
    const cardRes = await feishu.updateMsgCard(token, sent.msgId, doneBody);
    console.log("[回调] 卡片:", cardRes.code === 0 ? "成功" : JSON.stringify(cardRes));
  } else {
    console.log("[回调] 无消息记录，跳过卡片更新");
  }

  return { toast: { type: "success", content: "操作已记录" } };
}

// ====== 消息处理 ======
async function handleMessage(data) {
  try {
    const message = (data && data.message) || (data && data.event && data.event.message);
    if (!message) return;
    const contentStr = message.content;
    if (!contentStr || message.message_type !== "text") return;
    let content;
    try { content = JSON.parse(contentStr); } catch (e) { content = { text: contentStr }; }
    const text = content.text || "";

            // 检测 "姓名 一面评价：内容" -> 按姓名匹配，直接写入一面建议
    const cleanText = text.replace(/<at[^>]*>[^<]*<\/at>/g, "").trim();
    const reviewMatch = cleanText.match(/([^\s@]+)\s*一面评价[：:]?\s*(.*)/);
    if (reviewMatch) {
      const targetName = reviewMatch[1].trim();
      const reviewContent = (reviewMatch[2] || "").trim();
      const chatId = message.chat_id;
      if (!chatId || !targetName) { console.log("[消息] 缺参数"); return; }
      console.log("[消息] 候选人:" + targetName + " 内容:" + (reviewContent || "空"));

      // 从人才库查找
      let recId = null;
      let fullName = targetName;
      try {
        const r = await feishu.listRec(BASE_TOKEN, TALENT_TABLE, { viewId: TALENT_VIEW, pageSize: 500 });
        if (r.code === 0 && r.data && r.data.items) {
          for (const rec of r.data.items) {
            const name = (rec.fields && rec.fields[F.name]) || "";
            if (name === targetName || name.includes(targetName)) {
              recId = rec.record_id;
              fullName = name;
              break;
            }
          }
        }
      } catch (e) { console.error("[消息] 查人才库失败:", e.message); }

      if (!recId) {
        console.log("[消息] 未找到:" + targetName);
        const hint = JSON.stringify({text: "未找到【" + targetName + "】，请确认姓名正确"});
        await feishu.sendMsg(chatId, "text", hint);
        return;
      }

      if (!reviewContent) {
        const hint = JSON.stringify({text: "请发送完整格式：" + fullName + " 一面评价：你的评价内容"});
        await feishu.sendMsg(chatId, "text", hint);
        return;
      }

      // 写入一面建议
      const fields = {};
      fields[F.interviewAdvice] = reviewContent;
      console.log("[消息] 写入 记录:" + recId + " 内容:" + reviewContent);
      const res = await feishu.updateRec(BASE_TOKEN, TALENT_TABLE, recId, fields);
      if (res.code === 0) {
        console.log("[消息] 成功");
        const okMsg = JSON.stringify({text: "已为【" + fullName + "】记录一面评价：" + reviewContent});
        await feishu.sendMsg(chatId, "text", okMsg);
      } else {
        console.error("[消息] 失败:", JSON.stringify(res));
      }
      return;
    }

            // 触发面试情况统计（群内@机器人 说"面试情况"）
            if (cleanText.match(/面试情况/) || cleanText.match(/统计面试/) || cleanText.match(/查面试/)) {
              const chatId = message.chat_id;
              if (!chatId) return;
              console.log('[面试情况] 触发统计');
              try {
                const vf=require('./feishu-api');
                const vcard=require('./card-builder');
                const vF=vcard.F2;
                // 找当前群匹配哪个面试官组合
                const vtasks=taskCache;
                let found=false;
                for (const vt of vtasks) {
                  const vtf=vt.fields||{};
                  const vst=Array.isArray(vtf['招聘状态'])?((vtf['招聘状态'][0]&&vtf['招聘状态'][0].name)?vtf['招聘状态'][0].name:String(vtf['招聘状态'][0]||'')):String(vtf['招聘状态']||'');
                  if (vst!=='招聘中') continue;
                  const vb1=Array.isArray(vtf['业务一面'])?vtf['业务一面']:[]; const vh2=Array.isArray(vtf['HR二面'])?vtf['HR二面']:[];
                  const vb1n=vb1.map(x=>x.name).join('、'); const vh2n=vh2.map(x=>x.name).join('、');
                  const vkw=vb1n+'、'+vh2n+'招聘群';
                  const vchat=await vf.findGroup(vkw);
                  if (vchat && vchat.chat_id===chatId) {
                    found=true;
                    const vd2=String(vtf['二级部门']||''); const vd3=String(vtf['三级部门']||''); const vpos=String(vtf['招聘岗位']||''); const vloc=String(vtf['城市']||vtf['招聘城市']||'');
                    const vcnt=Number(vtf['招聘人数'])||1;
                    const vhr=await vf.listAll(BASE_TOKEN,TALENT_TABLE,{viewId:TALENT_VIEW});
                    if (vhr) {
                      let vm=0,vhp=0,ving=0,vfin=0;
                      for (const vr of vhr) {
                        const vf2=vr.fields||{}; const vd22=optName(vf2[vF.dept2]); const vd32=optName(vf2[vF.dept3]); const vpos2=optName(vf2[vF.pos]); const vloc2=vf2[vF.loc]||optName(vf2['所属城市'])||'';
                        let vs=0; if(vd2&&vd22&&vd22.includes(vd2))vs+=3; if(vd3&&vd32&&vd32.includes(vd3))vs+=2; if(vpos&&vpos2&&vpos2.includes(vpos))vs+=3; if(vloc&&vloc2&&vloc2.includes(vloc))vs+=2;
                        if (vs<6) continue; vm++;
                        const vhrv=vf2[vF.hrResult]; const vhrv2=Array.isArray(vhrv)?String(vhrv[0]||''):String(vhrv||''); if(vhrv2==='通过'||vhrv2==='opt3RiKdl0') vhp++;
                        const vbrv=vf2[vF.bizResult]; const vbrv2=Array.isArray(vbrv)?String(vbrv[0]||''):String(vbrv||''); const vbp=vbrv2==='通过'||vbrv2==='optAPC5yjs';
                        const vadv=String(vf2[vF.interviewAdvice]||'').trim();
                        if (vhp && vbp && !vadv) ving++; if (vhp && vbp && vadv) vfin++;
                      }
                      const vmsg='【面试情况统计】 面试官: '+vb1n+'、'+vh2n+' 目标招聘人数: '+vcnt+' HR推送数: '+vhp+' 面试中人数: '+ving+' 面试结束人数: '+vfin;
                      await vf.sendMsg(chatId,'text',JSON.stringify({text:vmsg}));
                      console.log('[面试情况] 已发送到 '+chatId);
                    }
                    break;
                  }
                }
                if (!found) {
                  // 找不到当前群，发所有组合的统计
                  console.log('[面试情况] 未找到当前群对应组合，发全部');
                  for (const vt of vtasks) {
                    const vtf=vt.fields||{};
                    const vst=Array.isArray(vtf['招聘状态'])?((vtf['招聘状态'][0]&&vtf['招聘状态'][0].name)?vtf['招聘状态'][0].name:String(vtf['招聘状态'][0]||'')):String(vtf['招聘状态']||'');
                    if (vst!=='招聘中') continue;
                    const vb1=Array.isArray(vtf['业务一面'])?vtf['业务一面']:[]; const vh2=Array.isArray(vtf['HR二面'])?vtf['HR二面']:[];
                    const vb1n=vb1.map(x=>x.name).join('、'); const vh2n=vh2.map(x=>x.name).join('、');
                    const vkw=vb1n+'、'+vh2n+'招聘群';
                    const vchat=await vf.findGroup(vkw);
                    if (!vchat) continue;
                    const vd2=String(vtf['二级部门']||''); const vd3=String(vtf['三级部门']||''); const vpos=String(vtf['招聘岗位']||''); const vloc=String(vtf['城市']||vtf['招聘城市']||'');
                    const vcnt=Number(vtf['招聘人数'])||1;
                    const vhr=await vf.listAll(BASE_TOKEN,TALENT_TABLE,{viewId:TALENT_VIEW});
                    if (!vhr) continue;
                    let vhp=0,ving=0,vfin=0;
                    for (const vr of vhr) {
                      const vf2=vr.fields||{}; const vd22=optName(vf2[vF.dept2]); const vd32=optName(vf2[vF.dept3]); const vpos2=optName(vf2[vF.pos]); const vloc2=vf2[vF.loc]||optName(vf2['所属城市'])||'';
                      let vs=0; if(vd2&&vd22&&vd22.includes(vd2))vs+=3; if(vd3&&vd32&&vd32.includes(vd3))vs+=2; if(vpos&&vpos2&&vpos2.includes(vpos))vs+=3; if(vloc&&vloc2&&vloc2.includes(vloc))vs+=2;
                      if (vs<6) continue;
                      const vhrv=vf2[vF.hrResult]; const vhrv2=Array.isArray(vhrv)?String(vhrv[0]||''):String(vhrv||''); if(vhrv2==='通过'||vhrv2==='opt3RiKdl0') vhp++;
                      const vbrv=vf2[vF.bizResult]; const vbrv2=Array.isArray(vbrv)?String(vbrv[0]||''):String(vbrv||''); const vbp=vbrv2==='通过'||vbrv2==='optAPC5yjs';
                      const vadv=String(vf2[vF.interviewAdvice]||'').trim();
                      if (vhp && vbp && !vadv) ving++; if (vhp && vbp && vadv) vfin++;
                    }
                    const vmsg='【面试情况统计】 面试官: '+vb1n+'、'+vh2n+' 目标招聘人数: '+vcnt+' HR推送数: '+vhp+' 面试中人数: '+ving+' 面试结束人数: '+vfin;
                    await vf.sendMsg(vchat.chat_id,'text',JSON.stringify({text:vmsg}));
                    console.log('[面试情况] 发送到 '+vchat.name);
                  }
                }
              } catch(e){console.error('[面试情况] 错误:',e.message);}
              return;
            }

// 兼容旧格式: "一面评级:xxx" -> 直接写文本
    const ratingMatch = text.match(/一面评级[：:]?\s*(.+)/);
    if (!ratingMatch) return;
    const rating = ratingMatch[1].trim();
    if (!rating) return;
    console.log("[消息] 一面评级(旧格式): " + rating);
    const chatId = message.chat_id;
    if (!chatId) { console.log("[消息] 无 chat_id"); return; }
    let targetRecId = null;
    for (const [recId, info] of sentCards) {
      if (info.chatId === chatId) targetRecId = recId;
    }
    if (!targetRecId) { console.log("[消息] 当前群无记录"); return; }
    const uf = {}; uf[F.interviewAdvice] = rating;
    console.log("[消息] 写入记录:" + targetRecId + " 内容:" + rating);
    const res = await feishu.updateRec(BASE_TOKEN, TALENT_TABLE, targetRecId, uf);
    if (res.code === 0) console.log("[消息] 写入成功");
    else console.error("[消息] 写入失败:", JSON.stringify(res));
  } catch (e) { console.error("[消息] 错误:", e.message); }
}

// ====== 定时提醒（每天10点和15点）======
async function sendReminders() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const isTime = (h === 10 && m <= 1) || (h === 15 && m <= 1);
  if (!isTime) return;
  console.log("[提醒] " + h + ":00 发送面试提醒...");
  const reminded = new Set();
  for (const task of taskCache) {
    const tf = (task && task.fields) || {};
    const status = Array.isArray(tf["招聘状态"])
      ? ((tf["招聘状态"][0] && tf["招聘状态"][0].name) ? tf["招聘状态"][0].name : String(tf["招聘状态"][0] || ""))
      : String(tf["招聘状态"] || "");
    if (status !== "招聘中") continue;
    const chatId = await findGroupChatId(task);
    if (!chatId || reminded.has(chatId)) continue;
    reminded.add(chatId);

    // 只 @业务一面面试官
    const biz1 = Array.isArray(tf["业务一面"]) ? tf["业务一面"] : [];
    let mentions = "";
    for (const iv of biz1) {
      if (iv && iv.id) mentions += '<at user_id="' + iv.id + '"></at>';
      else if (iv && iv.name) mentions += "@" + iv.name + " ";
    }

    const jobName = tf["招聘岗位"] || "";
    const msgText = mentions + " 【面试提醒】 请及时查看招聘进展。\\n如已面试，请在群内发送：候选人姓名 一面评价：评价内容";
    const msgContent = JSON.stringify({ text: msgText });
    console.log("[提醒] 发送到 " + chatId);
    const r = await feishu.sendMsg(chatId, "text", msgContent);
    if (r.code === 0) console.log("[提醒] 成功");
    else console.error("[提醒] 失败:", r.code, r.msg);
  }
}

// ====== 面试情况监控 ======
async function sendInterviewStats() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  // 每天10:00发一次
  if (h !== 10 || m !== 0) return;
  console.log("[面试监控] 10:00 开始统计面试情况...");

  try {
    // 获取人才库全量数据
    const r = await feishu.listAll(BASE_TOKEN, TALENT_TABLE, { viewId: TALENT_VIEW });
    if (!r || !r.length) { console.log("[面试监控] 人才库为空"); return; }
    console.log("[面试监控] 人才库共 " + r.length + " 条");

    // 按面试官组合分组
    const groups = {}; // key: 组合名称, value: { task, records: [], targetCount, taskCount }

    // 遍历招聘任务，按业务一面+HR二面分组
    for (const task of taskCache) {
      const tf = (task && task.fields) || {};
      const status = Array.isArray(tf["招聘状态"])
        ? ((tf["招聘状态"][0] && tf["招聘状态"][0].name) ? tf["招聘状态"][0].name : String(tf["招聘状态"][0] || ""))
        : String(tf["招聘状态"] || "");
      if (status !== "招聘中") continue;

      // 获取面试官组合
      const biz1 = Array.isArray(tf["业务一面"]) ? tf["业务一面"] : [];
      const hr2 = Array.isArray(tf["HR二面"]) ? tf["HR二面"] : [];
      const fin = Array.isArray(tf["终面"]) ? tf["终面"] : [];
      const biz1Name = biz1.map(x => x.name).join("、");
      const hr2Name = hr2.map(x => x.name).join("、");
      const groupKey = biz1Name + "|" + hr2Name;
      if (!groupKey || groupKey === "|") continue;

      // 目标招聘人数
      const targetCount = Number(tf["招聘人数"]) || 1;

      // 获取该任务的部门/岗位/城市用于筛选人才库
      const td2 = String(tf["二级部门"] || "");
      const td3 = String(tf["三级部门"] || "");
      const tpos = String(tf["招聘岗位"] || "");
      const tloc = String(tf["城市"] || tf["招聘城市"] || "");

      if (!groups[groupKey]) {
        groups[groupKey] = {
          biz1Name, hr2Name,
          tasks: [],
          targetCount: 0,
          dept2: td2, dept3: td3, pos: tpos, loc: tloc
        };
      }
      groups[groupKey].tasks.push(task);
      groups[groupKey].targetCount += targetCount;
    }

    console.log("[面试监控] 面试官组合数: " + Object.keys(groups).length);

    // 对每个组合统计人才库数据
    for (const [key, g] of Object.entries(groups)) {
      // 用任务的部门/岗位/城市筛选人才库
      const groupRecords = [];
      for (const rec of r) {
        const f = rec.fields || {};
        const d2 = optName(f[F.dept2]);
        const d3 = optName(f[F.dept3]);
        const pos = optName(f[F.pos]);
        const loc = f[F.loc] || optName(f[F.belongCity]) || "";

        // 全匹配：部门+岗位+城市必须全部匹配
        const deptOk = (!g.dept2 || (d2 && d2.includes(g.dept2))) && (!g.dept3 || (d3 && d3.includes(g.dept3)));
        const posOk = !g.pos || (pos && pos.includes(g.pos));
        const locOk = !g.loc || (loc && loc.includes(g.loc));
        if (deptOk && posOk && locOk) groupRecords.push(rec);
      }
      g.records = groupRecords;

      // 统计数据
      let hrPassCount = 0; // HR复核=通过
      let interviewingCount = 0; // HR+业务都通过，无一面建议
      let finishedCount = 0; // HR+业务都通过，有建议

      for (const rec of groupRecords) {
        const f = rec.fields || {};
        // HR复核结果: opt3RiKdl0=通过, optI9zbTjc=淘汰
        const hrRaw = f[F.hrResult];
        const hrVal = Array.isArray(hrRaw) ? String(hrRaw[0] || "") : String(hrRaw || "");
        const hrPass = hrVal === "通过" || hrVal === "opt3RiKdl0";

        // 业务复核结果: optAPC5yjs=通过, optJYdXCeR=淘汰
        const bizRaw = f[F.bizResult];
        const bizVal = Array.isArray(bizRaw) ? String(bizRaw[0] || "") : String(bizRaw || "");
        const bizPass = bizVal === "通过" || bizVal === "optAPC5yjs";

        // 一面建议
        const advice = f[F.interviewAdvice] || "";
        const hasAdvice = String(advice).trim().length > 0;

        if (hrPass) hrPassCount++;
        if (hrPass && bizPass && !hasAdvice) interviewingCount++;
        if (hrPass && bizPass && hasAdvice) finishedCount++;
      }

      g.hrPassCount = hrPassCount;
      g.interviewingCount = interviewingCount;
      g.finishedCount = finishedCount;

      console.log("[面试监控] " + g.biz1Name + "+" + g.hr2Name +
        " 目标:" + g.targetCount +
        " HR推送:" + hrPassCount +
        " 面试中:" + interviewingCount +
        " 已结束:" + finishedCount +
        " 匹配记录:" + groupRecords.length);
    }

    // 推送消息到对应群
    for (const [key, g] of Object.entries(groups)) {
      // 构建一个虚拟task用于找群
      const virtTask = { fields: {
        "业务一面": g.biz1Name ? [{ name: g.biz1Name.split("、")[0] }] : [],
        "HR二面": g.hr2Name ? [{ name: g.hr2Name.split("、")[0] }] : []
      }};
      const chatId = await findGroupChatId(virtTask);
      if (!chatId) {
        console.log("[面试监控] 未找到群: " + g.biz1Name + "+" + g.hr2Name);
        continue;
      }

      // 构建统计消息
      const groupName = g.biz1Name + "、" + g.hr2Name;
      const msgText =
        "【面试情况统计】" +
        "\\n面试官: " + groupName +
        "\\n目标招聘人数: " + g.targetCount +
        "\\nHR推送数: " + g.hrPassCount +
        "\\n面试中人数: " + g.interviewingCount +
        "\\n面试结束人数: " + g.finishedCount;

      console.log("[面试监控] 推送到群 " + chatId);
      const res = await feishu.sendMsg(chatId, "text", JSON.stringify({text: msgText}));
      if (res.code === 0) console.log("[面试监控] 成功");
      else console.error("[面试监控] 失败:", res.code, res.msg);
    }

    console.log("[面试监控] 统计完成");
  } catch (e) { console.error("[面试监控] 错误:", e.message); }
}

// ====== 负责人招聘进度汇总 ======
async function sendLeaderSummary() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  if (h !== 10 || m !== 0) return;
  console.log("[负责人统计] 10:00 开始汇总...");
  try {
    const tr = await feishu.listRec(BASE_TOKEN, TASK_TABLE, { viewId: TASK_VIEW, pageSize: 500, automaticFields: true });
    if (tr.code !== 0 || !tr.data || !tr.data.items) return;
    const talent = await feishu.listAll(BASE_TOKEN, TALENT_TABLE, { viewId: TALENT_VIEW });
    if (!talent || !talent.length) { console.log("[负责人统计] 人才库为空"); return; }

    // 按负责人分组
    var pmap = {};
    for (var task of tr.data.items) {
      var tf = (task && task.fields) || {};
      var st = Array.isArray(tf["招聘状态"]) ? ((tf["招聘状态"][0] && tf["招聘状态"][0].name) ? tf["招聘状态"][0].name : String(tf["招聘状态"][0] || "")) : String(tf["招聘状态"] || "");
      if (st !== "招聘中") continue;
      var ppl = Array.isArray(tf["负责人"]) ? tf["负责人"] : [];
      for (var p of ppl) {
        if (!p || !p.id) continue;
        if (!pmap[p.id]) pmap[p.id] = { name: p.name || p.id, tasks: [] };
        pmap[p.id].tasks.push(task);
      }
    }
    console.log("[负责人统计] 负责人数: " + Object.keys(pmap).length);

    for (var pid in pmap) {
      var pers = pmap[pid];
      var lines = ["【负责人招聘进度汇总】", "负责人: " + pers.name, ""];

      // 按面试官组合分组
      var combos = {};
      for (var task of pers.tasks) {
        var tf = (task && task.fields) || {};
        var b1 = Array.isArray(tf["业务一面"]) ? tf["业务一面"] : [];
        var h2 = Array.isArray(tf["HR二面"]) ? tf["HR二面"] : [];
        var fn = Array.isArray(tf["终面"]) ? tf["终面"] : [];
        var ids = []; var ns = [];
        function collect(arr) { for (var x of arr) { if (x && x.id) ids.push(x.id); if (x && x.name) ns.push(x.name); } }
        collect(b1); collect(h2); collect(fn);
        if (ids.length === 0) continue;
        var key = ids.slice().sort().join(",");
        if (!combos[key]) combos[key] = { names: ns, target: 0, tasks: [] };
        combos[key].target += Number(tf["招聘人数"]) || 1;
        combos[key].tasks.push(task);
      }

      for (var k in combos) {
        var c = combos[k];
        var t0 = c.tasks[0];
        if (!t0) continue;
        var t0f = t0.fields || {};
        var td2 = String(t0f["二级部门"] || "");
        var td3 = String(t0f["三级部门"] || "");
        var tpos = String(t0f["招聘岗位"] || "");
        var tloc = String(t0f["城市"] || "");

        var hp = 0, ing = 0;
        for (var rec of talent) {
          var f = rec.fields || {};
          var d2 = optName(f[F.dept2]);
          var d3 = optName(f[F.dept3]);
          var pos = optName(f[F.pos]);
          var loc = f[F.loc] || optName(f[F.belongCity]) || "";
          var deptOk = (!td2 || (d2 && d2.includes(td2))) && (!td3 || (d3 && d3.includes(td3)));
          var posOk = !tpos || (pos && pos.includes(tpos));
          var locOk = !tloc || (loc && loc.includes(tloc));
          if (!deptOk || !posOk || !locOk) continue;

          var hr = Array.isArray(f[F.hrResult]) ? String(f[F.hrResult][0] || "") : String(f[F.hrResult] || "");
          var bp = Array.isArray(f[F.bizResult]) ? String(f[F.bizResult][0] || "") : String(f[F.bizResult] || "");
          var adv = String(f[F.interviewAdvice] || "").trim();
          if (hr === "通过" || hr === "opt3RiKdl0") hp++;
          if ((hr === "通过" || hr === "opt3RiKdl0") && (bp === "通过" || bp === "optAPC5yjs") && !adv) ing++;
        }

        var gn = c.names.join("、") || "未命名";
        lines.push("---");
        lines.push("群: " + gn);
        lines.push("目标招聘人数: " + c.target);
        lines.push("已推送简历: " + hp);
        lines.push("HR未面试: " + ing);
      }

      if (lines.length <= 2) continue;
      var msg = lines.join("\n");
      console.log("[负责人统计] 发给 " + pers.name);
      var res = await feishu.sendPersonalMsg(pid, "text", JSON.stringify({text: msg}));
      if (res.code === 0) console.log("[负责人统计] 成功");
      else console.error("[负责人统计] 失败:", res.code, res.msg);
    }
    console.log("[负责人统计] 全部完成");
  } catch (e) { console.error("[负责人统计] 错误:", e.message); }
}

async function main() {
  await init();
  const ed = new lark.EventDispatcher({}).register({
    "card.action.trigger": async (data) => {
      try { return await handleCardAction(data); }
      catch (e) { console.error("[卡片回调] 错误:", e.message); return null; }
    },
    "im.message.receive_v1": async (data) => {
      try {
        const event = (data && data.event) || data;
        if (event && event.message && event.message.message_type === "text") await handleMessage(event);
      } catch (e) { console.error("[消息] 错误:", e.message); }
      return {};
    }
  });
  console.log("[启动] 事件: " + [...ed.handles.keys()].join(", "));
  const ws = new lark.WSClient({ appId: APP_ID, appSecret: APP_SECRET, loggerLevel: lark.LoggerLevel.info });
  ws.start({ eventDispatcher: ed });
  console.log("[启动] 长连接已启动");
  setTimeout(() => check(), 10000);
  setInterval(() => check(), INTERVAL * 1000);
  setInterval(() => refreshTasks(), 3600000);
  setTimeout(() => autoCreateGroup(), 30000);
  setInterval(() => autoCreateGroup(), 600000);
  setInterval(() => sendReminders(), 60000);
  setInterval(() => sendInterviewStats(), 60000);
  setInterval(() => sendLeaderSummary(), 60000);
  console.log("[启动] 监控每 " + INTERVAL + " 秒");
  console.log("[启动] 提醒: 每天10:00和15:00");
  console.log("[启动] 面试监控: 每天10:00");
  console.log("[启动] 自动建群: 每10分钟检查一次");
  console.log("[启动] 一面评价: @机器人 发送 '一面评价' 弹出卡片填写");
}

process.on("uncaughtException", e => console.error("[异常]", e.message));
process.on("unhandledRejection", e => console.error("[未处理]", e.message));
main().catch(e => { console.error("[致命]", e); process.exit(1); });
