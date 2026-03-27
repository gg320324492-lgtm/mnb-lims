require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const db = require("./data/mockDb");
const mysqlStore = require("./data/mysqlStore");

const app = express();
const port = process.env.PORT || 3000;
const adminPath = path.resolve(__dirname, "../../admin");
const miniappPath = path.resolve(__dirname, "../../miniapp");

const corsOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const isProdLike = ["production", "staging"].includes(String(process.env.NODE_ENV || "").toLowerCase());
const corsAllowAll = String(process.env.CORS_ALLOW_ALL || "").toLowerCase() === "true";
const useStrictCors = isProdLike && !corsAllowAll;

const corsOptions = {
  origin(origin, callback) {
    if (corsAllowAll) {
      callback(null, true);
      return;
    }

    // 非浏览器请求（如 curl / 健康探针）默认放行
    if (!origin) {
      callback(null, true);
      return;
    }

    if (corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS origin not allowed"));
  }
};

app.use((req, res, next) => {
  req.requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
  const traceHeader = String(req.headers["x-trace-id"] || req.requestId);
  req.traceId = traceHeader;
  res.setHeader("x-request-id", req.requestId);
  res.setHeader("x-trace-id", req.traceId);
  next();
});

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

const authRateWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000);
const authRateLimit = Number(process.env.AUTH_RATE_LIMIT_MAX || 30);
const authRateLimiter = rateLimit({
  windowMs: authRateWindowMs,
  limit: authRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`,
  handler(req, res) {
    return res.status(429).json({ code: 429, message: "请求过于频繁，请稍后重试" });
  }
});

app.use(cors(useStrictCors ? corsOptions : {}));
app.use(express.json());
app.use(
  morgan((tokens, req, res) =>
    JSON.stringify({
      ts: new Date().toISOString(),
      type: "http_access",
      requestId: req.requestId || "",
      traceId: req.traceId || "",
      userId: req.user ? Number(req.user.id) : null,
      role: req.user ? req.user.role : null,
      authReason: req.authReason || null,
      method: tokens.method(req, res),
      path: tokens.url(req, res),
      status: Number(tokens.status(req, res) || 0),
      contentLength: Number(tokens.res(req, res, "content-length") || 0),
      responseTimeMs: Number(tokens["response-time"](req, res) || 0),
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
      origin: req.headers.origin || ""
    })
  )
);
app.use("/admin", express.static(adminPath));
app.use("/miniapp", express.static(miniappPath));

const roleAlias = {
  super_admin: "admin",
  admin: "admin",
  teacher: "teacher",
  student: "student"
};

const accessTokenTtl = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const refreshTokenTtl = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET || "dev-access-secret";
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";

const refreshTokenStore = new Map();
const loginAttemptStore = new Map();
const refreshAttemptStore = new Map();

const allowUserIdLogin = String(process.env.AUTH_ALLOW_USER_ID_LOGIN || "true").toLowerCase() === "true";
const loginFailWindowMs = Number(process.env.AUTH_FAIL_WINDOW_MS || 10 * 60_000);
const loginFailMax = Number(process.env.AUTH_FAIL_MAX || 5);
const loginFailBlockMs = Number(process.env.AUTH_FAIL_BLOCK_MS || 15 * 60_000);
const refreshRateWindowMs = Number(process.env.AUTH_REFRESH_RATE_LIMIT_WINDOW_MS || 60_000);
const refreshRateMax = Number(process.env.AUTH_REFRESH_RATE_LIMIT_MAX || 20);

function normalizeRole(role) {
  return roleAlias[String(role || "").trim()] || "student";
}

function isUserEnabled(value) {
  if (value === false) return false;
  if (value === 0) return false;
  if (String(value) === "0") return false;
  return true;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id),
    name: user.name,
    account: user.account || "",
    ssoProvider: user.ssoProvider || "",
    ssoSubject: user.ssoSubject || "",
    role: normalizeRole(user.role),
    rawRole: user.role,
    enabled: isUserEnabled(user.enabled),
    roleUpdatedAt: user.roleUpdatedAt || null,
    phone: user.phone || ""
  };
}

function toLoginType(payload) {
  const explicit = String((payload && payload.loginType) || "").trim();
  if (["password", "sso", "userId", "wechat"].includes(explicit)) {
    return explicit;
  }

  if (payload && payload.account && payload.password) {
    return "password";
  }
  if (payload && payload.ssoProvider && payload.ssoSubject) {
    return "sso";
  }
  if (payload && payload.wxCode) {
    return "wechat";
  }
  return "userId";
}

function normalizeRoleInput(role) {
  const value = String(role || "").trim().toLowerCase();
  if (!value) return null;

  const allowMap = {
    super_admin: "super_admin",
    admin: "admin",
    teacher: "teacher",
    student: "student"
  };
  return allowMap[value] || null;
}

function buildRoleChangedNotice(user, tokenRole) {
  const latestRole = normalizeRole(user && user.role);
  if (!latestRole || !tokenRole) return null;
  if (latestRole === normalizeRole(tokenRole)) return null;
  return {
    type: "ROLE_CHANGED",
    message: `检测到账号角色已变更（${tokenRole} -> ${latestRole}），请重新登录`,
    fromRole: tokenRole,
    toRole: latestRole
  };
}

function buildAuthNoticeFromUser(user) {
  if (!user) return [];
  const notices = [];
  if (user.enabled === false) {
    notices.push({
      type: "ACCOUNT_DISABLED",
      message: "账号已被禁用，请联系管理员"
    });
  }
  return notices;
}

function buildOperationLogPayload(base) {
  return {
    id: db.nextId(db.operationLogs),
    type: String(base.type || "UNKNOWN"),
    targetUserId: Number(base.targetUserId || 0),
    targetUserName: String(base.targetUserName || ""),
    beforeRole: base.beforeRole || null,
    afterRole: base.afterRole || null,
    beforeEnabled: typeof base.beforeEnabled === "boolean" ? base.beforeEnabled : null,
    afterEnabled: typeof base.afterEnabled === "boolean" ? base.afterEnabled : null,
    message: String(base.message || ""),
    operatorId: base.audit ? Number(base.audit.operatorId || 0) : null,
    operatorName: String(base.operatorName || ""),
    operatorRole: base.audit ? String(base.audit.operatorRole || "") : "",
    requestId: base.audit ? String(base.audit.requestId || "") : "",
    traceId: base.audit ? String(base.audit.traceId || "") : "",
    source: base.audit ? String(base.audit.source || "") : "",
    ip: base.audit ? String(base.audit.ip || "") : "",
    createdAt: new Date().toISOString()
  };
}

async function createOperationLog(payload) {
  if (mysqlStore.useMySql) {
    return mysqlStore.createOperationLog(payload);
  }
  const row = buildOperationLogPayload(payload);
  db.operationLogs.push(row);
  return row;
}

function mapUserActionType(beforeEnabled, afterEnabled) {
  if (beforeEnabled === true && afterEnabled === false) return "ACCOUNT_DISABLED";
  if (beforeEnabled === false && afterEnabled === true) return "ACCOUNT_ENABLED";
  return "ACCOUNT_STATUS_UPDATED";
}

function buildRoleChangedMessage(beforeRole, afterRole) {
  return `角色变更：${beforeRole || "unknown"} -> ${afterRole || "unknown"}`;
}

function verifyUserPassword(user, password) {
  return String(user && user.password || "") === String(password || "");
}

async function findUserByAccount(account) {
  const acc = String(account || "").trim();
  if (!acc) return null;

  if (mysqlStore.useMySql) {
    const user = await mysqlStore.getUserByAccount(acc);
    return user || null;
  }

  return db.users.find((item) => String(item.account || "") === acc) || null;
}

async function findUserBySso(ssoProvider, ssoSubject) {
  const provider = String(ssoProvider || "").trim();
  const subject = String(ssoSubject || "").trim();
  if (!provider || !subject) return null;

  if (mysqlStore.useMySql) {
    const user = await mysqlStore.getUserBySso(provider, subject);
    return user || null;
  }

  return (
    db.users.find(
      (item) =>
        String(item.ssoProvider || "") === provider &&
        String(item.ssoSubject || "") === subject
    ) || null
  );
}

function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
      name: user.name,
      type: "access"
    },
    jwtAccessSecret,
    { expiresIn: accessTokenTtl }
  );
}

function issueRefreshToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
      type: "refresh"
    },
    jwtRefreshSecret,
    { expiresIn: refreshTokenTtl }
  );
}

function setRefreshToken(token, user) {
  const payload = jwt.decode(token);
  if (!payload || !payload.exp) return;
  refreshTokenStore.set(token, {
    user,
    expMs: Number(payload.exp) * 1000
  });
}

function purgeExpiredRefreshTokens() {
  const now = Date.now();
  for (const [token, record] of refreshTokenStore.entries()) {
    if (!record || Number(record.expMs) <= now) {
      refreshTokenStore.delete(token);
    }
  }
}

function getAuthIdentifier(payload = {}) {
  const loginType = toLoginType(payload);
  if (loginType === "password") {
    return `account:${String(payload.account || "").trim().toLowerCase()}`;
  }
  if (loginType === "sso") {
    return `sso:${String(payload.ssoProvider || "").trim().toLowerCase()}:${String(payload.ssoSubject || "").trim().toLowerCase()}`;
  }
  if (loginType === "userId") {
    return `userId:${Number(payload.userId || 0) || 0}`;
  }
  return "unknown";
}

function getLoginAttemptKey(req, payload = {}) {
  const ip = String(req.ip || "unknown");
  return `${ip}:${getAuthIdentifier(payload)}`;
}

function getRefreshAttemptKey(req, payload = {}) {
  const ip = String(req.ip || "unknown");
  const token = String(payload.refreshToken || "").trim();
  return `${ip}:${token ? token.slice(0, 18) : "no-token"}`;
}

function getRemainingBlockSeconds(blockUntilMs) {
  const remainMs = Number(blockUntilMs || 0) - Date.now();
  if (remainMs <= 0) return 0;
  return Math.ceil(remainMs / 1000);
}

function takeAttempt(store, key, options = {}) {
  const now = Date.now();
  const windowMs = Number(options.windowMs || 60_000);
  const maxFails = Number(options.maxFails || 5);
  const blockMs = Number(options.blockMs || 5 * 60_000);

  const prev = store.get(key) || { count: 0, firstAt: now, blockUntilMs: 0 };
  if (Number(prev.blockUntilMs) > now) {
    return {
      blocked: true,
      blockUntilMs: Number(prev.blockUntilMs),
      count: Number(prev.count || 0)
    };
  }

  if (now - Number(prev.firstAt || now) > windowMs) {
    const reset = { count: 0, firstAt: now, blockUntilMs: 0 };
    store.set(key, reset);
    return { blocked: false, blockUntilMs: 0, count: 0 };
  }

  store.set(key, prev);
  return { blocked: false, blockUntilMs: 0, count: Number(prev.count || 0) };
}

function markAttemptFailure(store, key, options = {}) {
  const now = Date.now();
  const windowMs = Number(options.windowMs || 60_000);
  const maxFails = Number(options.maxFails || 5);
  const blockMs = Number(options.blockMs || 5 * 60_000);

  const prev = store.get(key) || { count: 0, firstAt: now, blockUntilMs: 0 };
  const inWindow = now - Number(prev.firstAt || now) <= windowMs;
  const nextCount = inWindow ? Number(prev.count || 0) + 1 : 1;
  const firstAt = inWindow ? Number(prev.firstAt || now) : now;
  const next = {
    count: nextCount,
    firstAt,
    blockUntilMs: nextCount >= maxFails ? now + blockMs : 0
  };

  store.set(key, next);
  return next;
}

function clearAttemptRecord(store, key) {
  store.delete(key);
}

function purgeExpiredAttempts() {
  const now = Date.now();
  const all = [loginAttemptStore, refreshAttemptStore];
  all.forEach((store) => {
    for (const [key, value] of store.entries()) {
      const blockUntilMs = Number(value && value.blockUntilMs || 0);
      const firstAt = Number(value && value.firstAt || 0);
      const count = Number(value && value.count || 0);
      if (blockUntilMs > 0 && blockUntilMs > now) {
        continue;
      }
      if (count <= 0 || now - firstAt > loginFailWindowMs * 2) {
        store.delete(key);
      }
    }
  });
}

async function findUserById(userId) {
  const id = Number(userId);
  if (!id) return null;

  if (mysqlStore.useMySql) {
    const user = await mysqlStore.getUserById(id);
    return sanitizeUser(user);
  }

  const user = db.users.find((item) => Number(item.id) === id) || null;
  return sanitizeUser(user);
}

async function authenticateUser(payload) {
  const loginType = toLoginType(payload);

  if (loginType === "userId") {
    if (!allowUserIdLogin) {
      return { errorType: "forbidden", message: "当前环境不允许 userId 登录" };
    }
    const userId = Number(payload.userId);
    if (!userId) {
      return { errorType: "bad_request", message: "userId 不能为空" };
    }
    const user = await findUserById(userId);
    if (!user) {
      return { errorType: "not_found", message: "用户不存在" };
    }
    return { user, loginType };
  }

  if (loginType === "password") {
    const account = String(payload.account || "").trim();
    const password = String(payload.password || "");
    if (!account || !password) {
      return { errorType: "bad_request", message: "account 和 password 不能为空" };
    }

    const rawUser = await findUserByAccount(account);
    if (!rawUser) {
      return { errorType: "not_found", message: "账号不存在" };
    }
    if (!verifyUserPassword(rawUser, password)) {
      return { errorType: "forbidden", message: "账号或密码错误" };
    }

    return { user: sanitizeUser(rawUser), loginType };
  }

  if (loginType === "sso") {
    const ssoProvider = String(payload.ssoProvider || "").trim();
    const ssoSubject = String(payload.ssoSubject || "").trim();
    if (!ssoProvider || !ssoSubject) {
      return { errorType: "bad_request", message: "ssoProvider 和 ssoSubject 不能为空" };
    }

    const rawUser = await findUserBySso(ssoProvider, ssoSubject);
    if (!rawUser) {
      return { errorType: "not_found", message: "SSO 账号不存在" };
    }

    return { user: sanitizeUser(rawUser), loginType };
  }

  if (loginType === "wechat") {
    const wxCode = String(payload.wxCode || "").trim();
    if (!wxCode) {
      return { errorType: "bad_request", message: "wxCode 不能为空" };
    }

    // 尝试通过微信 code2Session 换取 openid
    const wxAppId = process.env.WX_APPID || "";
    const wxAppSecret = process.env.WX_APP_SECRET || "";
    let openid = null;

    if (wxAppId && wxAppSecret) {
      try {
        const https = require("https");
        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(wxAppId)}&secret=${encodeURIComponent(wxAppSecret)}&js_code=${encodeURIComponent(wxCode)}&grant_type=authorization_code`;
        openid = await new Promise((resolve, reject) => {
          https.get(url, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              try {
                const json = JSON.parse(data);
                if (json.openid) resolve(json.openid);
                else reject(new Error(json.errmsg || "获取 openid 失败"));
              } catch (e) { reject(e); }
            });
          }).on("error", reject);
        });
      } catch (err) {
        return { errorType: "bad_request", message: `微信登录失败：${err.message}` };
      }
    } else {
      // 开发/测试模式：wxCode 直接当 openid 使用
      openid = wxCode;
    }

    // 查找或自动创建绑定了该 openid 的用户
    const rawUser = await findUserBySso("wechat", openid);
    if (!rawUser) {
      if (mysqlStore.useMySql) {
        // MySQL 模式下需管理员预先绑定微信 openid，不自动注册
        return { errorType: "not_found", message: `微信账号未绑定，请联系管理员绑定 openid（${openid}）` };
      }
      // mockDb 模式：自动注册 student 角色新用户
      const newUser = {
        id: db.nextId(db.users),
        name: `微信用户_${openid.slice(-6)}`,
        account: `wx_${openid.slice(-8)}`,
        ssoProvider: "wechat",
        ssoSubject: openid,
        role: "student",
        enabled: true,
        roleUpdatedAt: new Date().toISOString()
      };
      db.users.push(newUser);
      return { user: sanitizeUser(newUser), loginType, isNewUser: true };
    }

    return { user: sanitizeUser(rawUser), loginType };
  }

  return { errorType: "bad_request", message: "不支持的登录类型" };
}

