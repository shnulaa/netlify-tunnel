# Netlify VLESS

这是一个基于 Netlify Functions 的 VLESS 代理服务。

## 配置

在 `functions/vless.js` 文件中，替换以下变量为你的实际值：

- `userID`: 你的 UUID
- `hostName`: 你的域名

## 部署

1. 安装依赖：

```bash
npm install
```

2. 本地测试：

```bash
netlify dev
```

3. 部署到 Netlify：

```bash
netlify deploy --prod
```

## 连接地址

部署成功后，你可以访问以下 URL 获取 VLESS 配置信息和连接地址：

```
https://<your-netlify-domain>/vless
```

将 `<your-netlify-domain>` 替换为你的 Netlify 域名。

## 示例

假设你的 Netlify 域名是 `tunnel-liuyq.netlify.app`，你可以访问以下 URL 获取 VLESS 配置信息：

```
https://tunnel-liuyq.netlify.app/vless
```
