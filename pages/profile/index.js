const { clearSession, getSession } = require("../../utils/storage");

Page({
  data: {
    user: null
  },

  onShow() {
    const session = getSession();
    if (!session || !session.user || session.user.role !== "child") {
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
      success(result) {
        if (!result.confirm) return;
        clearSession();
        wx.reLaunch({ url: "/pages/login/index" });
      }
    });
  }
});