async function resolveRequestUser(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return { user: null, reason: "NO_TOKEN" };
  }

  const token = header.slice(7).trim();
  if (!token) return { user: null, reason: "NO_TOKEN" };

  try {
    const payload = jwt.verify(token, jwtAccessSecret);
    if (payload.type !== "access") return { user: null, reason: "INVALID_TOKEN" };
    const user = await findUserById(payload.sub);
    if (!user) return { user: null, reason: "USER_NOT_FOUND" };
    if (user.enabled === false) return { user: null, reason: "ACCOUNT_DISABLED" };

    const roleNotice = buildRoleChangedNotice(user, payload.role);
    if (roleNotice) {
      return { user: null, reason: "ROLE_CHANGED", notice: roleNotice };
    }

    return { user, reason: null };
  } catch (err) {
    return { user: null, reason: "INVALID_TOKEN" };
  }
}

async function requireAuth(req, res, next) {
  const result = await resolveRequestUser(req);
  if (!result.user) {
    if (result.reason === "ACCOUNT_DISABLED") {
      return res.status(401).json({
        code: 401,
        message: "账号已被禁用，请重新登录",
        data: { notices: [{ type: "ACCOUNT_DISABLED", message: "账号已被禁用" }] }
      });
    }
    if (result.reason === "ROLE_CHANGED") {
      return res.status(401).json({
        code: 401,
        message: "账号角色已变更，请重新登录",
        data: { notices: [result.notice] }
      });
    }
    return res.status(401).json({ code: 401, message: "未登录或登录已过期" });
  }
  req.user = result.user;
  next();
}

function requireRoles(allowedRoles) {
  const roleSet = new Set((allowedRoles || []).map((item) => String(item)));
  return async (req, res, next) => {
    const result = await resolveRequestUser(req);
    if (!result.user) {
      if (result.reason === "ACCOUNT_DISABLED") {
        return res.status(401).json({
          code: 401,
          message: "账号已被禁用，请重新登录",
          data: { notices: [{ type: "ACCOUNT_DISABLED", message: "账号已被禁用" }] }
        });
      }
      if (result.reason === "ROLE_CHANGED") {
        return res.status(401).json({
          code: 401,
          message: "账号角色已变更，请重新登录",
          data: { notices: [result.notice] }
        });
      }
      return res.status(401).json({ code: 401, message: "未登录或登录已过期" });
    }

    if (!roleSet.has(result.user.role)) {
      return res.status(403).json({ code: 403, message: "无权限访问该接口" });
    }

    req.user = result.user;
    next();
  };
}

function authResponse(user, options = {}) {
  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken(user);
  setRefreshToken(refreshToken, user);
  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: accessTokenTtl,
    refreshExpiresIn: refreshTokenTtl,
    user,
    notices: Array.isArray(options.notices) ? options.notices : []
  };
}

function ok(res, data, message) {
  return res.json({ code: 0, message: message || "ok", data });
}

function badRequest(res, message) {
  return res.status(400).json({ code: 400, message });
}

function notFound(res, message) {
  return res.status(404).json({ code: 404, message });
}

function buildAuditMeta(req) {
  return {
    operatorId: req.user ? Number(req.user.id) : null,
    operatorRole: req.user ? req.user.role : null,
    requestId: req.requestId || null,
    traceId: req.traceId || null,
    source: req.headers["x-client-source"] || req.headers["user-agent"] || "unknown",
    ip: req.ip || ""
  };
}

