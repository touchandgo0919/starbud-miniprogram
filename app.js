const { getSession } = require("./utils/storage");
const api = require("./services/api");

App({
  globalData: {
    session: null
  },

  onLaunch() {
    this.globalData.session = getSession();
  },

  onShow(options) {
    void api.trackAccessEvent("page_view", {
      route: options && options.path ? `/${options.path.replace(/^\//, "")}` : "/"
    });
  }
});
