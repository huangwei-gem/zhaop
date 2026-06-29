// 飞书简历评审交互卡片 v2.1
const F2 = {
  name:"姓名", dept2:"二级部门", dept3:"三级部门", pos:"招聘岗位", interviewPos:"面试岗位", loc:"城市",
  aiResult:"AI简历初筛结果", aiEval:"AI简历评估", aiMatch:"岗位能力维度匹配",
  aiStrength:"优势分析", aiRisk:"风险点", aiTips:"面试问题建议",
  hrResult:"HR复核结果", bizResult:"业务复核结果（🟢业务简历筛选结果选择点这里，其他部分都不要填写，这里简历初筛通过的人员将进入面试）", interviewAdvice:"一面建议"
};

function build(rec, task) {
  const f = rec.fields || {};
  const n = f[F2.name] || "未知";
  const rid = rec.record_id;
  const e = [];
  const add = (t) => e.push({ tag:"div", text:{ tag:"lark_md", content:t } });
  const hr = () => e.push({ tag:"hr" });

  // 面试官信息
  if (task && task.fields) {
    const hr2 = task.fields["HR二面"];
    const biz1 = task.fields["业务一面"];
    const fin = task.fields["终面"];
    const names = [];
    if (Array.isArray(hr2)) hr2.forEach(x => { if(x && x.name) names.push(x.name); });
    if (Array.isArray(biz1)) biz1.forEach(x => { if(x && x.name) names.push(x.name); });
    if (Array.isArray(fin)) fin.forEach(x => { if(x && x.name) names.push(x.name); });
    if (names.length) add("**面试官：**" + names.join("、"));
  }

    // 面试岗位
  const interviewPos = module.exports.optName ? module.exports.optName(f[F2.interviewPos]) : (f[F2.interviewPos] || "");
  const ipVal = Array.isArray(interviewPos) ? interviewPos.join(",") : interviewPos;

  // 招聘岗位
  const pos = module.exports.optName ? module.exports.optName(f[F2.pos]) : (Array.isArray(f[F2.pos]) ? f[F2.pos].join(",") : (f[F2.pos] || ""));

  // 头部说明
  add("以下为候选人的 **" + n + "** 岗位匹配依据以及风险点，AI 生成，仅供参考。\n\n**面试岗位：** " + (ipVal || "无") + " | **招聘岗位：** " + (pos || "无"));
  hr();

  hr();

  // ✅岗位匹配依据
  add("**✅岗位匹配依据**\n" + (f[F2.aiMatch] || "暂无"));

  // ⚠️风险点
  add("**⚠️风险点**\n" + (f[F2.aiRisk] || "暂无"));

  hr();

  // 业务复核
  add("**业务复核**");
  e.push({ tag:"action", actions:[
    { tag:"button", text:{ tag:"plain_text", content:"通过" }, type:"primary",
      value:{ action:"biz_review", result:"pass", record_id:rid, name:n } },
    { tag:"button", text:{ tag:"plain_text", content:"淘汰" }, type:"danger",
      value:{ action:"biz_review", result:"reject", record_id:rid, name:n } }
  ]});
  e.push({ tag:"note", elements:[{ tag:"plain_text",
    content:new Date().toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}) + " | ID:" + rid }] });
  return { config:{ wide_screen_mode:true, update_multi:true },
    header:{ template:"indigo", title:{ tag:"plain_text", content:n + " - 岗位匹配评估" } }, elements:e };
}
function doneCard(name, result, reviewer) {
  const typeName = "业务复核";
  const resultText = result === "pass" ? "已通过" : "已淘汰";
  const tmpl = result === "pass" ? "green" : "red";
  return { config:{ wide_screen_mode:true, update_multi:true },
    header:{ template:tmpl, title:{ tag:"plain_text", content:name + " - 简历评审" } },
    elements:[{ tag:"div", text:{ tag:"lark_md",
      content:"**" + typeName + "已完成**\n候选人:" + name + "\n结果:**" + resultText + "**\n操作人:" + reviewer } }] };
}

