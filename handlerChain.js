/**
 * Handler链集成机制
 * 支持灵活的处理器链配置和执行
 */

const EventEmitter = require('events');

/**
 * 处理器接口
 */
class Handler {
  constructor(name, options = {}) {
    this.name = name;
    this.enabled = options.enabled !== false;
    this.priority = options.priority || 0;
    this.retryCount = options.retryCount || 0;
    this.timeout = options.timeout || 30000;
  }

  /**
   * 处理数据
   * @abstract
   */
  async process(context, options = {}) {
    throw new Error('Handler.process must be implemented');
  }

  /**
   * 验证处理器状态
   */
  validate() {
    return { valid: true, errors: [] };
  }

  /**
   * 获取处理器信息
   */
  getInfo() {
    return {
      name: this.name,
      enabled: this.enabled,
      priority: this.priority,
      retryCount: this.retryCount,
      timeout: this.timeout
    };
  }
}

/**
 * 资源映射处理器
 */
class ResourceMappingHandler extends Handler {
  constructor(mappingConfig, options = {}) {
    super('ResourceMappingHandler', options);
    this.config = mappingConfig;
    this.stats = {
      processed: 0,
      replaced: 0,
      errors: 0
    };
  }

  async process(context, options = {}) {
    const { dryRun = false, schemaType = null } = options;

    try {
      const processedData = this.deepReplace(context.data, schemaType, dryRun);

      return {
        success: true,
        data: processedData,
        stats: { ...this.stats },
        context: {
          ...context,
          data: processedData
        }
      };
    } catch (error) {
      this.stats.errors++;
      return {
        success: false,
        error: error.message,
        stats: { ...this.stats }
      };
    }
  }

  deepReplace(obj, schemaType, dryRun) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepReplace(item, schemaType, dryRun));
    }

    if (typeof obj === 'object') {
      const processed = {};
      for (const [key, value] of Object.entries(obj)) {
        const keyMapping = this.config.getResourceMapping(key, schemaType);
        const newKey = keyMapping ? keyMapping.newName : key;

        if (keyMapping && key !== newKey) {
          this.stats.replaced++;
        }

        processed[newKey] = this.deepReplace(value, schemaType, dryRun);
      }
      return processed;
    }

    if (typeof obj === 'string') {
      this.stats.processed++;
      const mapping = this.config.getResourceMapping(obj, schemaType);

      if (mapping && obj !== mapping.newName) {
        this.stats.replaced++;
        return dryRun ? obj : mapping.newName;
      }
    }

    return obj;
  }
}

/**
 * 验证处理器
 */
class ValidationHandler extends Handler {
  constructor(validationRules, options = {}) {
    super('ValidationHandler', options);
    this.rules = validationRules;
  }

