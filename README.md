# starbud-miniprogram

星星芽AI助手的原生微信小程序端。

## 职责

- 网页端：家长创建家庭、安排和维护任务。
- 电脑 App：安装在儿童电脑上，负责定时语音提醒。
- 微信小程序：儿童领取今日任务、拍照提交作业、查看提交记录。

小程序不提供任务创建、家庭管理或语音提醒设置。

## 本地开发

1. 使用微信开发者工具导入本目录。
2. 确认 `project.config.json` 中的 AppID。
3. 在微信公众平台把后端域名加入 `request`、`uploadFile` 和
   `downloadFile` 合法域名。
4. 如需切换后端地址，修改 `config.js`。
5. 运行静态检查：

```bash
npm run check
npm test
```

`npm test` 不依赖微信开发者工具：它会校验原生小程序配置，并通过 `wx` mock
覆盖登录鉴权、任务查询与领取、作业上传、错误处理和登录页行为。真实设备上的相机、
录音、通知和授权弹窗仍需在发布前使用微信开发者工具及真机验收。

## 后端依赖

照片保存在 Cloudflare R2 的 `starbud-submissions` 存储桶，元数据保存在
D1。首次部署前执行：

```bash
npx wrangler r2 bucket create starbud-submissions
cd ../starbud-backend
npm run d1:migrate:remote
npm run deploy
```

## 核心流程

1. 儿童账号登录。
2. 在“今日任务”领取任务。
3. 打开任务，拍照或从相册选择 1–8 张图片。
4. 创建提交单、逐张上传照片并确认提交。
5. 后端将当天任务标记为完成，并在“提交记录”中展示照片。

设计参考见 `docs/design-concept.png`。
