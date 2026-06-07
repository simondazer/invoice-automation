# Invoice Automation

一个面向个人报销场景的发票自动化工具。它可以从飞书/Lark 邮箱按日期拉取发票邮件，按执行时间输出本次增量结果，将最终发票图片按城市分组，并把 PDF/XML/OFD 等中间文件放到备份目录。同时提供附件幂等去重、开票信息配置、金额阈值校验、二维码开票入口探索等能力。

## 功能概览

- **邮箱发票拉取**：按日期读取发票相关邮件，下载 PDF/XML/OFD/图片附件或正文链接。
- **增量执行目录**：输出结构为 `日期/执行时间/城市`，每次执行只保存本次新增发票。
- **当天全局去重**：用 `processed_invoices.json` 记录当天已处理文件，重复执行不会复制旧结果。
- **最终图片输出**：最终目录只放图片；PDF/XML/OFD 等中间文件放 `_backup/城市`。
- **城市识别与校正**：优先从发票 XML、税局名称、商家地址、标题等信息识别城市。
- **开票信息配置**：支持配置发票抬头、可选税号、邮箱、手机号和最小开票金额阈值。
- **低金额拦截**：默认发票金额小于 `100` 时拒绝自动开票，提示人工介入。
- **二维码开票探索**：支持识别小票二维码并分析开票页面接口，真实提交前可做 dry-run。
- **资源映射工具**：保留早期 Schema 资源名映射相关工具，放在独立模块中。

## 目录结构

```text
invoice-automation/
├── README.md
├── package.json
├── .gitignore
├── config/
│   └── invoice.config.example.json      # 开票信息配置模板，不含真实个人信息
├── scripts/
│   └── invoice_mail_to_images.py        # 真实邮箱发票拉取与图片导出脚本
├── src/
│   ├── invoice/
│   │   ├── attachmentIdempotency.js     # 附件幂等 ID 和处理记录
│   │   ├── invoiceCityOrganizer.js      # 发票城市识别与归档
│   │   └── invoiceConfig.js             # 开票信息配置、校验、金额阈值
│   └── resource-mapping/
│       ├── csvParser.js
│       ├── dryRunAndErrorHandling.js
│       ├── handlerChain.js
│       ├── integrationConfig.js
│       └── resourceMappingHandler.js
└── examples/
    └── usageExamples.js
```

运行结果默认输出到：

```text
invoice-outputs/
```

该目录已加入 `.gitignore`，不会提交到 GitHub。

## 安装依赖

```bash
npm install
```

Python 脚本依赖系统命令：

- `lark-cli`：读取飞书/Lark 邮件
- `qlmanage`：macOS 内置，用于 PDF 转 PNG

## 开票信息配置

真实配置文件不要提交到 GitHub。先复制模板：

```bash
cp config/invoice.config.example.json invoice.config.json
```

然后编辑：

```text
invoice.config.json
```

示例：

```json
{
  "buyerName": "你的发票抬头或姓名",
  "buyerTaxNo": "",
  "buyerEmail": "your-email@example.com",
  "buyerMobile": "13800138000",
  "minInvoiceAmount": 100
}
```

字段说明：

| 字段 | 说明 | 是否必填 |
| --- | --- | --- |
| `buyerName` | 发票抬头，一般填名字或公司名 | 是 |
| `buyerTaxNo` | 纳税人识别号；个人抬头通常可空，企业抬头可能需要 | 按页面要求动态校验 |
| `buyerEmail` | 收票邮箱 | 建议填写 |
| `buyerMobile` | 收票手机号 | 部分开票页面必填 |
| `minInvoiceAmount` | 最小开票金额阈值，低于该值拒绝自动开票 | 默认 100 |

也可以用环境变量覆盖：

```bash
export INVOICE_BUYER_NAME="你的发票抬头"
export INVOICE_BUYER_TAX_NO=""
export INVOICE_BUYER_EMAIL="your-email@example.com"
export INVOICE_BUYER_MOBILE="13800138000"
export INVOICE_MIN_AMOUNT="100"
```

## 处理指定日期发票

在项目目录执行：

```bash
python3 scripts/invoice_mail_to_images.py --date 2026-06-07
```

或通过 npm script：

```bash
npm run invoices -- --date 2026-06-07
```

输出结构：

```text
invoice-outputs/
└── 2026-06-07/
    ├── processed_invoices.json
    └── 11-36-22/
        ├── 上海/
        │   └── xxx.png
        ├── _backup/
        │   └── 上海/
        │       ├── xxx.pdf
        │       └── xxx.xml
        └── manifest.json
```

规则：

- `2026-06-07` 是邮件日期。
- `11-36-22` 是本次执行时间，精确到时分秒。
- 城市目录中只放最终图片。
- `_backup` 中放 PDF/XML/OFD 等中间文件。
- 同一天重复执行只输出本次新增，旧发票只记录到 `skipped_downloads`。

## 金额阈值校验

自动开票前应调用金额校验：

```javascript
const { InvoiceConfigManager } = require('./src/invoice/invoiceConfig');

const manager = new InvoiceConfigManager();
const config = manager.load();
const amountCheck = manager.validateInvoiceAmount('47.21', config);

if (!amountCheck.allowed) {
  console.warn(amountCheck.message);
  // 不继续提交开票，交给人工介入重新开
  return;
}
```

低于阈值时返回：

```text
这张票不对，需要重新开：开票金额 47.21 小于最低阈值 100.00
```

## 二维码开票流程

小票二维码不是最终发票。正确流程是：

```text
识别二维码 -> 打开开票页面 -> 读取二维码上下文 -> 校验金额阈值 -> 填写开票信息 -> 提交开票 -> 发送到邮箱 -> 下一轮邮箱拉取正式发票
```

已探索出的票通接口包括：

```text
GET  /Aloe/tp/scan/getScanParameter.pt
POST /Aloe/tp/scan/saveInvoice.pt
POST /Aloe/tp/scan/sendSingleInvoiceEmail.pt
```

真实提交会向商家系统发起开票请求，接入时应先使用 dry-run 输出 payload，确认后再启用 submit。

## 运行示例

```bash
npm run examples
```

示例包括：

- CSV 映射解析
- Handler 链
- Dry-run 与错误处理
- 邮件附件幂等去重
- 发票城市归档
- 开票信息配置与金额阈值

## 上传 GitHub 注意事项

这些文件不会提交：

```text
invoice.config.json
invoice-outputs/
invoice-export-preview-*/
invoice-final-output-preview/
data/
logs/
reports/
```

检查忽略效果：

```bash
git status --ignored
```

## License

MIT