// 一面评价填写卡片
// 一面评价填写卡片 - 按钮选择方案
// 一面评价填写卡片 - Input组件版本
// 第一步：评价选择卡片（纯按钮）
function interviewReviewCard(recordId, name, interviewerName) {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: "blue", title: { tag: "plain_text", content: "一面评价 - " + name } },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: "请为候选人 **" + name + "** 选择一面评价：" } },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "**评价等级**" } },
      { tag: "action", actions: [
        { tag: "button", text: { tag: "plain_text", content: "优秀" }, type: "primary",
          value: { action: "interview_ask_reason", rating: "优秀", record_id: recordId, name: name } },
        { tag: "button", text: { tag: "plain_text", content: "良好" }, type: "primary",
          value: { action: "interview_ask_reason", rating: "良好", record_id: recordId, name: name } }
      ]},
      { tag: "action", actions: [
        { tag: "button", text: { tag: "plain_text", content: "一般" }, type: "default",
          value: { action: "interview_ask_reason", rating: "一般", record_id: recordId, name: name } },
        { tag: "button", text: { tag: "plain_text", content: "较差" }, type: "danger",
          value: { action: "interview_ask_reason", rating: "较差", record_id: recordId, name: name } }
      ]},
      { tag: "note", elements: [{ tag: "plain_text", content: "选择评价等级后进入第二步填写原因" }] }
    ]
  };
}

// 第二步：原因选择卡片
function interviewAskReasonCard(recordId, name, rating) {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: "blue", title: { tag: "plain_text", content: "填写原因 - " + name } },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: "候选人: **" + name + "**    评价: **" + rating + "**" } },
      { tag: "hr" },
      { tag: "div", text: { tag: "lark_md", content: "请选择原因/理由：" } },
      { tag: "action", actions: [
        { tag: "button", text: { tag: "plain_text", content: "很优秀，岗位匹配度高" }, type: "primary",
          value: { action: "interview_submit", rating: rating, reason: "很优秀，岗位匹配度高", record_id: recordId, name: name } },
        { tag: "button", text: { tag: "plain_text", content: "能力达标，有潜力" }, type: "primary",
          value: { action: "interview_submit", rating: rating, reason: "能力达标，有潜力", record_id: recordId, name: name } }
      ]},
      { tag: "action", actions: [
        { tag: "button", text: { tag: "plain_text", content: "经验稍欠缺，可培养" }, type: "default",
          value: { action: "interview_submit", rating: rating, reason: "经验稍欠缺，可培养", record_id: recordId, name: name } },
        { tag: "button", text: { tag: "plain_text", content: "不合适，不匹配" }, type: "danger",
          value: { action: "interview_submit", rating: rating, reason: "不合适，不匹配", record_id: recordId, name: name } }
      ]},
      { tag: "action", actions: [
        { tag: "button", text: { tag: "plain_text", content: "自定义原因" }, type: "default",
          value: { action: "interview_custom_reason", rating: rating, record_id: recordId, name: name } }
      ]}
    ]
  };
}

// 完成卡片
function interviewReviewDoneCard(name, rating, reason) {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: "green", title: { tag: "plain_text", content: "一面评价已提交 - " + name } },
    elements: [
      { tag: "div", text: { tag: "lark_md",
        content: "**一面评价已提交**\\n候选人: " + name + "\\n评价: **" + rating + "**\\n原因: " + (reason || "无") } },
    ]
  };
}
function interviewReviewDoneCard(name, rating, reason) {
  return { config:{ wide_screen_mode:true, update_multi:true },
    header:{ template:"green", title:{ tag:"plain_text", content:"一面评价已提交 - " + name } },
    elements:[
      { tag:"div", text:{ tag:"lark_md",
        content:"**一面评价已提交**\n候选人:" + name + "\n评价:**" + rating + "**\n原因:" + (reason || "无") } },
    ]
  };
}
module.exports = { build, doneCard, interviewReviewCard, interviewAskReasonCard, interviewReviewDoneCard, F2, optName: null };
