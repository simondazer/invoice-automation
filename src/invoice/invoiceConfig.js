const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'invoice.config.json');
const DEFAULT_MIN_INVOICE_AMOUNT = 100;

/**
 * 开票信息配置
 * 注意：这里承载个人/企业敏感信息，真实配置文件不要提交到 GitHub
 */
class InvoiceConfigManager {
  constructor(options = {}) {
    this.configPath = options.configPath || process.env.INVOICE_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  }

  /**
   * 读取开票配置，并用环境变量覆盖本地文件配置
   */
  load() {
    const fileConfig = this.loadFromFile();
    const envConfig = this.loadFromEnv();

    return this.normalize({
      ...fileConfig,
      ...envConfig
    });
  }

  loadFromFile() {
    if (!fs.existsSync(this.configPath)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (error) {
      throw new Error(`读取开票配置失败: ${this.configPath} - ${error.message}`);
    }
  }

  loadFromEnv() {
    const envConfig = {
      buyerName: process.env.INVOICE_BUYER_NAME,
      buyerTaxNo: process.env.INVOICE_BUYER_TAX_NO,
      buyerEmail: process.env.INVOICE_BUYER_EMAIL,
      buyerMobile: process.env.INVOICE_BUYER_MOBILE,
      minInvoiceAmount: process.env.INVOICE_MIN_AMOUNT
    };

    Object.keys(envConfig).forEach((key) => {
      if (envConfig[key] === undefined) {
        delete envConfig[key];
      }
    });

    return envConfig;
  }

  normalize(config) {
    const normalized = {
      buyerName: this.clean(config.buyerName),
      buyerTaxNo: this.clean(config.buyerTaxNo),
      buyerEmail: this.clean(config.buyerEmail),
      buyerMobile: this.clean(config.buyerMobile),
      minInvoiceAmount: this.normalizeAmount(config.minInvoiceAmount, DEFAULT_MIN_INVOICE_AMOUNT)
    };

    Object.keys(normalized).forEach((key) => {
      if (normalized[key] === '') {
        normalized[key] = null;
      }
    });

    return normalized;
  }

  /**
   * 校验开票配置
   * 默认只强校验发票抬头；邮箱、手机号、税号按页面要求动态决定是否必填
   */
  validate(config, requirements = {}) {
    const errors = [];
    const warnings = [];

    if (!config.buyerName) {
      errors.push('缺少发票抬头 buyerName');
    }

    if (requirements.requireTaxNo && !config.buyerTaxNo) {
      errors.push('当前发票类型要求填写纳税人识别号 buyerTaxNo');
    }

    if (requirements.requireEmail && !config.buyerEmail) {
      errors.push('当前开票页面要求填写邮箱 buyerEmail');
    }

    if (requirements.requireMobile && !config.buyerMobile) {
      errors.push('当前开票页面要求填写手机号 buyerMobile');
    }

    if (config.buyerEmail && !this.isValidEmail(config.buyerEmail)) {
      errors.push('邮箱格式不正确 buyerEmail');
    }

    if (config.buyerMobile && !this.isValidMobile(config.buyerMobile)) {
      errors.push('手机号格式不正确 buyerMobile');
    }

    if (!config.buyerTaxNo) {
      warnings.push('未配置纳税人识别号 buyerTaxNo；如果按个人抬头开票通常可以为空，如果按企业抬头可能需要填写');
    } else if (!this.isValidTaxNo(config.buyerTaxNo)) {
      warnings.push('纳税人识别号 buyerTaxNo 格式可能不正确，请确认是否为 6-20 位数字或大写字母');
    }

    if (!config.buyerEmail) {
      warnings.push('未配置邮箱 buyerEmail；如果希望商家开票后自动发到邮箱，建议填写');
    }

    if (!config.buyerMobile) {
      warnings.push('未配置手机号 buyerMobile；部分开票页面会要求必填');
    }

    if (!Number.isFinite(config.minInvoiceAmount) || config.minInvoiceAmount < 0) {
      errors.push('最小开票金额 minInvoiceAmount 必须是大于等于 0 的数字');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 校验开票金额是否达到阈值
   * 低于阈值时不应继续提交开票，交给人工介入重新开
   */
  validateInvoiceAmount(amount, config = {}) {
    const minInvoiceAmount = this.normalizeAmount(config.minInvoiceAmount, DEFAULT_MIN_INVOICE_AMOUNT);
    const invoiceAmount = this.normalizeAmount(amount, NaN);

    if (!Number.isFinite(invoiceAmount)) {
      return {
        allowed: false,
        level: 'error',
        amount,
        minInvoiceAmount,
        message: `无法识别开票金额: ${amount}`
      };
    }

    if (invoiceAmount < minInvoiceAmount) {
      return {
        allowed: false,
        level: 'warning',
        amount: invoiceAmount,
        minInvoiceAmount,
        message: `这张票不对，需要重新开：开票金额 ${invoiceAmount.toFixed(2)} 小于最低阈值 ${minInvoiceAmount.toFixed(2)}`
      };
    }

    return {
      allowed: true,
      level: 'info',
      amount: invoiceAmount,
      minInvoiceAmount,
      message: `开票金额 ${invoiceAmount.toFixed(2)} 满足最低阈值 ${minInvoiceAmount.toFixed(2)}`
    };
  }

  /**
   * 生成票通 saveInvoice.pt 所需的购买方字段
   */
  toBuyerPayload(config, requirements = {}) {
    const validation = this.validate(config, requirements);
    if (!validation.valid) {
      throw new Error(`开票配置不完整: ${validation.errors.join('; ')}`);
    }

    return {
      buyerName: config.buyerName || '',
      buyerTaxNo: config.buyerTaxNo || '',
      buyerEmail: config.buyerEmail || '',
      buyerMobile: config.buyerMobile || '',
      buyerAddress: '',
      buyerPhone: '',
      buyerBankName: '',
      buyerBankAccount: '',
      buyerHeader: config.buyerTaxNo ? '0' : '1'
    };
  }

  clean(value) {
    return String(value || '').trim();
  }

  normalizeAmount(value, fallback) {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }

    const normalized = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(normalized) ? normalized : fallback;
  }

  isValidEmail(value) {
    return /^[A-Za-z0-9._-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/.test(value);
  }

  isValidMobile(value) {
    return /^1[3-9]\d{9}$/.test(value);
  }

  isValidTaxNo(value) {
    return /^[0-9A-Z]{6,20}$/.test(value);
  }
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_MIN_INVOICE_AMOUNT,
  InvoiceConfigManager
};
