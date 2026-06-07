/**
 * Dry-run支持和错误处理
 * 提供安全的测试模式和完整的错误处理机制
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Dry-run执行器
 */
class DryRunExecutor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.outputPath = options.outputPath || './dry-run-results';
    this.detailedReport = options.detailedReport !== false;
    this.saveSnapshots = options.saveSnapshots !== false;
    this.logger = options.logger || console;
    this.results = [];
  }

  /**
   * 执行dry-run模式
   */
  async execute(operation, context, options = {}) {
    if (!this.enabled) {
      return { dryRun: false, skipped: true };
    }

    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      this.logger.info(`[DRY-RUN] 开始执行操作: ${operation.name}`);

      // 创建操作快照
      const snapshot = await this.createSnapshot(context, operation.name);

      // 执行操作（不修改实际数据）
      const result = await this.simulateOperation(operation, context, options);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // 创建变更预览
      const preview = this.createChangePreview(context, result, operation.name);

      const dryRunResult = {
        operationId,
        operationName: operation.name,
        timestamp: new Date().toISOString(),
        executionTime,
        snapshot,
        preview,
        result,
        dryRun: true
      };

      this.results.push(dryRunResult);

      // 保存详细报告
      if (this.detailedReport) {
        await this.saveDetailedReport(dryRunResult);
      }

      this.logger.info(`[DRY-RUN] 操作执行完成: ${operation.name}`, {
        executionTime,
        changes: preview.changes.length
      });

      return dryRunResult;

    } catch (error) {
      const errorResult = {
        operationId,
        operationName: operation.name,
        timestamp: new Date().toISOString(),
        error: error.message,
        dryRun: true,
        failed: true
      };

      this.results.push(errorResult);
      this.logger.error(`[DRY-RUN] 操作执行失败: ${operation.name}`, { error: error.message });

      throw error;
    }
  }

  /**
   * 模拟操作执行
   */
  async simulateOperation(operation, context, options) {
    // 创建数据的深拷贝以避免修改原始数据
    const clonedContext = this.deepClone(context);

    try {
      // 在克隆的数据上执行操作
      const result = await operation.execute(clonedContext, { ...options, dryRun: true });

      return {
        success: true,
        data: result,
        simulated: true
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        simulated: true
      };
    }
  }

  /**
   * 创建数据快照
   */
  async createSnapshot(context, operationName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshot = {
      timestamp,
      operationName,
      context: this.deepClone(context),
      checksum: this.generateChecksum(context)
    };

    if (this.saveSnapshots) {
      const snapshotPath = path.join(this.outputPath, 'snapshots', `snapshot_${timestamp}.json`);
      await this.saveToFile(snapshotPath, snapshot);
    }

    return snapshot;
  }

  /**
   * 创建变更预览
   */
  createChangePreview(originalContext, result, operationName) {
    const changes = [];

    if (result.success && result.data) {
      // 比较原始数据和结果数据
      const diffs = this.compareObjects(originalContext.data, result.data);

      diffs.forEach(diff => {
        changes.push({
          type: diff.type,
          path: diff.path,
          oldValue: diff.oldValue,
          newValue: diff.newValue,
          description: this.generateChangeDescription(diff)
        });
      });
    }

    return {
      operationName,
      timestamp: new Date().toISOString(),
      totalChanges: changes.length,
      changes
    };
  }

  /**
   * 比较两个对象并找出差异
   */
  compareObjects(oldObj, newObj, path = '') {
    const diffs = [];

    const allKeys = new Set([
      ...Object.keys(oldObj || {}),
      ...Object.keys(newObj || {})
    ]);

    for (const key of allKeys) {
      const currentPath = path ? `${path}.${key}` : key;
      const oldValue = oldObj?.[key];
      const newValue = newObj?.[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        if (typeof oldValue === 'object' && typeof newValue === 'object' &&
            oldValue !== null && newValue !== null) {
          // 递归比较嵌套对象
          diffs.push(...this.compareObjects(oldValue, newValue, currentPath));
        } else {
          diffs.push({
            type: this.getChangeType(oldValue, newValue),
            path: currentPath,
            oldValue,
            newValue
          });
        }
      }
    }

    return diffs;
  }

  /**
   * 获取变更类型
   */
  getChangeType(oldValue, newValue) {
    if (oldValue === undefined) return 'added';
    if (newValue === undefined) return 'removed';
    return 'modified';
  }

  /**
   * 生成变更描述
   */
  generateChangeDescription(diff) {
    switch (diff.type) {
      case 'added':
        return `添加了新的字段: ${diff.path} = ${JSON.stringify(diff.newValue)}`;
      case 'removed':
        return `删除了字段: ${diff.path} (原值: ${JSON.stringify(diff.oldValue)})`;
      case 'modified':
        return `修改了字段: ${diff.path} (从 ${JSON.stringify(diff.oldValue)} 改为 ${JSON.stringify(diff.newValue)})`;
      default:
        return `变更了字段: ${diff.path}`;
    }
  }

  /**
   * 保存详细报告
   */
  async saveDetailedReport(result) {
    const reportPath = path.join(this.outputPath, 'reports', `dry-run-report-${result.operationId}.json`);
    await this.saveToFile(reportPath, result);
  }

  /**
   * 生成执行摘要
   */
  generateSummary() {
    const totalOperations = this.results.length;
    const successfulOperations = this.results.filter(r => !r.failed).length;
    const failedOperations = totalOperations - successfulOperations;

    const totalChanges = this.results.reduce((sum, r) => {
      return sum + (r.preview?.totalChanges || 0);
    }, 0);

    return {
      totalOperations,
      successfulOperations,
      failedOperations,
      totalChanges,
      successRate: totalOperations > 0 ? (successfulOperations / totalOperations * 100).toFixed(2) + '%' : '0%',
      operations: this.results.map(r => ({
        operationId: r.operationId,
        operationName: r.operationName,
        success: !r.failed,
        changes: r.preview?.totalChanges || 0,
        executionTime: r.executionTime
      }))
    };
  }

  /**
   * 生成操作ID
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成校验和
   */
  generateChecksum(data) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * 深拷贝对象
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item));
    }

    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * 保存到文件
   */
  async saveToFile(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * 获取结果
   */
  getResults() {
    return this.results;
  }

  /**
   * 清除结果
   */
  clearResults() {
    this.results = [];
  }
}

