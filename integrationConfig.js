/**
 * 集成配置文件
 * 展示如何将整个资源映射系统集成到现有系统中
 */

const { ResourceMappingConfig, ResourceMappingUpdater } = require('./resourceMappingHandler');
const { ResourceMappingCSVParser, MappingCacheManager } = require('./csvParser');
const { HandlerChainFactory, PredefinedChains } = require('./handlerChain');
const { DryRunExecutor, ErrorHandler } = require('./dryRunAndErrorHandling');

/**
 * 集成配置类
 */
class IntegrationConfig {
  constructor(options = {}) {
    this.options = {
      // 默认配置
      dryRun: false,
      backup: true,
      validate: true,
      cache: true,
      logging: true,

      // 路径配置
      defaultMappingPath: './config/default_mapping.csv',
      specialMappingPath: './config/special_mapping.csv',
      backupPath: './backups',
      logPath: './logs',
      reportPath: './reports',

      // 性能配置
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000,
      cacheSize: 1000,
      cacheTTL: 3600000,

      // 扩展配置
      customHandlers: [],
      validationRules: {},

      ...options
    };

    this.logger = this.createLogger();
    this.cacheManager = this.createCacheManager();
    this.errorHandler = this.createErrorHandler();
    this.dryRunExecutor = this.createDryRunExecutor();
  }

  /**
   * 创建日志记录器
   */
  createLogger() {
    if (!this.options.logging) {
      return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      };
    }

    const winston = require('winston');

