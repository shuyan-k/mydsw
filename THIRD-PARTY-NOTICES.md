# 第三方组件与出处

本插件（`@c7sh8y9/mydsw` / 发行包 `mydsw-v1.0`）自身代码为原创实现。以下组件与资料来源一并列出。

## 1. `lib/sha3_wasm_bg.wasm`（26612 字节）

- 来源：npm 包 **`@rezaparsian/deepseek-pow-solver@1.0.1`**
- 仓库：<https://github.com/RezaParsian/DeepseekPowsolver>
- 许可证：**MIT**
- 用途：求解 DeepSeek 网页端的 `DeepSeekHashV1` proof-of-work 挑战。本插件只使用其中的 wasm 二进制，胶水代码（`lib/pow.js`）是按公开的 wasm ABI 自行重写为 ESM 的（没有复制原包的 `pow-solver.js`）。

MIT 许可证全文见文末。

## 2. 协议实现参考（未包含其代码）

| 来源 | 许可证 | 参考了什么 |
| --- | --- | --- |
| `deepseek-driver@0.1.0`（作者 Ferxa1，<https://github.com/ferxal/deepseek-driver>） | MIT | 网页端端点、请求头、PoW 载荷、SSE 补丁流的字段与路径语义 |
| OmniRoute PR #2295（DeepSeek web executor） | — | 端点与鉴权流程的交叉验证 |
| `dsh-deepseek-web-login`（npm，DSH 生态插件） | — | DSH 侧槽位/路由/客户端模块写法与若干踩坑 |

本插件的所有代码都是按上述公开行为**重新实现**的，没有直接复制粘贴上述项目的源码。

## 3. MIT License（适用于第 1 项组件）

```
MIT License

Copyright (c) RezaParsian and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 4. 免责声明

本插件通过**你自己的** chat.deepseek.com 登录态访问网页版接口，该接口并非官方公开 API，可能随时变化或被限制。
请自行遵守 DeepSeek 的服务条款，控制请求频率，不要用于批量/自动化滥用。因使用本插件产生的账号限制、数据或任何损失，作者不承担责任。
