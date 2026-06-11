const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 12000;

function resolveCodexPath() {
  const candidates = [
    process.env.CODEX_CLI_PATH,
    path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin", "codex.exe"),
    ...findNestedCodexBins()
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "codex";
}

function findNestedCodexBins() {
  const binDir = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  if (!fs.existsSync(binDir)) return [];

  const results = [];
  for (const entry of fs.readdirSync(binDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    results.push(path.join(binDir, entry.name, "codex.exe"));
  }
  return results;
}

async function getQuota() {
  const response = await requestRateLimits();
  const snapshot =
    response.rateLimitsByLimitId?.codex ||
    response.rateLimits ||
    firstSnapshot(response.rateLimitsByLimitId);

  if (!snapshot) {
    throw new Error("Codex 未返回额度信息。");
  }

  return normalizeSnapshot(snapshot);
}

function firstSnapshot(map) {
  if (!map || typeof map !== "object") return null;
  const firstKey = Object.keys(map)[0];
  return firstKey ? map[firstKey] : null;
}

function normalizeSnapshot(snapshot) {
  const windows = [snapshot.primary, snapshot.secondary]
    .filter(Boolean)
    .map((quotaWindow, index) => normalizeWindow(quotaWindow, index));

  return {
    limitId: snapshot.limitId || "codex",
    limitName: snapshot.limitName || "Codex",
    planType: snapshot.planType || "unknown",
    reachedType: snapshot.rateLimitReachedType || null,
    credits: snapshot.credits || null,
    windows,
    fetchedAt: new Date().toISOString()
  };
}

function normalizeWindow(quotaWindow, index) {
  const usedPercent = clampPercent(Number(quotaWindow.usedPercent || 0));
  const duration = quotaWindow.windowDurationMins ?? null;

  return {
    id: index === 0 ? "primary" : "secondary",
    label: formatWindowLabel(duration, index),
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowDurationMins: duration,
    resetsAt: quotaWindow.resetsAt ? new Date(quotaWindow.resetsAt * 1000).toISOString() : null
  };
}

function formatWindowLabel(minutes, index) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return index === 0 ? "主窗口" : "次窗口";
  if (value < 60) return `${value}M`;
  if (value % 10080 === 0) return `${value / 10080}W`;
  if (value % 1440 === 0) return `${value / 1440}D`;
  if (value % 60 === 0) return `${value / 60}H`;
  return `${value}M`;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function requestRateLimits() {
  const codexPath = resolveCodexPath();
  const child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  const cleanup = () => {
    for (const request of pending.values()) clearTimeout(request.timer);
    pending.clear();
    if (!child.killed) child.kill();
  };

  const send = (method, params) => {
    const id = nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex 请求超时：${method}`));
      }, DEFAULT_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) handleMessage(line, pending);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });

    child.once("exit", (code) => {
      if (pending.size > 0) {
        cleanup();
        reject(new Error(stderr || `Codex app-server 已退出，代码 ${code}`));
      }
    });

    (async () => {
      try {
        await send("initialize", {
          clientInfo: {
            name: "codex-quota-bubble",
            title: "Codex Quota Bubble",
            version: "0.1.0"
          },
          capabilities: null
        });
        const result = await send("account/rateLimits/read");
        cleanup();
        resolve(result);
      } catch (error) {
        cleanup();
        reject(new Error(stderr || error.message));
      }
    })();
  });
}

function handleMessage(line, pending) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  const request = pending.get(message.id);
  if (!request) return;

  clearTimeout(request.timer);
  pending.delete(message.id);

  if (message.error) {
    request.reject(new Error(message.error.message || JSON.stringify(message.error)));
  } else {
    request.resolve(message.result);
  }
}

module.exports = { getQuota, resolveCodexPath };