function attachAuditMeta(data, req) {
  return {
    ...data,
    _audit: buildAuditMeta(req)
  };
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function buildPagedResult(list, pageRaw, pageSizeRaw) {
  const pageSize = Math.min(100, toPositiveInt(pageSizeRaw, 20));
  const page = toPositiveInt(pageRaw, 1);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = list.slice(start, start + pageSize);
  return {
    items,
    page: safePage,
    pageSize,
    total,
    totalPages
  };
}

function normalizeStatusList(value) {
  const statuses = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return statuses;
}
function sanitizeToken(value) {
  return String(value || "").trim();
}

function getDeviceByQrToken(token) {
  const t = sanitizeToken(token);
  if (!t) return null;
  return db.devices.find((item) => item.qrEnabled !== false && item.qrToken === t) || null;
}

function getConsumableByQrToken(token) {
  const t = sanitizeToken(token);
  if (!t) return null;
  return db.consumables.find((item) => item.qrEnabled !== false && item.qrToken === t) || null;
}

function getQrAction(payload) {
  const action = String((payload && payload.action) || "").trim();
  if (!["reset", "enable", "disable"].includes(action)) {
    return null;
  }
  return action;
}

function applyQrAction(record, prefix, action) {
  if (action === "reset") {
    record.qrToken = db.generateQrToken(prefix);
    record.qrEnabled = true;
  }
  if (action === "enable") {
    record.qrEnabled = true;
  }
  if (action === "disable") {
    record.qrEnabled = false;
  }
  return record;
}

function getCurrentQrBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_WEB_BASE || "").trim();
  if (envBase) {
    return envBase.replace(/\/$/, "");
  }
  const protocol = req.protocol || "http";
  const host = req.get("host");
  return `${protocol}://${host}`;
}

function buildQrLandingUrl(req, type, token) {
  const key = type === "device" ? "deviceToken" : "consumableToken";
  return `${getCurrentQrBaseUrl(req)}/miniapp/?${key}=${encodeURIComponent(String(token || ""))}`;
}

async function createQrImageDataUrl(text) {
  const dataUrl = await QRCode.toDataURL(String(text || ""), {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 560,
    color: {
      dark: "#0f172a",
      light: "#ffffff"
    }
  });
  return dataUrl;
}

function createQrPdfBuffer({ title, subtitle, qrDataUrl, scanUrl }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(22).fillColor("#0f172a").text(title || "二维码", 40, 40, {
      align: "center"
    });
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor("#475569").text(subtitle || "", {
      align: "center"
    });

    doc.moveDown(1.2);
    doc.image(Buffer.from(String(qrDataUrl).replace(/^data:image\/png;base64,/, ""), "base64"), {
      fit: [320, 320],
      align: "center"
    });

    doc.moveDown(1);
    doc.fontSize(11).fillColor("#111827").text(`扫码地址：${scanUrl}`, {
      align: "left"
    });

    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#64748b").text(`导出时间：${new Date().toLocaleString("zh-CN")}`, {
      align: "left"
    });

    doc.end();
  });
}

function recordQrScan(type, record, token, req) {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const userAgent = req.headers["user-agent"] || "unknown";
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  const log = {
    id: db.nextId(db.qrScanLogs),
    type,
    entityId: Number(record.id),
    entityName: record.name || `${type}#${record.id}`,
    token: String(token || ""),
    userId,
    userAgent,
    ip,
    createdAt: new Date().toISOString()
  };

  db.qrScanLogs.push(log);
  return log;
}

function getUserName(userId) {
  const user = db.users.find((item) => item.id === Number(userId));
  return user ? user.name : `用户#${userId}`;
}

function getWarehouseName(warehouseId) {
  const warehouse = (db.warehouses || []).find((item) => Number(item.id) === Number(warehouseId));
  return warehouse ? warehouse.name : `仓库#${warehouseId}`;
}

function getBusinessRecord(type, businessId) {
  const id = Number(businessId);
  if (type === "borrow") {
    return db.borrows.find((item) => item.id === id) || null;
  }
  if (type === "consumable_application") {
    return db.consumableApplications.find((item) => item.id === id) || null;
  }
  return null;
}

function syncApproval(type, businessId, status, remark) {
  const approval = db.approvals.find(
    (item) => item.type === type && item.businessId === Number(businessId)
  );
  if (approval) {
    approval.status = status;
    if (typeof remark === "string") {
      approval.remark = remark;
    }
    approval.updatedAt = new Date().toISOString();
  }
}

function createApproval(type, businessId, applicantId) {
  const approval = {
    id: db.nextId(db.approvals),
    type,
    businessId,
    applicantId,
    status: "pending",
    remark: "",
    createdAt: new Date().toISOString()
  };
  db.approvals.push(approval);
  return approval;
}

function setBorrowStatus(record, nextStatus) {
  const device = db.devices.find((item) => item.id === Number(record.deviceId));
  const prevStatus = record.status;

  if (!device) {
    return { error: "关联设备不存在" };
  }

  if (
    ["approved", "borrowed"].includes(nextStatus) &&
    !["approved", "borrowed"].includes(prevStatus) &&
    device.status === "borrowed"
  ) {
    return { error: "设备已借出，无法重复审批" };
  }

  if (["approved", "borrowed"].includes(nextStatus)) {
    device.status = "borrowed";
  }

  if (["rejected", "returned", "cancelled"].includes(nextStatus)) {
    device.status = "available";
  }

  record.status = nextStatus;
  syncApproval("borrow", record.id, nextStatus);
  return { record };
}

function setConsumableApplicationStatus(record, nextStatus) {
  const prevStatus = record.status;
  const warehouseId = record.warehouseId ? Number(record.warehouseId) : 1;

  const stock = db.consumableStocks.find(
    (s) =>
      Number(s.warehouseId) === Number(warehouseId) && Number(s.consumableId) === Number(record.consumableId)
  );

  if (!stock) {
    return { error: `关联耗材库存不存在（${getWarehouseName(warehouseId)}）` };
  }

  if (prevStatus !== "approved" && nextStatus === "approved") {
    if (Number(stock.stock) < Number(record.quantity)) {
      return { error: `库存不足（${getWarehouseName(warehouseId)}），无法审批通过` };
    }
    stock.stock = Number(stock.stock) - Number(record.quantity);
  }

  // 审批从 approved 回滚到非 approved：退还库存
  if (prevStatus === "approved" && nextStatus !== "approved") {
    stock.stock = Number(stock.stock) + Number(record.quantity);
  }

  record.status = nextStatus;
  syncApproval("consumable_application", record.id, nextStatus);
  return { record };
}

function applyApprovalAction(approval, nextStatus) {
  const record = getBusinessRecord(approval.type, approval.businessId);
  if (!record) {
    return { error: "审批关联业务不存在" };
  }

  if (approval.type === "borrow") {
    return setBorrowStatus(record, nextStatus);
  }

  if (approval.type === "consumable_application") {
    return setConsumableApplicationStatus(record, nextStatus);
  }

  return { error: "暂不支持的审批类型" };
}

function buildApprovalView(approval) {
  const record = getBusinessRecord(approval.type, approval.businessId);
  const applicantName = getUserName(approval.applicantId);

  if (!record) {
    return {
      ...approval,
      applicantName,
      title: "业务记录不存在",
      description: "请检查数据一致性",
      businessStatus: "unknown",
      remark: approval.remark || ""
    };
  }

  if (approval.type === "borrow") {
    const device = db.devices.find((item) => item.id === Number(record.deviceId));
    return {
      ...approval,
      applicantName,
      title: `${device ? device.name : "设备"}借用申请`,
      description: `${record.borrowDate} ~ ${record.expectedReturnDate} ${record.expectedReturnTime || ""} / ${record.purpose || "未填写用途"}`.trim(),
      businessStatus: record.status,
      remark: approval.remark || ""
    };
  }

  if (approval.type === "consumable_application") {
    const consumable = db.consumables.find(
      (item) => item.id === Number(record.consumableId)
    );
    return {
      ...approval,
      applicantName,
      title: `${consumable ? consumable.name : "耗材"}申领申请`,
      description: `仓库：${getWarehouseName(record.warehouseId || 1)} / 数量：${record.quantity} / ${record.purpose || "未填写用途"}`,
      businessStatus: record.status,
      remark: approval.remark || ""
    };
  }

  return {
    ...approval,
    applicantName,
    title: approval.type,
    description: "未知业务类型",
    businessStatus: record.status || "unknown",
    remark: approval.remark || ""
  };
}

function buildStockAlerts(warehouseId = 1) {
  const low = [];
  const surplus = [];
  const normal = [];

  const wid = Number(warehouseId);
  const stocks = db.consumableStocks.filter((s) => Number(s.warehouseId) === wid);

  stocks.forEach((stockItem) => {
    const consumable = db.consumables.find((c) => Number(c.id) === Number(stockItem.consumableId));
    if (!consumable) return;

    const safeStock = Number(stockItem.safeStock);
    const stock = Number(stockItem.stock);

    const base = {
      id: consumable.id,
      name: consumable.name,
      category: consumable.category,
      unit: consumable.unit || "",
      stock,
      safeStock
    };

    if (safeStock > 0 && stock <= safeStock) {
      low.push({
        ...base,
        // 补到 safeStock 需要的数量（用于“估算补货量”）
        needToSafeStock: Math.max(0, safeStock - stock)
      });
      return;
    }

    if (safeStock > 0 && stock >= safeStock * 2) {
      surplus.push({
        ...base,
        // 相对 safeStock 的富余量（用于“估算消耗/少买”）
        surplusOverSafeStock: Math.max(0, stock - safeStock)
      });
      return;
    }

    normal.push(base);
  });

  // 低库存优先展示缺口最大的/最紧的（这里按缺口降序）
  low.sort((a, b) => b.needToSafeStock - a.needToSafeStock);
  // 库存过多优先展示库存最高的
  surplus.sort((a, b) => b.stock - a.stock);

  return { low, surplus, normal };
}

function formatMovementType(type) {
  return type === "in" ? "进货" : type === "out" ? "出货" : type || "-";
}

function buildStockMovementView(movement) {
  const consumable = db.consumables.find(
    (item) => item.id === Number(movement.consumableId)
  );
  const warehouse = db.warehouses
    ? db.warehouses.find((w) => Number(w.id) === Number(movement.warehouseId))
    : null;
  const operatorName = movement.userId
    ? getUserName(movement.userId)
    : "未指定";

  return {
    ...movement,
    consumableName: consumable ? consumable.name : "未知耗材",
    operatorName,
    warehouseName: warehouse ? warehouse.name : "-",
    typeLabel: formatMovementType(movement.type)
  };
}

