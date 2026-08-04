const api = require("../../services/api");
const { getSession, setSession } = require("../../utils/storage");

Page({
  data: {
    username: "",
    password: "",
    passwordVisible: false,
    agreementAccepted: false,
    submitting: false,
    error: ""
  },

  onLoad() {
    const session = getSession();
    if (session && session.token && session.user && ["child", "parent"].includes(session.user.role)) {
      wx.switchTab({ url: "/pages/tasks/index" });
    }
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value, error: "" });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: "" });
  },

  togglePassword() {
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },

  onAgreementChange(event) {
    this.setData({ agreementAccepted: event.detail.value.includes("accepted"), error: "" });
  },

  async submit() {
    const username = this.data.username.trim();
    const password = this.data.password;
    if (!username || !password) {
      this.setData({ error: "请输入用户名和密码。" });
      return;
    }
    if (!this.data.agreementAccepted) {
      this.setData({ error: "请先阅读并同意《用户服务协议》和《隐私政策》。" });
      return;
    }

    this.setData({ submitting: true, error: "" });
    try {
      const result = await api.login(username, password);
      if (result.user.role !== "child" && result.user.role !== "parent") {
        throw new Error("请使用家长或儿童账号登录。");
      }
      setSession(result);
      wx.switchTab({ url: "/pages/tasks/index" });
    } catch (error) {
      this.setData({
        error: error.statusCode === 401
          ? "用户名或密码错误。"
          : error.message || "登录失败，请稍后重试。"
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
