const { API_BASE_URL } = require("../config");
const { clearSession, getSession } = require("./storage");

function redirectToLogin() {
  clearSession();
  wx.reLaunch({ url: "/pages/login/index" });
}

function errorMessage(body, statusCode) {
  return body && body.error ? body.error : `请求失败（${statusCode}）`;
}

function request(path, options = {}) {
  const session = getSession();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      data: options.data,
      timeout: 15000,
      header: {
        "content-type": "application/json",
        ...(session && session.token ? { authorization: `Bearer ${session.token}` } : {}),
        ...(options.header || {})
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (response.statusCode === 401) {
          redirectToLogin();
        }
        reject(new Error(errorMessage(response.data, response.statusCode)));
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络连接失败，请稍后重试。"));
      }
    });
  });
}

function upload(path, filePath) {
  const session = getSession();
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}${path}`,
      filePath,
      name: "photo",
      timeout: 30000,
      header: session && session.token
        ? { authorization: `Bearer ${session.token}` }
        : {},
      success(response) {
        let body = null;
        try {
          body = JSON.parse(response.data);
        } catch {
          reject(new Error("照片上传响应格式错误。"));
          return;
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body);
          return;
        }
        if (response.statusCode === 401) {
          redirectToLogin();
        }
        reject(new Error(errorMessage(body, response.statusCode)));
      },
      fail(error) {
        reject(new Error(error.errMsg || "照片上传失败，请稍后重试。"));
      }
    });
  });
}

function absoluteUrl(path) {
  if (!path || /^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

module.exports = {
  absoluteUrl,
  request,
  upload
};
