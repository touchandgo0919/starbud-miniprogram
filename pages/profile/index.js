const api = require("../../services/api");
const { buildSharePayload } = require("../../utils/share");
const { clearSession, getSession } = require("../../utils/storage");

Page({
  data: {
    user: null,
    statusBarHeight: 24,
    navBarHeight: 68
  },

  onLoad() {
    const system = wx.getSystemInfoSync();
    const statusBarHeight = system.statusBarHeight || 24;
    this.setData({ statusBarHeight, navBarHeight: statusBarHeight + 44 });
    wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },

  onShareAppMessage() {
    return buildSharePayload("关于我们", "/pages/profile/index");
  },

  onShareTimeline() {
    return buildSharePayload("关于我们");
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || !["child", "parent"].includes(session.user.role)) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({ user: session.user });
  },

  logout() {
    wx.showModal({
      title: "退出登录？",
      content: "退出后需要重新输入儿童账号和密码。",
      confirmText: "退出",
      confirmColor: "#C74C57",
      async success(result) {
        if (!result.confirm) return;
        try {
          await api.logout();
        } catch (_) {
          // 即使断网，也允许用户在本机退出。
        }
        clearSession();
        wx.reLaunch({ url: "/pages/login/index" });
      }
    });
  }
});
