const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 邮件附件幂等记录存储
 * 用本地JSON文件保存已处理附件ID，适合同一天内多次重复执行时去重
 */
class AttachmentIdempotencyStore {
  constructor(options = {}) {
    this.storePath = options.storePath || './data/processed-attachments.json';
    this.logger = options.logger || console;
    this.records = new Map();
    this.loaded = false;
  }

  /**
   * 加载本地幂等记录
   */
  load() {
    if (this.loaded) {
      return this;
    }

    if (!fs.existsSync(this.storePath)) {
      this.records = new Map();
      this.loaded = true;
      return this;
    }

    try {
      const content = fs.readFileSync(this.storePath, 'utf8');
      const data = JSON.parse(content || '{}');
      const records = data.records || {};

      this.records = new Map(Object.entries(records));
      this.loaded = true;
      return this;
    } catch (error) {
      throw new Error(`加载附件幂等记录失败: ${this.storePath} - ${error.message}`);
    }
  }

  /**
   * 判断附件是否已经处理过
   */
  has(idempotencyId) {
    this.load();
    return this.records.has(idempotencyId);
  }

  /**
   * 获取附件处理记录
   */
  get(idempotencyId) {
    this.load();
    return this.records.get(idempotencyId) || null;
  }

  /**
   * 标记附件已处理
   */
  markProcessed(idempotencyId, metadata = {}) {
    this.load();

    this.records.set(idempotencyId, {
      idempotencyId,
      processedAt: new Date().toISOString(),
      ...metadata
    });

    this.save();
    return this.records.get(idempotencyId);
  }

  /**
   * 保存幂等记录到本地文件
   */
  save() {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });

    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: Object.fromEntries(this.records)
    };

    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 清理超过指定天数的历史记录
   */
  prune(maxAgeDays = 30) {
    this.load();

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [id, record] of this.records.entries()) {
      const processedAt = new Date(record.processedAt).getTime();
      if (Number.isFinite(processedAt) && processedAt < cutoff) {
        this.records.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.save();
    }

    this.logger.info?.(`附件幂等记录清理完成，删除${removed}条记录`);
    return removed;
  }

  /**
   * 获取存储状态
   */
  getStats() {
    this.load();

    return {
      storePath: this.storePath,
      totalRecords: this.records.size
    };
  }
}

/**
 * 邮件附件幂等管理器
 */
class AttachmentIdempotencyManager {
  constructor(options = {}) {
    this.store = options.store || new AttachmentIdempotencyStore(options);
    this.includeContentHash = options.includeContentHash !== false;
    this.hashAlgorithm = options.hashAlgorithm || 'sha256';
    this.logger = options.logger || console;
  }

  /**
   * 生成附件唯一ID
   * 优先组合稳定元信息；如果提供本地文件路径或Buffer，则叠加内容hash降低碰撞风险
   */
  generateId(attachment, mail = {}) {
    const parts = [
      this.normalize(mail.messageId || mail.id || mail.uid || ''),
      this.normalize(mail.date || mail.receivedAt || ''),
      this.normalize(mail.from || mail.sender || ''),
      this.normalize(mail.subject || ''),
      this.normalize(attachment.attachmentId || attachment.id || attachment.contentId || ''),
      this.normalize(attachment.filename || attachment.name || ''),
      this.normalize(attachment.size || attachment.length || ''),
      this.normalize(attachment.contentType || attachment.mimeType || '')
    ];

    if (this.includeContentHash) {
      const contentHash = this.getAttachmentContentHash(attachment);
      if (contentHash) {
        parts.push(contentHash);
      }
    }

    return this.hash(parts.join('|'));
  }

  /**
   * 过滤出未处理附件
   */
  filterUnprocessed(attachments, mail = {}) {
    const skipped = [];
    const pending = [];

    attachments.forEach((attachment) => {
      const idempotencyId = this.generateId(attachment, mail);
      const record = this.store.get(idempotencyId);
      const item = {
        ...attachment,
        idempotencyId
      };

      if (record) {
        skipped.push({
          ...item,
          processedRecord: record
        });
      } else {
        pending.push(item);
      }
    });

    return {
      pending,
      skipped,
      total: attachments.length
    };
  }

  /**
   * 幂等执行附件处理函数
   * 只有处理函数执行成功后才写入已处理记录
   */
  async processAttachment(attachment, mail, processor) {
    const idempotencyId = attachment.idempotencyId || this.generateId(attachment, mail);
    const processedRecord = this.store.get(idempotencyId);

    if (processedRecord) {
      this.logger.info?.(`跳过已处理附件: ${attachment.filename || attachment.name || idempotencyId}`);
      return {
        skipped: true,
        idempotencyId,
        processedRecord
      };
    }

    const result = await processor({
      ...attachment,
      idempotencyId
    }, mail);

    const record = this.store.markProcessed(idempotencyId, {
      mail: this.pickMailMetadata(mail),
      attachment: this.pickAttachmentMetadata(attachment),
      result
    });

    return {
      skipped: false,
      idempotencyId,
      record,
      result
    };
  }

  /**
   * 批量幂等处理附件
   */
  async processAttachments(attachments, mail, processor) {
    const results = [];

    for (const attachment of attachments) {
      const result = await this.processAttachment(attachment, mail, processor);
      results.push(result);
    }

    return {
      total: attachments.length,
      processed: results.filter(result => !result.skipped).length,
      skipped: results.filter(result => result.skipped).length,
      results
    };
  }

  getAttachmentContentHash(attachment) {
    if (attachment.content) {
      return this.hashBuffer(Buffer.isBuffer(attachment.content)
        ? attachment.content
        : Buffer.from(String(attachment.content)));
    }

    const filePath = attachment.path || attachment.filePath;
    if (filePath && fs.existsSync(filePath)) {
      return this.hashBuffer(fs.readFileSync(filePath));
    }

    return null;
  }

  pickMailMetadata(mail) {
    return {
      messageId: mail.messageId || mail.id || mail.uid || null,
      date: mail.date || mail.receivedAt || null,
      from: mail.from || mail.sender || null,
      subject: mail.subject || null
    };
  }

  pickAttachmentMetadata(attachment) {
    return {
      attachmentId: attachment.attachmentId || attachment.id || attachment.contentId || null,
      filename: attachment.filename || attachment.name || null,
      size: attachment.size || attachment.length || null,
      contentType: attachment.contentType || attachment.mimeType || null
    };
  }

  normalize(value) {
    return String(value ?? '').trim();
  }

  hash(value) {
    return crypto.createHash(this.hashAlgorithm).update(value).digest('hex');
  }

  hashBuffer(buffer) {
    return crypto.createHash(this.hashAlgorithm).update(buffer).digest('hex');
  }
}

module.exports = {
  AttachmentIdempotencyStore,
  AttachmentIdempotencyManager
};