/**
 * 错误处理器
 */
class ErrorHandler {
  constructor(options = {}) {
    this.logFile = options.logFile || './error.log';
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.logger = options.logger || console;
    this.errorLog = [];
  }

  /**
   * 处理错误
   */
  async handleError(error, context = {}) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      context,
      type: this.classifyError(error)
    };

    // 记录错误日志
    this.errorLog.push(errorInfo);
    await this.logError(errorInfo);

    // 根据错误类型采取不同的处理策略
    switch (errorInfo.type) {
      case 'validation':
        return this.handleValidationError(error, context);
      case 'network':
        return this.handleNetworkError(error, context);
      case 'file_system':
        return this.handleFileSystemError(error, context);
      case 'mapping':
        return this.handleMappingError(error, context);
      default:
        return this.handleGenericError(error, context);
    }
  }

  /**
   * 分类错误类型
   */
  classifyError(error) {
    const message = error.message.toLowerCase();

    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }

    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
      return 'network';
    }

    if (message.includes('file') || message.includes('directory') || message.includes('permission')) {
      return 'file_system';
    }

    if (message.includes('mapping') || message.includes('resource')) {
      return 'mapping';
    }

    return 'generic';
  }

  /**
   * 处理验证错误
   */
  async handleValidationError(error, context) {
    this.logger.error('验证错误', { error: error.message, context });

    return {
      recoverable: false,
      retry: false,
      suggestion: '请检查输入数据的格式和内容',
      details: {
        error: error.message,
        validationContext: context.validation
      }
    };
  }

  /**
   * 处理网络错误
   */
  async handleNetworkError(error, context) {
    this.logger.error('网络错误', { error: error.message, context });

    return {
      recoverable: true,
      retry: true,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
      suggestion: '请检查网络连接并重试',
      details: {
        error: error.message,
        networkContext: context.network
      }
    };
  }

  /**
   * 处理文件系统错误
   */
  async handleFileSystemError(error, context) {
    this.logger.error('文件系统错误', { error: error.message, context });

    return {
      recoverable: true,
      retry: false,
      suggestion: '请检查文件路径和权限',
      details: {
        error: error.message,
        fileContext: context.file
      }
    };
  }

  /**
   * 处理映射错误
   */
  async handleMappingError(error, context) {
    this.logger.error('映射错误', { error: error.message, context });

    return {
      recoverable: true,
      retry: false,
      suggestion: '请检查映射配置和资源名称',
      details: {
        error: error.message,
        mappingContext: context.mapping
      }
    };
  }

  /**
   * 处理通用错误
   */
  async handleGenericError(error, context) {
    this.logger.error('通用错误', { error: error.message, context });

    return {
      recoverable: false,
      retry: false,
      suggestion: '请联系技术支持',
      details: {
        error: error.message,
        context
      }
    };
  }

  /**
   * 重试操作
   */
  async retryOperation(operation, context, errorHandler) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.info(`重试操作，第${attempt}次尝试`);

        // 等待重试延迟
        if (attempt > 1) {
          await this.sleep(this.retryDelay);
        }

        const result = await operation(context);
        this.logger.info(`重试成功，第${attempt}次尝试`);
        return result;

      } catch (error) {
        lastError = error;
        this.logger.warn(`第${attempt}次尝试失败`, { error: error.message });

        // 检查是否应该继续重试
        const errorResult = await errorHandler(error, context);
        if (!errorResult.retry) {
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * 记录错误日志
   */
  async logError(errorInfo) {
    try {
      const logEntry = `[${errorInfo.timestamp}] ${errorInfo.type.toUpperCase()}: ${errorInfo.message}\n`;
      const stackTrace = errorInfo.stack ? `${errorInfo.stack}\n` : '';
      const contextInfo = `Context: ${JSON.stringify(errorInfo.context, null, 2)}\n`;

      const logContent = logEntry + stackTrace + contextInfo + '---\n';

      // 追加到日志文件
      const fs = require('fs').promises;
      await fs.appendFile(this.logFile, logContent, 'utf8');

    } catch (logError) {
      this.logger.error('记录错误日志失败', { error: logError.message });
    }
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const stats = {
      total: this.errorLog.length,
      byType: {},
      recent: this.errorLog.slice(-10)
    };

    this.errorLog.forEach(error => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
    });

    return stats;
  }

  /**
   * 清除错误日志
   */
  clearErrorLog() {
    this.errorLog = [];
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  DryRunExecutor,
  ErrorHandler
};