    return winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(this.options.logPath, 'error.log'),
          level: 'error'
        }),
        new winston.transports.File({
          filename: path.join(this.options.logPath, 'combined.log')
        }),
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
  }

  /**
   * 创建缓存管理器
   */
  createCacheManager() {
    if (!this.options.cache) {
      return null;
    }

    return new MappingCacheManager({
      maxSize: this.options.cacheSize,
      ttl: this.options.cacheTTL,
      logger: this.logger
    });
  }

  /**
   * 创建错误处理器
   */
  createErrorHandler() {
    return new ErrorHandler({
      logFile: path.join(this.options.logPath, 'error.log'),
      maxRetries: this.options.maxRetries,
      retryDelay: this.options.retryDelay,
      logger: this.logger
    });
  }

  /**
   * 创建dry-run执行器
   */
  createDryRunExecutor() {
    return new DryRunExecutor({
      enabled: this.options.dryRun,
      outputPath: this.options.reportPath,
      detailedReport: true,
      saveSnapshots: true,
      logger: this.logger
    });
  }

  /**
   * 创建资源映射配置
   */
  createMappingConfig() {
    const config = new ResourceMappingConfig(
      this.options.defaultMappingPath,
      this.options.specialMappingPath
    );

    config.setLogger(this.logger);
    return config;
  }

  /**
   * 创建CSV解析器
   */
  createCSVParser() {
    return new ResourceMappingCSVParser({
      logger: this.logger
    });
  }

  /**
   * 创建处理器链
   */
  createHandlerChain(mappingConfig) {
    const chainOptions = {
      logger: this.logger,
      validationHandler: {
        enabled: this.options.validate,
        priority: 1
      },
      backupHandler: {
        enabled: this.options.backup,
        priority: 2,
        path: this.options.backupPath
      },
      resourceMappingHandler: {
        enabled: true,
        priority: 3
      }
    };

    // 创建标准处理器链
    const chainManager = HandlerChainFactory.createStandardChain(
      mappingConfig,
      this.options.validationRules,
      { enabled: this.options.backup, path: this.options.backupPath },
      chainOptions
    );

    // 添加自定义处理器
    this.options.customHandlers.forEach(handlerConfig => {
      const HandlerClass = require(handlerConfig.classPath);
      const handler = new HandlerClass(handlerConfig.options);
      chainManager.registerHandler(handler);
    });

    return chainManager;
  }

  /**
   * 创建资源映射更新器
   */
  createResourceMappingUpdater() {
    return new ResourceMappingUpdater({
      defaultMappingPath: this.options.defaultMappingPath,
      specialMappingPath: this.options.specialMappingPath,
      logger: this.logger
    });
  }

  /**
   * 初始化系统
   */
  async initialize() {
    try {
      this.logger.info('开始初始化资源映射系统');

      // 创建必要的目录
      await this.createDirectories();

      // 验证配置文件
      await this.validateConfiguration();

      // 创建核心组件
      this.mappingConfig = this.createMappingConfig();
      this.csvParser = this.createCSVParser();
      this.handlerChain = this.createHandlerChain(this.mappingConfig);
      this.updater = this.createResourceMappingUpdater();

      // 加载映射配置
      await this.mappingConfig.loadMappings();

      this.logger.info('资源映射系统初始化完成');
      return true;

    } catch (error) {
      this.logger.error('系统初始化失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 创建必要的目录
   */
  async createDirectories() {
    const fs = require('fs').promises;
    const path = require('path');

    const directories = [
      this.options.backupPath,
      this.options.logPath,
      this.options.reportPath,
      path.dirname(this.options.defaultMappingPath),
      path.dirname(this.options.specialMappingPath)
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        // 忽略已存在的目录错误
      }
    }
  }

  /**
   * 验证配置
   */
  async validateConfiguration() {
    const fs = require('fs').promises;

    // 检查映射文件是否存在
    const checkFile = async (filePath, description) => {
      try {
        await fs.access(filePath);
        this.logger.info(`${description}文件存在: ${filePath}`);
      } catch (error) {
        this.logger.warn(`${description}文件不存在，将创建示例文件: ${filePath}`);
        await this.createSampleMappingFile(filePath, description);
      }
    };

    await checkFile(this.options.defaultMappingPath, '默认映射');
    await checkFile(this.options.specialMappingPath, '特殊映射');
  }

  /**
   * 创建示例映射文件
   */
  async createSampleMappingFile(filePath, type) {
    const fs = require('fs').promises;

    let content = '';
    if (type === '默认映射') {
      content = `oldResourceName,newResourceName
resource1,newResource1
resource2,newResource2
resource3,newResource3`;
    } else {
      content = `oldResourceName,newResourceName,schemaPattern
specialResource1,newSpecialResource1,userSchema
specialResource2,newSpecialResource2,productSchema
adminResource,newAdminResource,adminSchema`;
    }

    await fs.writeFile(filePath, content, 'utf8');
    this.logger.info(`创建示例${type}文件: ${filePath}`);
  }

  /**
   * 执行资源映射更新
   */
  async updateRepository(repoPath, options = {}) {
    const updateOptions = {
      dryRun: this.options.dryRun,
      backup: this.options.backup,
      schemaPattern: '**/*.schema.json',
      outputReport: true,
      ...options
    };

    try {
      this.logger.info('开始更新仓库资源映射', { repoPath, ...updateOptions });

      // 执行更新
      const result = await this.updater.updateRepo(repoPath, updateOptions);

      // 生成报告
      if (result.success) {
        this.logger.info('仓库更新完成', { summary: result.summary });
      } else {
        this.logger.error('仓库更新失败', { error: result.error });
      }

      return result;

    } catch (error) {
      this.logger.error('仓库更新过程出错', { error: error.message });
      throw error;
    }
  }

  /**
   * 执行处理器链
   */
  async executeHandlerChain(handlerNames, context, options = {}) {
    try {
      this.logger.info('开始执行处理器链', { handlers: handlerNames });

      const result = await this.handlerChain.executeChain(
        handlerNames,
        context,
        { ...options, dryRun: this.options.dryRun }
      );

      if (result.success) {
        this.logger.info('处理器链执行完成', {
          executionTime: result.totalExecutionTime,
          results: result.executionResults
        });
      } else {
        this.logger.error('处理器链执行失败', { error: result.error });
      }

      return result;

    } catch (error) {
      this.logger.error('处理器链执行出错', { error: error.message });
      throw error;
    }
  }

  /**
   * 执行dry-run测试
   */
  async performDryRun(operation, context) {
    try {
      this.logger.info('开始执行dry-run测试');

      const result = await this.dryRunExecutor.execute(operation, context);
      const summary = this.dryRunExecutor.generateSummary();

      this.logger.info('Dry-run测试完成', { summary });
      return { result, summary };

    } catch (error) {
      this.logger.error('Dry-run测试失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 获取系统状态
   */
  getSystemStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      configuration: {
        dryRun: this.options.dryRun,
        backup: this.options.backup,
        validate: this.options.validate,
        cache: this.options.cache
      },
      components: {
        cache: this.cacheManager ? this.cacheManager.getStats() : null,
        handlerChain: this.handlerChain ? this.handlerChain.getExecutionStats() : null,
        errorHandler: this.errorHandler ? this.errorHandler.getErrorStats() : null
      }
    };

    return status;
  }

  /**
   * 清理系统资源
   */
  async cleanup() {
    try {
      this.logger.info('开始清理系统资源');

      // 清理缓存
      if (this.cacheManager) {
        this.cacheManager.clear();
      }

      // 清理dry-run结果
      if (this.options.dryRun) {
        this.dryRunExecutor.clearResults();
      }

      this.logger.info('系统资源清理完成');

    } catch (error) {
      this.logger.error('清理系统资源失败', { error: error.message });
    }
  }

  /**
   * 获取配置模板
   */
  static getConfigurationTemplate() {
    return {
      // 基本配置
      dryRun: false,
      backup: true,
      validate: true,
      cache: true,
      logging: true,

      // 路径配置
      defaultMappingPath: './config/default_mapping.csv',
      specialMappingPath: './config/special_mapping.csv',
      backupPath: './backups',
      logPath: './logs',
      reportPath: './reports',

      // 性能配置
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000,
      cacheSize: 1000,
      cacheTTL: 3600000,

      // 验证规则
      validationRules: {
        requiredFields: ['type', 'version'],
        schemaValidation: true,
        resourceNameValidation: true
      },

      // 自定义处理器
      customHandlers: [
        // {
        //   classPath: './custom/MyCustomHandler',
        //   options: { priority: 4 }
        // }
      ]
    };
  }
}

/**
 * 预定义的集成配置
 */
const PredefinedIntegrationConfigs = {
  /**
   * 开发环境配置
   */
  DEVELOPMENT: {
    dryRun: true,
    backup: true,
    validate: true,
    cache: false,
    logging: true,
    maxRetries: 1,
    timeout: 10000
  },

  /**
   * 测试环境配置
   */
  TESTING: {
    dryRun: true,
    backup: true,
    validate: true,
    cache: true,
    logging: true,
    maxRetries: 2,
    timeout: 20000
  },

  /**
   * 生产环境配置
   */
  PRODUCTION: {
    dryRun: false,
    backup: true,
    validate: true,
    cache: true,
    logging: true,
    maxRetries: 3,
    timeout: 30000,
    cacheSize: 2000,
    cacheTTL: 7200000
  },

  /**
   * 高性能配置
   */
  HIGH_PERFORMANCE: {
    dryRun: false,
    backup: false,
    validate: false,
    cache: true,
    logging: false,
    maxRetries: 1,
    timeout: 5000,
    cacheSize: 5000,
    cacheTTL: 3600000
  },

  /**
   * 安全优先配置
   */
  SECURITY_FIRST: {
    dryRun: true,
    backup: true,
    validate: true,
    cache: false,
    logging: true,
    maxRetries: 5,
    timeout: 60000
  }
};

/**
 * 集成配置工厂
 */
class IntegrationConfigFactory {
  static createConfig(environment = 'development', customOptions = {}) {
    const baseConfig = PredefinedIntegrationConfigs[environment.toUpperCase()];

    if (!baseConfig) {
      throw new Error(`未知的环境配置: ${environment}`);
    }

    return new IntegrationConfig({
      ...baseConfig,
      ...customOptions
    });
  }

  static createCustomConfig(options = {}) {
    return new IntegrationConfig(options);
  }
}

/**
 * 使用示例
 */
async function integrationExample() {
  try {
    // 1. 使用预定义配置
    const devConfig = IntegrationConfigFactory.createConfig('development');
    await devConfig.initialize();

    // 2. 执行更新
    const result = await devConfig.updateRepository('./my-repo');
    console.log('更新结果:', result);

    // 3. 获取系统状态
    const status = devConfig.getSystemStatus();
    console.log('系统状态:', status);

    // 4. 清理资源
    await devConfig.cleanup();

  } catch (error) {
    console.error('集成示例失败:', error.message);
  }
}

module.exports = {
  IntegrationConfig,
  PredefinedIntegrationConfigs,
  IntegrationConfigFactory,
  integrationExample
};