function pad2(num) {
  return String(num).padStart(2, "0");
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function normalizeDateText(text) {
  const m = String(text || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
}

function extractDatesFromQuestion(question) {
  const matches = String(question || "").match(/\d{4}-\d{1,2}-\d{1,2}/g) || [];
  return matches.map(normalizeDateText).filter(Boolean);
}

function detectWarehouseIdFromQuestion(question, fallbackId = 1) {
  const q = String(question || "");
  if (/厂房/.test(q)) return 2;
  if (/实验室/.test(q)) return 1;
  return Number(fallbackId || 1);
}

function extractPurposeFromQuestion(question) {
  const match = String(question || "").match(/用途[是为：:\s]*([^。；\n]+)/);
  if (match && match[1]) {
    return String(match[1]).trim();
  }
  return "AI 助手代提交";
}

function findBestDeviceByQuestion(question) {
  const q = String(question || "");
  return db.devices.find((item) => q.includes(item.name)) || null;
}

function findBestConsumableByQuestion(question) {
  const q = String(question || "");
  return db.consumables.find((item) => q.includes(item.name)) || null;
}

function extractQuantityFromQuestion(question, fallback = 1) {
  const match = String(question || "").match(/(\d+)\s*(个|盒|包|支|瓶|套|台|件)?/);
  if (!match) return Number(fallback || 1);
  return Math.max(1, Number(match[1] || fallback || 1));
}

function createBorrowRecord(payload) {
  const record = {
    id: db.nextId(db.borrows),
    deviceId: Number(payload.deviceId),
    userId: Number(payload.userId),
    purpose: payload.purpose || "",
    borrowDate: payload.borrowDate,
    expectedReturnDate: payload.expectedReturnDate,
    expectedReturnTime: payload.expectedReturnTime || "18:00",
    status: "pending"
  };

  db.borrows.push(record);
  createApproval("borrow", record.id, record.userId);
  return record;
}

function createConsumableApplicationRecord(payload) {
  const record = {
    id: db.nextId(db.consumableApplications),
    consumableId: Number(payload.consumableId),
    warehouseId: Number(payload.warehouseId || 1),
    userId: Number(payload.userId),
    quantity: Number(payload.quantity),
    purpose: payload.purpose || "",
    status: "pending"
  };

  db.consumableApplications.push(record);
  createApproval("consumable_application", record.id, record.userId);
  return record;
}

function tryHandleAiUserOperation(question, userId, defaultWarehouseId = 1) {
  const q = String(question || "").trim();
  const uid = Number(userId || 0);

  if (!q) return null;
  if (!uid) {
    return {
      handled: true,
      success: false,
      type: "unknown",
      message: "缺少用户身份，无法代操作"
    };
  }

  const wantsBorrow = /借用|借设备|借一下|我要借|借/.test(q) && /设备|仪器|机器|示波器|水浴锅/.test(q);
  const wantsApply = /申领|领用|领取|我要领|耗材/.test(q);

  if (!wantsBorrow && !wantsApply) {
    return null;
  }

  if (wantsBorrow) {
    const device = findBestDeviceByQuestion(q);
    if (!device) {
      return {
        handled: true,
        success: false,
        type: "borrow",
        message: "未识别到设备名称，请在问题里写明设备名，例如“我要借用示波器”"
      };
    }

    if (device.status === "borrowed") {
      return {
        handled: true,
        success: false,
        type: "borrow",
        message: `${device.name} 当前已借出，请选择其他设备`
      };
    }

    const dates = extractDatesFromQuestion(q);
    const today = new Date();
    const defaultReturn = new Date(today);
    defaultReturn.setDate(defaultReturn.getDate() + 1);

    const borrowDate = dates[0] || toIsoDate(today);
    const expectedReturnDate = dates[1] || dates[0] || toIsoDate(defaultReturn);
    const purpose = extractPurposeFromQuestion(q);

    const record = createBorrowRecord({
      deviceId: device.id,
      userId: uid,
      purpose,
      borrowDate,
      expectedReturnDate,
      expectedReturnTime: "18:00"
    });

    return {
      handled: true,
      success: true,
      type: "borrow",
      record,
      message: `已为你提交设备借用：${device.name}（${borrowDate} ~ ${expectedReturnDate}），审批中。`
    };
  }

  const consumable = findBestConsumableByQuestion(q);
  if (!consumable) {
    return {
      handled: true,
      success: false,
      type: "apply",
      message: "未识别到耗材名称，请在问题里写明耗材名，例如“我要申领一次性手套 2 盒”"
    };
  }

  const quantity = extractQuantityFromQuestion(q, 1);
  const warehouseId = detectWarehouseIdFromQuestion(q, defaultWarehouseId);
  const warehouse = (db.warehouses || []).find((item) => Number(item.id) === Number(warehouseId));

  if (!warehouse) {
    return {
      handled: true,
      success: false,
      type: "apply",
      message: "未找到目标仓库，请在问题中说明“实验室”或“厂房”"
    };
  }

  const record = createConsumableApplicationRecord({
    consumableId: consumable.id,
    warehouseId,
    userId: uid,
    quantity,
    purpose: extractPurposeFromQuestion(q)
  });

  return {
    handled: true,
    success: true,
    type: "apply",
    record,
    message: `已为你提交耗材申领：${consumable.name} x${quantity}（${warehouse.name}），审批中。`
  };
}

function buildAiAnswer(question) {
  const q = String(question || "").trim();
  const qLower = q.toLowerCase();

  const wantsLow = /缺|不足|低库存|短缺|需要|不够/.test(q);
  const wantsSurplus = /多|过多|富余|剩余|用不完|太多/.test(q);
  const wantsAdvice = /建议|怎么办|怎么做|推荐|方案|采购|补货|消耗|下一步/.test(q);
  const wantsApprovals = /审批|待处理|待审批|待通过|驳回|通过/.test(q);

  const wantsLab = /实验室|lab/.test(qLower) || /实验室仓库|lab仓库/.test(q);
  const wantsFactory = /厂房|factory/.test(qLower) || /厂房仓库|factory仓库/.test(q);

  // 英文/数字意图兜底（允许后续接入真实 LLM 时兼容更自由的问题）
  const wantsLowByEn = /low|short|lack|need/i.test(qLower);
  const wantsSurplusByEn = /surplus|over|many|excess|too much/i.test(qLower);

  const effectiveWantsLow = wantsLow || wantsLowByEn;
  const effectiveWantsSurplus = wantsSurplus || wantsSurplusByEn;

  const pendingApprovals = db.approvals.filter((item) => item.status === "pending").length;

  const labId = 1;
  const factoryId = 2;
  const scopes = [];

  if (wantsLab) scopes.push({ id: labId, label: "实验室仓库" });
  if (wantsFactory) scopes.push({ id: factoryId, label: "厂房仓库" });
  if (scopes.length === 0) {
    scopes.push({ id: labId, label: "实验室仓库" });
    scopes.push({ id: factoryId, label: "厂房仓库" });
  }

  function formatTopLow(alerts) {
    const topLow = alerts.low.slice(0, 5);
    return topLow
      .map(
        (item) =>
          `${item.name}${item.unit ? `（${item.unit}）` : ""}：库存${item.stock}，安全${item.safeStock}，缺口${item.needToSafeStock}`
      )
      .join("；");
  }

  function formatTopSurplus(alerts) {
    const topSurplus = alerts.surplus.slice(0, 5);
    return topSurplus
      .map(
        (item) =>
          `${item.name}${item.unit ? `（${item.unit}）` : ""}：库存${item.stock}，安全${item.safeStock}，富余${item.surplusOverSafeStock}`
      )
      .join("；");
  }

  function totalNeed(alerts) {
    return alerts.low.reduce((sum, i) => sum + Number(i.needToSafeStock || 0), 0);
  }

  // 只看缺货
  if (effectiveWantsLow && !effectiveWantsSurplus) {
    const parts = [];
    scopes.forEach((s) => {
      const alerts = buildStockAlerts(s.id);
      if (alerts.low.length === 0) {
        parts.push(`${s.label}：无低库存（缺货）耗材`);
      } else {
        parts.push(`${s.label}：低库存（缺货）耗材如下：${formatTopLow(alerts)}`);
      }
    });
    return `${parts.join("。")}。待审批单数：${pendingApprovals}。如需我给补货数量合计，回复我：再补货数量。`;
  }

  // 只看富余
  if (effectiveWantsSurplus && !effectiveWantsLow) {
    const parts = [];
    scopes.forEach((s) => {
      const alerts = buildStockAlerts(s.id);
      if (alerts.surplus.length === 0) {
        parts.push(`${s.label}：无库存过多（富余）耗材`);
      } else {
        parts.push(`${s.label}：库存过多（富余）耗材如下：${formatTopSurplus(alerts)}`);
      }
    });
    return `${parts.join("。")}。待审批单数：${pendingApprovals}。如需我评估“少买/优先消耗”，继续问我。`;
  }

  // 总体建议或问法不明确：给两仓库洞察
  if (wantsAdvice || (!effectiveWantsLow && !effectiveWantsSurplus)) {
    const parts = [];
    parts.push("库存洞察：");
    scopes.forEach((s) => {
      const alerts = buildStockAlerts(s.id);
      const lowText = alerts.low.length === 0 ? "无" : formatTopLow(alerts);
      const surplusText = alerts.surplus.length === 0 ? "无" : formatTopSurplus(alerts);
      parts.push(`- ${s.label}：低库存：${lowText}；库存过多：${surplusText}`);
    });

    if (wantsApprovals) {
      parts.push(`- 待审批：${pendingApprovals} 单（借用/申领审批）`);
    } else {
      parts.push(`- 待审批：${pendingApprovals} 单（如需我可以顺带列出重点审批类型）`);
    }

    // 简单补货/少买建议（按缺货/富余总量给一句）
    const labAlerts = buildStockAlerts(labId);
    const factoryAlerts = buildStockAlerts(factoryId);
    const totalNeedSafe = totalNeed(labAlerts) + totalNeed(factoryAlerts);
    const totalSurplusCount = labAlerts.surplus.length + factoryAlerts.surplus.length;

    parts.push(`\n建议执行（MVP 规则引擎）：`);
    if (totalNeedSafe > 0) {
      parts.push(`- 优先补货：把低库存耗材补到安全库存线（缺口合计约 ${totalNeedSafe}）。`);
    } else {
      parts.push(`- 当前补货压力不大：可以把采购重点放到未来计划使用上。`);
    }
    if (totalSurplusCount > 0) {
      parts.push(`- 对富余库存：减少采购或安排消耗，必要时按“先用后买”。`);
    } else {
      parts.push(`- 富余库存不明显：建议继续按安全库存策略滚动采购。`);
    }

    parts.push(`\n你可以再问我：给出“某个耗材”的补货建议（例如：一次性手套在实验室/厂房各补多少）。`);
    return parts.join("\n");
  }

  // 保底
  const s0 = scopes[0];
  const alerts0 = buildStockAlerts(s0.id);
  return `我能基于当前库存安全线做“缺货/富余”判断。当前（${s0.label}）缺货数=${alerts0.low.length}，富余数=${alerts0.surplus.length}，待审批单数=${pendingApprovals}。你想看哪一类（缺货/富余）或指定仓库（实验室/厂房）？`;
}

app.get("/", (req, res) => {
  res.redirect("/miniapp/");
});

app.get("/api/health", (req, res) => {
  ok(res, { timestamp: new Date().toISOString() }, "ok");
});

app.post("/api/auth/login", authRateLimiter, async (req, res) => {
  const payload = req.body || {};
  const attemptKey = getLoginAttemptKey(req, payload);

  try {
    purgeExpiredAttempts();
    const attemptState = takeAttempt(loginAttemptStore, attemptKey, {
      windowMs: loginFailWindowMs,
      maxFails: loginFailMax,
      blockMs: loginFailBlockMs
    });
    if (attemptState.blocked) {
      const remain = getRemainingBlockSeconds(attemptState.blockUntilMs);
      return res.status(429).json({
        code: 429,
        message: `登录失败次数过多，请 ${remain} 秒后重试`
      });
    }

    const authResult = await authenticateUser(payload);
    if (authResult.errorType === "bad_request") {
      return badRequest(res, authResult.message);
    }
    if (authResult.errorType === "not_found") {
      markAttemptFailure(loginAttemptStore, attemptKey, {
        windowMs: loginFailWindowMs,
        maxFails: loginFailMax,
        blockMs: loginFailBlockMs
      });
      return notFound(res, authResult.message);
    }
    if (authResult.errorType === "forbidden") {
      markAttemptFailure(loginAttemptStore, attemptKey, {
        windowMs: loginFailWindowMs,
        maxFails: loginFailMax,
        blockMs: loginFailBlockMs
      });
      return res.status(403).json({ code: 403, message: authResult.message });
    }

    const user = authResult.user;
    if (!user) {
      markAttemptFailure(loginAttemptStore, attemptKey, {
        windowMs: loginFailWindowMs,
        maxFails: loginFailMax,
        blockMs: loginFailBlockMs
      });
      return badRequest(res, "登录失败：用户信息异常");
    }

    const notices = buildAuthNoticeFromUser(user);
    if (user.enabled === false) {
      markAttemptFailure(loginAttemptStore, attemptKey, {
        windowMs: loginFailWindowMs,
        maxFails: loginFailMax,
        blockMs: loginFailBlockMs
      });
      return res.status(403).json({ code: 403, message: "账号已禁用", data: { notices } });
    }

    clearAttemptRecord(loginAttemptStore, attemptKey);
    purgeExpiredRefreshTokens();
    return ok(res, authResponse(user, { notices }), "登录成功");
  } catch (err) {
    markAttemptFailure(loginAttemptStore, attemptKey, {
      windowMs: loginFailWindowMs,
      maxFails: loginFailMax,
      blockMs: loginFailBlockMs
    });
    return badRequest(res, `登录失败：${err.message}`);
  }
});

app.post("/api/auth/refresh", authRateLimiter, async (req, res) => {
  const payload = req.body || {};
  const refreshToken = String(payload.refreshToken || "").trim();
  const refreshAttemptKey = getRefreshAttemptKey(req, payload);

  const refreshAttemptState = takeAttempt(refreshAttemptStore, refreshAttemptKey, {
    windowMs: refreshRateWindowMs,
    maxFails: refreshRateMax,
    blockMs: Math.max(30_000, refreshRateWindowMs)
  });
  if (refreshAttemptState.blocked) {
    const remain = getRemainingBlockSeconds(refreshAttemptState.blockUntilMs);
    return res.status(429).json({ code: 429, message: `刷新过于频繁，请 ${remain} 秒后重试` });
  }

  if (!refreshToken) {
    markAttemptFailure(refreshAttemptStore, refreshAttemptKey, {
      windowMs: refreshRateWindowMs,
      maxFails: refreshRateMax,
      blockMs: Math.max(30_000, refreshRateWindowMs)
    });
    return badRequest(res, "refreshToken 不能为空");
  }

  purgeExpiredRefreshTokens();

  if (!refreshTokenStore.has(refreshToken)) {
    markAttemptFailure(refreshAttemptStore, refreshAttemptKey, {
      windowMs: refreshRateWindowMs,
      maxFails: refreshRateMax,
      blockMs: Math.max(30_000, refreshRateWindowMs)
    });
    return res.status(401).json({ code: 401, message: "refreshToken 无效或已过期" });
  }

  try {
    const tokenPayload = jwt.verify(refreshToken, jwtRefreshSecret);
    if (tokenPayload.type !== "refresh") {
      markAttemptFailure(refreshAttemptStore, refreshAttemptKey, {
        windowMs: refreshRateWindowMs,
        maxFails: refreshRateMax,
        blockMs: Math.max(30_000, refreshRateWindowMs)
      });
      return res.status(401).json({ code: 401, message: "refreshToken 无效" });
    }

    const user = await findUserById(tokenPayload.sub);
    if (!user || user.enabled === false) {
      refreshTokenStore.delete(refreshToken);
      markAttemptFailure(refreshAttemptStore, refreshAttemptKey, {
        windowMs: refreshRateWindowMs,
        maxFails: refreshRateMax,
        blockMs: Math.max(30_000, refreshRateWindowMs)
      });
      return res.status(401).json({
        code: 401,
        message: "用户不存在、已禁用或角色已变更，请重新登录",
        data: {
          notices: user ? buildAuthNoticeFromUser(user) : [{ type: "ACCOUNT_NOT_FOUND", message: "用户不存在" }]
        }
      });
    }

    const roleNotice = buildRoleChangedNotice(user, tokenPayload.role);
    if (roleNotice) {
      refreshTokenStore.delete(refreshToken);
      markAttemptFailure(refreshAttemptStore, refreshAttemptKey, {
        windowMs: refreshRateWindowMs,
        maxFails: refreshRateMax,
        blockMs: Math.max(30_000, refreshRateWindowMs)
      });
      return res.status(401).json({
        code: 401,
        message: "账号角色已变更，请重新登录",
        data: { notices: [roleNotice] }
      });
    }

    refreshTokenStore.delete(refreshToken);
    clearAttemptRecord(refreshAttemptStore, refreshAttemptKey);
    return ok(res, authResponse(user), "刷新成功");
  } catch (err) {
    refreshTokenStore.delete(refreshToken);
    markAttemptFailure(refreshAttemptStore, refreshAttemptKey, {
      windowMs: refreshRateWindowMs,
      maxFails: refreshRateMax,
      blockMs: Math.max(30_000, refreshRateWindowMs)
    });
    return res.status(401).json({ code: 401, message: "refreshToken 验证失败" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const payload = req.body || {};
  const refreshToken = String(payload.refreshToken || "").trim();

  if (refreshToken) {
    refreshTokenStore.delete(refreshToken);
  }

  return ok(res, { success: true }, "已退出登录");
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  ok(res, req.user);
});

app.get("/api/dashboard/stats", async (req, res) => {
  if (mysqlStore.useMySql) {
    try {
      const stats = await mysqlStore.getDashboardStats();
      return ok(res, stats);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  const pendingApprovals = db.approvals.filter((item) => item.status === "pending").length;
  const lowStockCount = db.consumableStocks.filter(
    (item) =>
      Number(item.safeStock) > 0 &&
      Number(item.stock) <= Number(item.safeStock)
  ).length;

  ok(res, {
    pendingApprovals,
    devicesCount: db.devices.length,
    consumablesCount: db.consumables.length,
    borrowsCount: db.borrows.length,
    lowStockCount
  });
});

app.get("/api/users", requireAuth, async (req, res) => {
  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getUsers();
      return ok(res, rows.map((item) => sanitizeUser(item)));
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  ok(res, db.users.map((item) => sanitizeUser(item)));
});

app.get("/api/users/operation-logs", requireRoles(["admin"]), async (req, res) => {
  const { type, targetUserId, operatorId, page, pageSize } = req.query;

  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getOperationLogs();
      let list = rows;
      if (type) {
        list = list.filter((item) => String(item.type || "") === String(type));
      }
      if (targetUserId) {
        list = list.filter((item) => Number(item.targetUserId) === Number(targetUserId));
      }
      if (operatorId) {
        list = list.filter((item) => Number(item.operatorId) === Number(operatorId));
      }
      return ok(res, buildPagedResult(list, page, pageSize));
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  let list = [...(db.operationLogs || [])];
  if (type) {
    list = list.filter((item) => String(item.type || "") === String(type));
  }
  if (targetUserId) {
    list = list.filter((item) => Number(item.targetUserId) === Number(targetUserId));
  }
  if (operatorId) {
    list = list.filter((item) => Number(item.operatorId) === Number(operatorId));
  }
  list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return ok(res, buildPagedResult(list, page, pageSize));
});

app.patch("/api/users/:id", requireRoles(["admin"]), async (req, res) => {
  const targetUserId = Number(req.params.id);
  if (!targetUserId) {
    return badRequest(res, "用户ID不合法");
  }

  const payload = req.body || {};
  const wantsEnabledChange = Object.prototype.hasOwnProperty.call(payload, "enabled");
  const wantsRoleChange = Object.prototype.hasOwnProperty.call(payload, "role");

  if (!wantsEnabledChange && !wantsRoleChange) {
    return badRequest(res, "请至少提供 enabled 或 role 字段");
  }

  const nextEnabled = wantsEnabledChange ? payload.enabled === true : undefined;
  const nextRawRole = wantsRoleChange ? normalizeRoleInput(payload.role) : undefined;
  if (wantsRoleChange && !nextRawRole) {
    return badRequest(res, "role 仅支持 super_admin/admin/teacher/student");
  }

  if (Number(req.user.id) === targetUserId && wantsEnabledChange && nextEnabled === false) {
    return badRequest(res, "不能禁用当前登录账号");
  }

  try {
    const before = await findUserById(targetUserId);
    if (!before) {
      return notFound(res, "用户不存在");
    }

    let after = null;
    const roleUpdatedAt = new Date().toISOString();

    if (mysqlStore.useMySql) {
      const updatePayload = {};
      if (wantsEnabledChange) updatePayload.enabled = nextEnabled;
      if (wantsRoleChange) {
        updatePayload.role = nextRawRole;
        updatePayload.roleUpdatedAt = roleUpdatedAt;
      }
      const row = await mysqlStore.updateUserById(targetUserId, updatePayload);
      after = sanitizeUser(row);
    } else {
      const user = db.users.find((item) => Number(item.id) === targetUserId);
      if (!user) {
        return notFound(res, "用户不存在");
      }
      if (wantsEnabledChange) {
        user.enabled = nextEnabled;
      }
      if (wantsRoleChange) {
        user.role = nextRawRole;
        user.roleUpdatedAt = roleUpdatedAt;
      }
      after = sanitizeUser(user);
    }

    const audit = buildAuditMeta(req);
    const operatorName = req.user ? req.user.name : "系统";

    if (wantsEnabledChange && before.enabled !== after.enabled) {
      await createOperationLog({
        type: mapUserActionType(before.enabled, after.enabled),
        targetUserId: after.id,
        targetUserName: after.name,
        beforeRole: before.rawRole,
        afterRole: after.rawRole,
        beforeEnabled: before.enabled,
        afterEnabled: after.enabled,
        message: after.enabled ? "账号已启用" : "账号已禁用",
        audit,
        operatorName
      });
    }

    if (wantsRoleChange && before.rawRole !== after.rawRole) {
      await createOperationLog({
        type: "ROLE_CHANGED",
        targetUserId: after.id,
        targetUserName: after.name,
        beforeRole: before.rawRole,
        afterRole: after.rawRole,
        beforeEnabled: before.enabled,
        afterEnabled: after.enabled,
        message: buildRoleChangedMessage(before.rawRole, after.rawRole),
        audit,
        operatorName
      });
    }

    const notices = [];
    if (wantsEnabledChange && before.enabled !== after.enabled && after.enabled === false) {
      notices.push({ type: "ACCOUNT_DISABLED", message: `${after.name} 已被禁用` });
    }
    if (wantsRoleChange && before.rawRole !== after.rawRole) {
      notices.push({
        type: "ROLE_CHANGED",
        message: `${after.name} 角色已从 ${before.rawRole} 变更为 ${after.rawRole}`
      });
    }

    return ok(
      res,
      {
        user: after,
        notices
      },
      "用户信息已更新"
    );
  } catch (err) {
    return badRequest(res, `用户更新失败：${err.message}`);
  }
});

app.get("/api/qr-scan-logs", (req, res) => {
  const { type, entityId } = req.query;
  const wantsAll = String(req.query.all || "") === "1";
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

  let list = [...(db.qrScanLogs || [])];

  if (type) {
    list = list.filter((item) => item.type === type);
  }
  if (entityId) {
    list = list.filter((item) => Number(item.entityId) === Number(entityId));
  }

  list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const normalized = list.map((item) => ({
    ...item,
    userName: item.userId ? getUserName(item.userId) : "匿名"
  }));

  if (wantsAll) {
    return ok(res, {
      items: normalized,
      total: normalized.length,
      page: 1,
      pageSize: normalized.length || 1,
      totalPages: 1
    });
  }

  const total = normalized.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = normalized.slice(start, start + pageSize);

  ok(res, {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages
  });
});

app.get("/api/warehouses", async (req, res) => {
  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getWarehouses();
      return ok(res, rows);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  ok(res, db.warehouses || []);
});

app.get("/api/devices", async (req, res) => {
  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getDevices();
      return ok(res, rows);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  ok(res, db.devices);
});

app.get("/api/devices/:id/qr/export", async (req, res) => {
  let device;
  if (mysqlStore.useMySql) {
    try {
      const devices = await mysqlStore.getDevices();
      device = devices.find((item) => item.id === Number(req.params.id));
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  } else {
    device = db.devices.find((item) => item.id === Number(req.params.id));
  }

  if (!device) {
    return notFound(res, "设备不存在");
  }

  if (!device.qrToken || device.qrEnabled === false) {
    return badRequest(res, "设备二维码不可用");
  }

  const format = String(req.query.format || "pdf").toLowerCase();
  const scanUrl = buildQrLandingUrl(req, "device", device.qrToken);

  try {
    const qrDataUrl = await createQrImageDataUrl(scanUrl);

    if (format === "image" || format === "png") {
      const filename = `device-qr-${device.id}.png`;
      const pngBuffer = Buffer.from(String(qrDataUrl).replace(/^data:image\/png;base64,/, ""), "base64");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.send(pngBuffer);
    }

    const pdfBuffer = await createQrPdfBuffer({
      title: "设备二维码",
      subtitle: `${device.name || "设备"}${device.code ? `（${device.code}）` : ""}`,
      qrDataUrl,
      scanUrl
    });

    const filename = `device-qr-${device.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return badRequest(res, `导出失败：${err.message}`);
  }
});

app.get("/api/qr/device/:token", (req, res) => {
  const token = req.params.token;
  const device = getDeviceByQrToken(token);
  if (!device) {
    return notFound(res, "设备二维码不存在或已停用");
  }
  recordQrScan("device", device, token, req);
  return ok(res, device);
});

app.post("/api/devices/:id/qr", (req, res) => {
  const device = db.devices.find((item) => item.id === Number(req.params.id));
  if (!device) {
    return notFound(res, "设备不存在");
  }

  const action = getQrAction(req.body || {});
  if (!action) {
    return badRequest(res, "action 仅支持 reset / enable / disable");
  }

  applyQrAction(device, "dev", action);
  return ok(res, device, "设备二维码已更新");
});

app.post("/api/devices", requireAuth, async (req, res) => {
  const payload = req.body || {};
  if (!payload.name) {
    return badRequest(res, "设备名称不能为空");
  }

  if (mysqlStore.useMySql) {
    try {
      const record = await mysqlStore.createDevice(payload);
      return res.status(201).json({ code: 0, message: "设备创建成功", data: record });
    } catch (err) {
      return badRequest(res, `数据库操作失败：${err.message}`);
    }
  }

  const record = {
    id: db.nextId(db.devices),
    name: payload.name,
    code: payload.code || `DEV-${Date.now()}`,
    category: payload.category || "未分类",
    status: payload.status || "available",
    labId: payload.labId || null,
    qrToken: db.generateQrToken("dev"),
    qrEnabled: true
  };

  db.devices.push(record);
  return res.status(201).json({ code: 0, message: "设备创建成功", data: attachAuditMeta(record, req) });
});

app.get("/api/consumables", async (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : 1;

  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getConsumables(warehouseId);
      return ok(res, rows);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  const stocks = db.consumableStocks.filter(
    (s) => Number(s.warehouseId) === Number(warehouseId)
  );

  const data = db.consumables.map((c) => {
    const stock = stocks.find((s) => Number(s.consumableId) === Number(c.id));
    return {
      ...c,
      stock: stock ? Number(stock.stock) : 0,
      safeStock: stock ? Number(stock.safeStock) : 0
    };
  });

  ok(res, data);
});

app.get("/api/consumables/:id/qr/export", async (req, res) => {
  let consumable;
  if (mysqlStore.useMySql) {
    try {
      const list = await mysqlStore.getConsumables(1);
      consumable = list.find((item) => item.id === Number(req.params.id));
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  } else {
    consumable = db.consumables.find((item) => item.id === Number(req.params.id));
  }

  if (!consumable) {
    return notFound(res, "耗材不存在");
  }

  if (!consumable.qrToken || consumable.qrEnabled === false) {
    return badRequest(res, "耗材二维码不可用");
  }

  const format = String(req.query.format || "pdf").toLowerCase();
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : 1;
  let stockVal = 0;
  if (!mysqlStore.useMySql) {
    const stock = db.consumableStocks.find(
      (s) => Number(s.warehouseId) === Number(warehouseId) && Number(s.consumableId) === Number(consumable.id)
    );
    stockVal = stock ? Number(stock.stock) : 0;
  } else {
    stockVal = Number(consumable.stock || 0);
  }
  const scanUrl = buildQrLandingUrl(req, "consumable", consumable.qrToken);

  try {
    const qrDataUrl = await createQrImageDataUrl(scanUrl);

    if (format === "image" || format === "png") {
      const filename = `consumable-qr-${consumable.id}.png`;
      const pngBuffer = Buffer.from(String(qrDataUrl).replace(/^data:image\/png;base64,/, ""), "base64");
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.send(pngBuffer);
    }

    const pdfBuffer = await createQrPdfBuffer({
      title: "耗材二维码",
      subtitle: `${consumable.name || "耗材"} / 库存 ${stockVal}${consumable.unit || ""}`,
      qrDataUrl,
      scanUrl
    });

    const filename = `consumable-qr-${consumable.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return badRequest(res, `导出失败：${err.message}`);
  }
});

app.get("/api/qr/consumable/:token", (req, res) => {
  const token = req.params.token;
  const consumable = getConsumableByQrToken(token);
  if (!consumable) {
    return notFound(res, "耗材二维码不存在或已停用");
  }

  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : 1;
  const stock = db.consumableStocks.find(
    (s) => Number(s.warehouseId) === Number(warehouseId) && Number(s.consumableId) === Number(consumable.id)
  );

  recordQrScan("consumable", consumable, token, req);

  return ok(res, {
    ...consumable,
    stock: stock ? Number(stock.stock) : 0,
    safeStock: stock ? Number(stock.safeStock) : 0
  });
});

app.post("/api/consumables/:id/photo", (req, res) => {
  const consumable = db.consumables.find((item) => item.id === Number(req.params.id));
  if (!consumable) {
    return notFound(res, "耗材不存在");
  }

  const photoDataUrl = String((req.body && req.body.photoDataUrl) || "").trim();
  if (!photoDataUrl || !photoDataUrl.startsWith("data:image/")) {
    return badRequest(res, "photoDataUrl 必须是 data:image/* 的 base64 数据");
  }

  consumable.photoDataUrl = photoDataUrl;
  return ok(res, consumable, "耗材照片已更新");
});

app.post("/api/consumables/:id/qr", (req, res) => {
  const consumable = db.consumables.find((item) => item.id === Number(req.params.id));
  if (!consumable) {
    return notFound(res, "耗材不存在");
  }

  const action = getQrAction(req.body || {});
  if (!action) {
    return badRequest(res, "action 仅支持 reset / enable / disable");
  }

  applyQrAction(consumable, "cons", action);
  return ok(res, consumable, "耗材二维码已更新");
});

app.post("/api/consumables", requireAuth, async (req, res) => {
  const payload = req.body || {};
  if (!payload.name) {
    return badRequest(res, "耗材名称不能为空");
  }

  if (mysqlStore.useMySql) {
    try {
      const record = await mysqlStore.createConsumable(payload);
      return res.status(201).json({ code: 0, message: "耗材创建成功", data: record });
    } catch (err) {
      return badRequest(res, `数据库操作失败：${err.message}`);
    }
  }
  const record = {
    id: db.nextId(db.consumables),
    name: payload.name,
    category: payload.category || "未分类",
    unit: payload.unit || "个",
    photoDataUrl: payload.photoDataUrl || "",
    qrToken: db.generateQrToken("cons"),
    qrEnabled: true
  };

  db.consumables.push(record);

  const safeStock = Number(payload.safeStock || 0);
  const stock = Number(payload.stock || 0);
  const primaryWarehouseId = payload.warehouseId ? Number(payload.warehouseId) : 1;

  // 默认：实验室仓库用 payload.stock/safeStock；厂房仓库先按 0 stock 创建（safeStock 继承）
  db.warehouses.forEach((w) => {
    const wid = Number(w.id);
    const isPrimary = wid === Number(primaryWarehouseId);
    db.consumableStocks.push({
      id: db.nextId(db.consumableStocks),
      warehouseId: wid,
      consumableId: record.id,
      stock: isPrimary ? stock : 0,
      safeStock
    });
  });

  const primaryStock = db.consumableStocks.find(
    (s) => Number(s.warehouseId) === Number(primaryWarehouseId) && Number(s.consumableId) === Number(record.id)
  );

  return res.status(201).json({
    code: 0,
    message: "耗材创建成功",
    data: {
      ...record,
      stock: primaryStock ? Number(primaryStock.stock) : stock,
      safeStock
    }
  });
});

// 耗材库存洞察（多/少/缺口估算）
app.get("/api/consumables/stock-alerts", (req, res) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : 1;
  ok(res, buildStockAlerts(warehouseId));
});

// 耗材出入库清单（进货/出货）
app.get("/api/stock-movements", requireRoles(["teacher", "admin"]), (req, res) => {
  const { type, consumableId, warehouseId } = req.query;
  let list = [...db.stockMovements];

  if (type) {
    list = list.filter((item) => item.type === type);
  }

  if (consumableId) {
    list = list.filter((item) => Number(item.consumableId) === Number(consumableId));
  }

  if (warehouseId) {
    list = list.filter((item) => Number(item.warehouseId) === Number(warehouseId));
  }

  list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  ok(res, list.map(buildStockMovementView));
});

app.post("/api/stock-movements", requireRoles(["teacher", "admin"]), (req, res) => {
  const payload = req.body || {};

  const type = payload.type;
  const consumableId = Number(payload.consumableId);
  const quantity = Number(payload.quantity);
  const warehouseId = payload.warehouseId ? Number(payload.warehouseId) : 1;

  if (!["in", "out"].includes(type)) {
    return badRequest(res, "type 仅支持 in(进货) 或 out(出货)");
  }

  if (!consumableId) {
    return badRequest(res, "consumableId 不能为空");
  }

  if (!quantity || quantity <= 0) {
    return badRequest(res, "quantity 必须为正数");
  }

  const consumable = db.consumables.find((item) => item.id === consumableId);
  if (!consumable) return badRequest(res, "关联耗材不存在");

  let stock = db.consumableStocks.find(
    (s) => Number(s.warehouseId) === Number(warehouseId) && Number(s.consumableId) === Number(consumableId)
  );

  if (!stock) {
    // 若数据缺失：先创建一条 stock 记录（safeStock 设为 0，后续可用出入库/耗材创建补齐）
    stock = {
      id: db.nextId(db.consumableStocks),
      warehouseId: Number(warehouseId),
      consumableId: Number(consumableId),
      stock: 0,
      safeStock: 0
    };
    db.consumableStocks.push(stock);
  }

  if (type === "out" && Number(stock.stock) < quantity) {
    return badRequest(res, "库存不足，无法出货");
  }

  // 更新库存
  stock.stock = type === "in" ? Number(stock.stock) + quantity : Number(stock.stock) - quantity;

  const movement = {
    id: db.nextId(db.stockMovements),
    consumableId,
    warehouseId: Number(warehouseId),
    type,
    quantity,
    note: payload.note || "",
    userId: Number(req.user.id),
    createdAt: new Date().toISOString()
  };
  db.stockMovements.push(movement);

  return res.status(201).json({
    code: 0,
    message: "库存操作已记录",
    data: attachAuditMeta({ movement, consumable }, req)
  });
});

app.get("/api/borrows", async (req, res) => {
  const { status, userId, deviceId, page, pageSize } = req.query;
  const statusList = normalizeStatusList(status);

  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getBorrows();
      let data = rows.map((item) => {
        const expectedReturnAt = `${item.expectedReturnDate || ""} ${item.expectedReturnTime || "18:00"}`.trim();
        const isActiveUse = ["approved", "borrowed"].includes(String(item.status || ""));
        return {
          ...item,
          applicantName: item.borrowerName || getUserName(item.userId),
          borrowerName: item.borrowerName || getUserName(item.userId),
          deviceName: item.deviceName || "未知设备",
          expectedReturnTime: item.expectedReturnTime || "18:00",
          expectedReturnAt,
          isActiveUse
        };
      });

      if (statusList.length) {
        data = data.filter((item) => statusList.includes(String(item.status || "")));
      }
      if (userId) {
        data = data.filter((item) => Number(item.userId) === Number(userId));
      }
      if (deviceId) {
        data = data.filter((item) => Number(item.deviceId) === Number(deviceId));
      }

      const paged = buildPagedResult(data, page, pageSize);
      return ok(res, paged);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  let data = db.borrows.map((item) => {
    const device = db.devices.find((deviceItem) => deviceItem.id === Number(item.deviceId));
    const borrowerName = getUserName(item.userId);
    const expectedReturnAt = `${item.expectedReturnDate || ""} ${item.expectedReturnTime || "18:00"}`.trim();
    const isActiveUse = ["approved", "borrowed"].includes(String(item.status || ""));

    return {
      ...item,
      applicantName: borrowerName,
      borrowerName,
      deviceName: device ? device.name : "未知设备",
      expectedReturnTime: item.expectedReturnTime || "18:00",
      expectedReturnAt,
      isActiveUse
    };
  });

  if (statusList.length) {
    data = data.filter((item) => statusList.includes(String(item.status || "")));
  }
  if (userId) {
    data = data.filter((item) => Number(item.userId) === Number(userId));
  }
  if (deviceId) {
    data = data.filter((item) => Number(item.deviceId) === Number(deviceId));
  }

  const paged = buildPagedResult(data, page, pageSize);
  ok(res, paged);
});

app.post("/api/borrows", requireAuth, async (req, res) => {
  const payload = req.body || {};
  const safeUserId = Number(req.user.id);
  if (!payload.deviceId || !payload.borrowDate || !payload.expectedReturnDate) {
    return badRequest(res, "借用参数不完整");
  }

  if (mysqlStore.useMySql) {
    try {
      const record = await mysqlStore.createBorrow({
        ...payload,
        userId: safeUserId
      });
      return res.status(201).json({ code: 0, message: "借用申请已提交", data: attachAuditMeta(record, req) });
    } catch (err) {
      return badRequest(res, `数据库写入失败：${err.message}`);
    }
  }

  const record = createBorrowRecord({
    deviceId: payload.deviceId,
    userId: safeUserId,
    purpose: payload.purpose || "",
    borrowDate: payload.borrowDate,
    expectedReturnDate: payload.expectedReturnDate,
    expectedReturnTime: payload.expectedReturnTime || "18:00"
  });
  return res.status(201).json({ code: 0, message: "借用申请已提交", data: attachAuditMeta(record, req) });
});

app.patch("/api/borrows/:id/status", requireRoles(["teacher", "admin"]), async (req, res) => {
  if (mysqlStore.useMySql) {
    try {
      const record = await mysqlStore.getBorrowById(req.params.id);
      if (!record) {
        return notFound(res, "借用记录不存在");
      }

      const approvalRows = await mysqlStore.getApprovals({ type: "borrow" });
      const targetApproval = approvalRows.find((item) => Number(item.businessId) === Number(record.id));
      if (!targetApproval) {
        return badRequest(res, "未找到对应审批记录，请使用借用申请流程创建数据");
      }

      const nextStatus = req.body.status || record.status;
      if (!["approved", "rejected"].includes(nextStatus)) {
        return badRequest(res, "审批状态仅支持 approved 或 rejected");
      }

      const row = await mysqlStore.applyApprovalAction(targetApproval.id, nextStatus);
      const latest = await mysqlStore.getBorrowById(req.params.id);
      return ok(res, latest || row, "借用状态已更新");
    } catch (err) {
      return badRequest(res, err.message || "借用状态更新失败");
    }
  }

  const record = db.borrows.find((item) => item.id === Number(req.params.id));
  if (!record) {
    return notFound(res, "借用记录不存在");
  }

  const nextStatus = req.body.status || record.status;
  const result = setBorrowStatus(record, nextStatus);
  if (result.error) {
    return badRequest(res, result.error);
  }

  return ok(res, result.record, "借用状态已更新");
});

app.get("/api/consumable-applications", async (req, res) => {
  const { status, userId, consumableId, warehouseId, page, pageSize } = req.query;
  const statusList = normalizeStatusList(status);

  if (mysqlStore.useMySql) {
    try {
      let rows = await mysqlStore.getConsumableApplications();

      if (statusList.length) {
        rows = rows.filter((item) => statusList.includes(String(item.status || "")));
      }
      if (userId) {
        rows = rows.filter((item) => Number(item.userId) === Number(userId));
      }
      if (consumableId) {
        rows = rows.filter((item) => Number(item.consumableId) === Number(consumableId));
      }
      if (warehouseId) {
        rows = rows.filter((item) => Number(item.warehouseId) === Number(warehouseId));
      }

      const paged = buildPagedResult(rows, page, pageSize);
      return ok(res, paged);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  let data = db.consumableApplications.map((item) => {
    const consumable = db.consumables.find(
      (consumableItem) => consumableItem.id === Number(item.consumableId)
    );
    return {
      ...item,
      warehouseId: item.warehouseId ? Number(item.warehouseId) : 1,
      warehouseName: getWarehouseName(item.warehouseId || 1),
      applicantName: getUserName(item.userId),
      consumableName: consumable ? consumable.name : "未知耗材"
    };
  });

  if (statusList.length) {
    data = data.filter((item) => statusList.includes(String(item.status || "")));
  }
  if (userId) {
    data = data.filter((item) => Number(item.userId) === Number(userId));
  }
  if (consumableId) {
    data = data.filter((item) => Number(item.consumableId) === Number(consumableId));
  }
  if (warehouseId) {
    data = data.filter((item) => Number(item.warehouseId) === Number(warehouseId));
  }

  const paged = buildPagedResult(data, page, pageSize);
  ok(res, paged);
});

app.post("/api/consumable-applications", requireAuth, async (req, res) => {
  const payload = req.body || {};
  const safeUserId = Number(req.user.id);
  if (!payload.consumableId || !payload.quantity) {
    return badRequest(res, "申领参数不完整");
  }

  const warehouseId = payload.warehouseId ? Number(payload.warehouseId) : 1;

  if (mysqlStore.useMySql) {
    try {
      const warehouses = await mysqlStore.getWarehouses();
      const warehouse = warehouses.find((item) => Number(item.id) === Number(warehouseId));
      if (!warehouse) {
        return badRequest(res, "关联仓库不存在");
      }

      const record = await mysqlStore.createConsumableApplication({
        ...payload,
        userId: safeUserId,
        warehouseId
      });
      return res.status(201).json({ code: 0, message: "耗材申领已提交", data: attachAuditMeta(record, req) });
    } catch (err) {
      return badRequest(res, `数据库写入失败：${err.message}`);
    }
  }

  const warehouse = (db.warehouses || []).find((item) => Number(item.id) === Number(warehouseId));
  if (!warehouse) {
    return badRequest(res, "关联仓库不存在");
  }

  const record = createConsumableApplicationRecord({
    consumableId: payload.consumableId,
    warehouseId,
    userId: safeUserId,
    quantity: payload.quantity,
    purpose: payload.purpose || ""
  });

  return res.status(201).json({ code: 0, message: "耗材申领已提交", data: attachAuditMeta(record, req) });
});

app.patch("/api/consumable-applications/:id/status", requireRoles(["teacher", "admin"]), async (req, res) => {
  if (mysqlStore.useMySql) {
    try {
      const record = await mysqlStore.getConsumableApplicationById(req.params.id);
      if (!record) {
        return notFound(res, "申领记录不存在");
      }

      const approvalRows = await mysqlStore.getApprovals({ type: "consumable_application" });
      const targetApproval = approvalRows.find((item) => Number(item.businessId) === Number(record.id));
      if (!targetApproval) {
        return badRequest(res, "未找到对应审批记录，请使用申领申请流程创建数据");
      }

      const nextStatus = req.body.status || record.status;
      if (!["approved", "rejected"].includes(nextStatus)) {
        return badRequest(res, "审批状态仅支持 approved 或 rejected");
      }

      await mysqlStore.applyApprovalAction(targetApproval.id, nextStatus);
      const latest = await mysqlStore.getConsumableApplicationById(req.params.id);
      return ok(res, latest, "申领状态已更新");
    } catch (err) {
      return badRequest(res, err.message || "申领状态更新失败");
    }
  }

  const record = db.consumableApplications.find(
    (item) => item.id === Number(req.params.id)
  );
  if (!record) {
    return notFound(res, "申领记录不存在");
  }

  const nextStatus = req.body.status || record.status;
  const result = setConsumableApplicationStatus(record, nextStatus);
  if (result.error) {
    return badRequest(res, result.error);
  }

  return ok(res, result.record, "申领状态已更新");
});

app.get("/api/approvals", requireAuth, async (req, res) => {
  const { status, type, applicantId: applicantIdRaw, page, pageSize } = req.query;
  const statusList = normalizeStatusList(status);

  const applicantId = req.user.role === "student" ? Number(req.user.id) : applicantIdRaw;

  if (mysqlStore.useMySql) {
    try {
      const rows = await mysqlStore.getApprovals({ status: statusList[0] || "", type });
      let list = rows.map(mysqlStore.toApprovalView);

      if (statusList.length) {
        list = list.filter((item) => statusList.includes(String(item.status || "")));
      }
      if (applicantId) {
        list = list.filter((item) => Number(item.applicantId) === Number(applicantId));
      }

      const paged = buildPagedResult(list, page, pageSize);
      return ok(res, paged);
    } catch (err) {
      return badRequest(res, `数据库查询失败：${err.message}`);
    }
  }

  let list = [...db.approvals];

  if (statusList.length) {
    list = list.filter((item) => statusList.includes(String(item.status || "")));
  }

  if (type) {
    list = list.filter((item) => item.type === type);
  }

  if (applicantId) {
    list = list.filter((item) => Number(item.applicantId) === Number(applicantId));
  }

  const viewList = list.map(buildApprovalView);
  const paged = buildPagedResult(viewList, page, pageSize);
  ok(res, paged);
});

app.post("/api/approvals/:id/action", requireRoles(["teacher", "admin"]), async (req, res) => {
  const nextStatus = req.body.status;
  const remark = String((req.body && req.body.remark) || "").trim();
  if (!["approved", "rejected"].includes(nextStatus)) {
    return badRequest(res, "审批状态仅支持 approved 或 rejected");
  }

  if (mysqlStore.useMySql) {
    try {
      const row = await mysqlStore.applyApprovalAction(req.params.id, nextStatus, remark);
      if (!row) {
        return notFound(res, "审批记录不存在");
      }
      const view = mysqlStore.toApprovalView(row);
      if (view) {
        view.remark = remark;
      }
      return ok(res, attachAuditMeta(view, req), "审批已处理");
    } catch (err) {
      if (String(err.message || "").includes("审批记录不存在")) {
        return notFound(res, "审批记录不存在");
      }
      return badRequest(res, err.message || "审批失败");
    }
  }

  const approval = db.approvals.find((item) => item.id === Number(req.params.id));
  if (!approval) {
    return notFound(res, "审批记录不存在");
  }

  const result = applyApprovalAction(approval, nextStatus);
  if (result.error) {
    return badRequest(res, result.error);
  }

  approval.status = nextStatus;
  approval.remark = remark;
  approval.updatedAt = new Date().toISOString();

  syncApproval(approval.type, approval.businessId, nextStatus, remark);
  return ok(res, attachAuditMeta(buildApprovalView(approval), req), "审批已处理");
});

// AI 助手（MVP 规则引擎：库存分析 + 代提交借用/申领）
app.post("/api/ai/ask", (req, res) => {
  const payload = req.body || {};
  const question = String(payload.question || "").trim();

  if (!question) {
    return badRequest(res, "question 不能为空");
  }

  const userId = payload.userId ? Number(payload.userId) : 0;
  const warehouseId = payload.warehouseId ? Number(payload.warehouseId) : 1;

  const opResult = tryHandleAiUserOperation(question, userId, warehouseId);
  if (opResult && opResult.handled) {
    const refreshedAlerts = buildStockAlerts(warehouseId);
    const pendingApprovalsNow = db.approvals.filter((item) => item.status === "pending").length;

    return ok(res, {
      answer: opResult.message,
      pendingApprovals: pendingApprovalsNow,
      alerts: refreshedAlerts,
      operation: {
        handled: true,
        success: !!opResult.success,
        type: opResult.type,
        recordId: opResult.record ? opResult.record.id : null
      }
    });
  }

  const { low, surplus, normal } = buildStockAlerts(warehouseId);
  const pendingApprovals = db.approvals.filter((item) => item.status === "pending").length;
  const answer = buildAiAnswer(question);

  return ok(res, {
    answer,
    pendingApprovals,
    alerts: { low, surplus, normal },
    operation: {
      handled: false,
      success: false,
      type: null,
      recordId: null
    }
  });
});

app.use((err, req, res, next) => {
  if (String(err && err.message || "").includes("CORS origin not allowed")) {
    return res.status(403).json({ code: 403, message: "CORS origin forbidden" });
  }

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      type: "server_error",
      requestId: req.requestId || "",
      traceId: req.traceId || "",
      userId: req.user ? Number(req.user.id) : null,
      role: req.user ? req.user.role : null,
      method: req.method,
      path: req.originalUrl,
      message: err && err.message ? err.message : "unknown_error"
    })
  );

  return res.status(500).json({ code: 500, message: "服务异常" });
});

app.use((req, res) => {
  notFound(res, "接口不存在");
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Lab MVP backend running at http://localhost:${port}`);
  });
}

module.exports = app;
