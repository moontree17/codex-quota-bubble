const quotaList = document.getElementById("quotaList");

window.quotaApp.onQuota(renderPayload);
window.quotaApp.getQuota();

function renderPayload(payload) {
  if (!payload?.ok) {
    quotaList.innerHTML = `<div class="status">${escapeHtml(shortError(payload?.error))}</div>`;
    return;
  }

  const windows = payload.quota?.windows || [];
  if (!windows.length) {
    quotaList.innerHTML = `<div class="status">无额度信息</div>`;
    return;
  }

  quotaList.innerHTML = "";
  for (const item of windows.slice(0, 2)) {
    quotaList.appendChild(createQuotaRow(item));
  }
}

function createQuotaRow(item) {
  const row = document.createElement("div");
  row.className = "quota-row";
  row.title = `剩余 ${item.remainingPercent}% · 已用 ${item.usedPercent}% · 重置 ${formatResetDetail(item.resetsAt)}`;

  const dot = document.createElement("div");
  dot.className = "dot";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = item.label;

  const reset = document.createElement("div");
  reset.className = "reset";
  reset.textContent = formatResetBrief(item.resetsAt);

  const percent = document.createElement("div");
  percent.className = `percent ${item.remainingPercent < 10 ? "danger" : item.remainingPercent < 50 ? "warn" : ""}`;
  percent.textContent = `${item.remainingPercent}%`;

  row.append(dot, label, reset, percent);
  return row;
}

function formatResetBrief(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  const now = new Date();
  const sameDate =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDate) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function formatResetDetail(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function shortError(error) {
  const text = String(error || "读取失败");
  if (text.includes("EPERM")) return "启动 Codex 失败";
  if (text.length > 18) return `${text.slice(0, 18)}...`;
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