  async process(context, options = {}) {
    try {
      const validationResults = this.validateData(context.data);

      return {
        success: validationResults.valid,
        data: context.data,
        validationResults,
        context: {
          ...context,
          validationResults
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateData(data) {
    const errors = [];
    const warnings = [];

    // 示例验证规则
    if (this.rules.requiredFields) {
      this.rules.requiredFields.forEach(field => {
        if (!data[field]) {
          errors.push(`缺少必填字段: ${field}`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

/**
 * 备份处理器
 */
class BackupHandler extends Handler {
  constructor(backupConfig, options = {}) {
    super('BackupHandler', options);
    this.backupConfig = {
      enabled: true,
      path: './backups',
      format: 'json',
      ...backupConfig
    };
  }

  async process(context, options = {}) {
    if (!this.backupConfig.enabled || options.dryRun) {
      return {
        success: true,
        data: context.data,
        context,
        backupSkipped: true
      };
    }

    try {
      const backupPath = await this.createBackup(context);

      return {
        success: true,
        data: context.data,
        context: {
          ...context,
          backupPath
        },
        backupPath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async createBackup(context) {
    const fs = require('fs').promises;
    const path = require('path');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup_${context.fileName || 'data'}_${timestamp}.${this.backupConfig.format}`;
    const backupPath = path.join(this.backupConfig.path, backupFileName);

    await fs.mkdir(this.backupConfig.path, { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(context.data, null, 2));

    return backupPath;
  }
}

/**
 * Handler链管理器
 */
class HandlerChainManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.handlers = new Map();
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0
    };
    this.logger = options.logger || console;
  }

  /**
   * 注册处理器
   */
  registerHandler(handler) {
    if (!(handler instanceof Handler)) {
      throw new Error('Handler must be an instance of Handler class');
    }

    this.handlers.set(handler.name, handler);
    this.logger.info(`处理器已注册: ${handler.name}`);
    return this;
  }

  /**
   * 注销处理器
   */
  unregisterHandler(handlerName) {
    const result = this.handlers.delete(handlerName);
    if (result) {
      this.logger.info(`处理器已注销: ${handlerName}`);
    }
    return result;
  }

  /**
   * 获取处理器
   */
  getHandler(handlerName) {
    return this.handlers.get(handlerName);
  }

  /**
   * 获取所有处理器
   */
  getAllHandlers() {
    return Array.from(this.handlers.values());
  }

  /**
   * 执行处理器链
   */
  async executeChain(handlerNames, context, options = {}) {
    const startTime = Date.now();
    const executionResults = [];

    try {
      this.emit('chainStart', { handlerNames, context, options });

      let currentContext = context;

      for (const handlerName of handlerNames) {
        const handler = this.handlers.get(handlerName);

        if (!handler) {
          throw new Error(`处理器未找到: ${handlerName}`);
        }

        if (!handler.enabled) {
          this.logger.warn(`处理器已禁用，跳过: ${handlerName}`);
          continue;
        }

        const handlerStartTime = Date.now();
        let result;

        try {
          this.emit('handlerStart', { handlerName, context: currentContext });

          // 执行处理器
          result = await this.executeHandlerWithTimeout(handler, currentContext, options);

          const handlerEndTime = Date.now();
          const executionTime = handlerEndTime - handlerStartTime;

          if (!result.success) {
            throw new Error(`处理器执行失败: ${handlerName} - ${result.error}`);
          }

          // 更新上下文
          currentContext = result.context || currentContext;

          executionResults.push({
            handlerName,
            success: true,
            executionTime,
            stats: result.stats,
            result
          });

          this.emit('handlerSuccess', { handlerName, result, executionTime });

        } catch (error) {
          const handlerEndTime = Date.now();
          const executionTime = handlerEndTime - handlerStartTime;

          executionResults.push({
            handlerName,
            success: false,
            executionTime,
            error: error.message
          });

          this.emit('handlerError', { handlerName, error: error.message, executionTime });

          if (!options.continueOnError) {
            throw error;
          }
        }
      }

      const totalExecutionTime = Date.now() - startTime;
      this.updateExecutionStats(totalExecutionTime, true);

      this.emit('chainSuccess', {
        handlerNames,
        executionResults,
        totalExecutionTime,
        finalContext: currentContext
      });

      return {
        success: true,
        context: currentContext,
        executionResults,
        totalExecutionTime
      };

    } catch (error) {
      const totalExecutionTime = Date.now() - startTime;
      this.updateExecutionStats(totalExecutionTime, false);

      this.emit('chainError', { handlerNames, error: error.message, executionResults });

      return {
        success: false,
        error: error.message,
        executionResults,
        totalExecutionTime
      };
    }
  }

  /**
   * 带超时控制的处理器执行
   */
  async executeHandlerWithTimeout(handler, context, options) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`处理器执行超时: ${handler.name} (${handler.timeout}ms)`));
      }, handler.timeout);

      handler.process(context, options)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * 更新执行统计
   */
  updateExecutionStats(executionTime, success) {
    this.executionStats.totalExecutions++;

    if (success) {
      this.executionStats.successfulExecutions++;
    } else {
      this.executionStats.failedExecutions++;
    }

    // 更新平均执行时间
    const totalTime = this.executionStats.averageExecutionTime * (this.executionStats.totalExecutions - 1) + executionTime;
    this.executionStats.averageExecutionTime = totalTime / this.executionStats.totalExecutions;
  }

  /**
   * 获取执行统计
   */
  getExecutionStats() {
    return {
      ...this.executionStats,
      successRate: this.executionStats.totalExecutions > 0
        ? (this.executionStats.successfulExecutions / this.executionStats.totalExecutions * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  /**
   * 验证所有处理器
   */
  validateAllHandlers() {
    const validationResults = {};

    for (const [name, handler] of this.handlers) {
      validationResults[name] = handler.validate();
    }

    return validationResults;
  }
}

/**
 * 预定义的处理器链配置
 */
const PredefinedChains = {
  /**
   * 标准处理链
   */
  STANDARD: ['ValidationHandler', 'BackupHandler', 'ResourceMappingHandler'],

  /**
   * 仅映射处理链
   */
  MAPPING_ONLY: ['ResourceMappingHandler'],

  /**
   * 安全处理链（包含验证和备份）
   */
  SAFE: ['ValidationHandler', 'BackupHandler', 'ResourceMappingHandler', 'ValidationHandler'],

  /**
   * 快速处理链（跳过验证和备份）
   */
  FAST: ['ResourceMappingHandler'],

  /**
   * 自定义处理链构建器
   */
  custom: (handlerNames) => handlerNames
};

/**
 * Handler链工厂
 */
class HandlerChainFactory {
  static createStandardChain(mappingConfig, validationRules, backupConfig, options = {}) {
    const manager = new HandlerChainManager(options);

    // 注册验证处理器
    if (validationRules) {
      manager.registerHandler(new ValidationHandler(validationRules, options.validationHandler));
    }

    // 注册备份处理器
    if (backupConfig) {
      manager.registerHandler(new BackupHandler(backupConfig, options.backupHandler));
    }

    // 注册资源映射处理器
    if (mappingConfig) {
      manager.registerHandler(new ResourceMappingHandler(mappingConfig, options.resourceMappingHandler));
    }

    return manager;
  }

  static createMappingOnlyChain(mappingConfig, options = {}) {
    const manager = new HandlerChainManager(options);
    manager.registerHandler(new ResourceMappingHandler(mappingConfig, options.resourceMappingHandler));
    return manager;
  }

  static createCustomChain(handlerConfigs, options = {}) {
    const manager = new HandlerChainManager(options);

    handlerConfigs.forEach(config => {
      let handler;

      switch (config.type) {
        case 'validation':
          handler = new ValidationHandler(config.rules, config.options);
          break;
        case 'backup':
          handler = new BackupHandler(config.config, config.options);
          break;
        case 'resourceMapping':
          handler = new ResourceMappingHandler(config.config, config.options);
          break;
        default:
          throw new Error(`未知的处理器类型: ${config.type}`);
      }

      manager.registerHandler(handler);
    });

    return manager;
  }
}

module.exports = {
  Handler,
  ResourceMappingHandler,
  ValidationHandler,
  BackupHandler,
  HandlerChainManager,
  PredefinedChains,
  HandlerChainFactory
};