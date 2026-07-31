const { getSession } = require("./utils/storage");

App({
  globalData: {
    session: null
  },

  onLaunch() {
    this.globalData.session = getSession();
  },
});
