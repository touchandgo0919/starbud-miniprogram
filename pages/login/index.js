const api = require("../../services/api");
const { getSession, setSession } = require("../../utils/storage");

Page({
  data: {
    mode: "login",
    username: "",
    displayName: "",
    password: "",
    confirmPassword: "",
    passwordVisible: false,
    agreementAccepted: false,
    submitting: false,
    error: ""
  },

  onLoad() {
    const session = getSession();
    if (session && session.token && session.user && ["child", "parent"].includes(session.user.role)) {
      wx.switchTab({ url: "/pages/home/index" });
    }
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value, error: "" });
  },

  onDisplayNameInput(event) {
    this.setData({ displayName: event.detail.value, error: "" });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value, error: "" });
  },

  onConfirmPasswordInput(event) {
    this.setData({ confirmPassword: event.detail.value, error: "" });
  },

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    this.setData({
      mode,
      password: "",
      confirmPassword: "",
      passwordVisible: false,
      error: ""
    });
  },

  togglePassword() {
    this.setData({ passwordVisible: !this.data.passwordVisible });
  },

  onAgreementChange(event) {
    this.setData({ agreementAccepted: event.detail.value.includes("accepted"), error: "" });
  },

  async submit() {
    const username = this.data.username.trim();
    const registering = this.data.mode === "register";
    const password = registering ? this.data.password.trim() : this.data.password;
    if (!username || !password) {
      this.setData({ error: "请输入用户名和密码。" });
      return;
    }
    if (registering && !/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
      this.setData({ error: "用户名需为 3-40 位字母、数字、点、横线或下划线。" });
      return;
    }
    if (registering && password.length < 6) {
      this.setData({ error: "密码至少需要 6 个字符。" });
      return;
    }
    if (registering && password !== this.data.confirmPassword.trim()) {
      this.setData({ error: "两次输入的密码不一致。" });
      return;
    }
    if (!this.data.agreementAccepted) {
      this.setData({ error: "请先阅读并同意《用户服务协议》和《隐私政策》。" });
      return;
    }

    this.setData({ submitting: true, error: "" });
    try {
      const result = registering
        ? await api.registerParent(username, this.data.displayName.trim(), password)
        : await api.login(username, password);
      if (result.user.role !== "child" && result.user.role !== "parent") {
        throw new Error("请使用家长或儿童账号登录。");
      }
      setSession(result);
      if (registering) {
        wx.showToast({ title: "注册成功", icon: "success" });
      }
      wx.switchTab({ url: "/pages/home/index" });
    } catch (error) {
      this.setData({
        error: !registering && error.statusCode === 401
          ? "用户名或密码错误。"
          : error.message || (registering ? "注册失败，请稍后重试。" : "登录失败，请稍后重试。")
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
