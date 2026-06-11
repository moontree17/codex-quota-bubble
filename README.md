# Codex Quota Bubble

一个 Windows 桌面小气泡，用来显示本机 Codex 额度。

## 功能

- 右下角常驻小气泡
- 显示 Codex 自带额度窗口，例如 `5H`、`1W`
- 显示剩余额度百分比
- 显示额度重置时间或日期
- 每 60 秒自动刷新
- 支持托盘菜单刷新和退出

## 使用要求

- Windows 10 / Windows 11
- 本机已安装并登录 Codex

## 安装使用

打开 Releases，下载最新的：

`Codex-Quota-Bubble-*-win-x64.exe`

双击运行即可。

第一次运行时 Windows 可能提示未知发布者，因为当前版本没有代码签名。

## 本地开发

```bash
npm install
npm start
```

## 打包

```bash
npm run build
```

打包产物会生成在 `dist/`。
