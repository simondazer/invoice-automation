/**
 * Schema资源名替换处理器
 * 支持默认映射和特殊规则映射
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

/**
 * 资源映射配置
 */
class ResourceMappingConfig {
  constructor(defaultMappingPath, specialMappingPath) {
    this.defaultMappingPath = defaultMappingPath;
    this.specialMappingPath = specialMappingPath;
    this.defaultMappings = new Map();
    this.specialMappings = new Map();
    this.logger = null;
  }

  /**
   * 设置日志记录器
   */
  setLogger(logger) {
    this.logger = logger;
  }

  /**
   * 记录日志
   */
  log(level, message, data = {}) {
    if (this.logger) {
      this.logger[level](message, data);
    } else {
      console[level] || console.log(`[${level}] ${message}`, data);
    }
  }

  /**
   * 加载CSV映射文件
   */
  async loadMappings() {
    try {
      this.log('info', '开始加载资源映射文件');

      // 加载默认映射
      if (fs.existsSync(this.defaultMappingPath)) {
        this.defaultMappings = await this.parseCSV(this.defaultMappingPath);
        this.log('info', `默认映射加载完成，共${this.defaultMappings.size}条记录`);
      } else {
        this.log('warn', `默认映射文件不存在: ${this.defaultMappingPath}`);
      }

      // 加载特殊映射
      if (fs.existsSync(this.specialMappingPath)) {
        this.specialMappings = await this.parseCSV(this.specialMappingPath);
        this.log('info', `特殊映射加载完成，共${this.specialMappings.size}条记录`);
      } else {
        this.log('warn', `特殊映射文件不存在: ${this.specialMappingPath}`);
      }

      return true;
    } catch (error) {
      this.log('error', '加载映射文件失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 解析CSV文件
   */
  async parseCSV(filePath) {
    const mappings = new Map();

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          // 假设CSV格式为: oldResourceName,newResourceName,schemaPattern(可选)
          const { oldResourceName, newResourceName, schemaPattern } = row;
          if (oldResourceName && newResourceName) {
            const key = schemaPattern ? `${schemaPattern}:${oldResourceName}` : oldResourceName;
            mappings.set(key, {
              oldName: oldResourceName,
              newName: newResourceName,
              schemaPattern: schemaPattern || null
            });
          }
        })
        .on('end', () => {
          resolve(mappings);
        })
        .on('error', reject);
    });
  }

  /**
   * 获取资源映射
   */
  getResourceMapping(resourceName, schemaType = null) {
    // 首先检查特殊映射
    if (schemaType) {
      const specialKey = `${schemaType}:${resourceName}`;
      if (this.specialMappings.has(specialKey)) {
        return this.specialMappings.get(specialKey);
      }
    }

    // 检查特殊映射中的通用规则（无schemaPattern）
    if (this.specialMappings.has(resourceName)) {
      return this.specialMappings.get(resourceName);
    }

    // 最后检查默认映射
    if (this.defaultMappings.has(resourceName)) {
      return this.defaultMappings.get(resourceName);
    }

    return null;
  }
}

/**
 * Schema资源名替换Handler
 */
class ResourceMappingHandler {
  constructor(config) {
    this.config = config;
    this.stats = {
      totalProcessed: 0,
      totalReplaced: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * 处理Schema数据
   */
  async processSchema(schemaData, options = {}) {
    const { dryRun = false, schemaType = null } = options;

    try {
      this.config.log('info', '开始处理Schema数据', {
        dryRun,
        schemaType,
        dataSize: JSON.stringify(schemaData).length
      });

      const processedData = this.deepReplace(schemaData, schemaType, dryRun);

      this.config.log('info', 'Schema数据处理完成', {
        stats: this.stats
      });

      return {
        success: true,
        data: processedData,
        stats: { ...this.stats }
      };
    } catch (error) {
      this.config.log('error', '处理Schema数据失败', { error: error.message });
      this.stats.errors++;

      return {
        success: false,
        error: error.message,
        stats: { ...this.stats }
      };
    }
  }

  /**
   * 深度替换资源名
   */
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
        // 检查键是否需要替换
        const keyMapping = this.config.getResourceMapping(key, schemaType);
        const newKey = keyMapping ? keyMapping.newName : key;

        if (keyMapping && key !== newKey) {
          this.stats.totalReplaced++;
          this.config.log('debug', `替换键名: ${key} -> ${newKey}`, { dryRun });
        }

        // 递归处理值
        processed[newKey] = this.deepReplace(value, schemaType, dryRun);
      }
      return processed;
    }

    // 处理字符串值
    if (typeof obj === 'string') {
      this.stats.totalProcessed++;
      const mapping = this.config.getResourceMapping(obj, schemaType);

      if (mapping && obj !== mapping.newName) {
        this.stats.totalReplaced++;
        this.config.log('debug', `替换资源名: ${obj} -> ${mapping.newName}`, {
          dryRun,
          schemaType
        });

        if (!dryRun) {
          return mapping.newName;
        }
      }
    }

    return obj;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      totalReplaced: 0,
      errors: 0,
      skipped: 0
    };
  }
}

/**
 * Handler链集成
 */
class HandlerChain {
  constructor() {
    this.handlers = [];
    this.logger = null;
  }

  /**
   * 添加处理器到链中
   */
  addHandler(handler) {
    this.handlers.push(handler);
    return this;
  }

  /**
   * 设置日志记录器
   */
  setLogger(logger) {
    this.logger = logger;
    return this;
  }

  /**
   * 执行处理链
   */
  async execute(context, options = {}) {
    let currentContext = context;

    for (const handler of this.handlers) {
      try {
        if (this.logger) {
          this.logger.info(`执行处理器: ${handler.constructor.name}`);
        }

        const result = await handler.process(currentContext, options);

        if (!result.success) {
          throw new Error(`处理器 ${handler.constructor.name} 执行失败: ${result.error}`);
        }

        currentContext = result.data || currentContext;
      } catch (error) {
        if (this.logger) {
          this.logger.error(`处理器链执行失败`, {
            handler: handler.constructor.name,
            error: error.message
          });
        }
        throw error;
      }
    }

    return currentContext;
  }
}

/**
 * 资源映射更新器
 * 集成到现有的updateRepo流程中
 */
class ResourceMappingUpdater {
  constructor(options = {}) {
    this.config = new ResourceMappingConfig(
      options.defaultMappingPath || './default_mapping.csv',
      options.specialMappingPath || './special_mapping.csv'
    );

    this.handler = new ResourceMappingHandler(this.config);
    this.handlerChain = new HandlerChain();
    this.logger = options.logger || null;

    if (this.logger) {
      this.config.setLogger(this.logger);
      this.handlerChain.setLogger(this.logger);
    }
  }

  /**
   * 初始化
   */
  async initialize() {
    try {
      this.logger?.info('初始化资源映射更新器');
      await this.config.loadMappings();
      return true;
    } catch (error) {
      this.logger?.error('初始化失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 添加到handler链
   */
  addToHandlerChain() {
    this.handlerChain.addHandler({
      process: async (context, options) => {
        return await this.handler.processSchema(context, options);
      }
    });
    return this.handlerChain;
  }

  /**
   * 更新仓库（集成到updateRepo流程）
   */
  async updateRepo(repoPath, options = {}) {
    const {
      dryRun = false,
      backup = true,
      schemaPattern = '**/*.schema.json',
      outputReport = true
    } = options;

    try {
      this.logger?.info('开始更新仓库资源映射', { repoPath, dryRun });

      // 初始化
      await this.initialize();

      // 查找schema文件
      const schemaFiles = await this.findSchemaFiles(repoPath, schemaPattern);
      this.logger?.info(`找到${schemaFiles.length}个schema文件`);

      const results = [];

      for (const filePath of schemaFiles) {
        try {
          this.logger?.info(`处理文件: ${filePath}`);

          // 读取schema文件
          const schemaData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

          // 备份原始文件
          if (backup && !dryRun) {
            const backupPath = `${filePath}.backup`;
            fs.copyFileSync(filePath, backupPath);
          }

          // 提取schema类型（根据文件路径或内容）
          const schemaType = this.extractSchemaType(filePath, schemaData);

          // 处理schema数据
          const result = await this.handler.processSchema(schemaData, {
            dryRun,
            schemaType
          });

          // 保存处理后的数据
          if (!dryRun && result.success) {
            fs.writeFileSync(filePath, JSON.stringify(result.data, null, 2));
          }

          results.push({
            file: filePath,
            success: result.success,
            stats: result.stats,
            error: result.error
          });

        } catch (error) {
          this.logger?.error(`处理文件失败: ${filePath}`, { error: error.message });
          results.push({
            file: filePath,
            success: false,
            error: error.message
          });
        }
      }

      // 生成报告
      if (outputReport) {
        await this.generateReport(results, dryRun);
      }

      return {
        success: true,
        results,
        summary: this.generateSummary(results)
      };

    } catch (error) {
      this.logger?.error('更新仓库失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 查找schema文件
   */
  async findSchemaFiles(repoPath, pattern) {
    const glob = require('glob');
    return new Promise((resolve, reject) => {
      glob(pattern, { cwd: repoPath }, (err, files) => {
        if (err) reject(err);
        else resolve(files.map(f => path.join(repoPath, f)));
      });
    });
  }

  /**
   * 提取schema类型
   */
  extractSchemaType(filePath, schemaData) {
    // 根据文件路径提取类型
    const pathParts = filePath.split(path.sep);
    const typeFromPath = pathParts[pathParts.length - 2]; // 假设倒数第二层目录是类型

    // 或者从schema数据中提取
    const typeFromData = schemaData.schemaType || schemaData.type || null;

    return typeFromData || typeFromPath || 'default';
  }

  /**
   * 生成报告
   */
  async generateReport(results, dryRun) {
    const reportPath = `./resource_mapping_report_${Date.now()}.csv`;
    const csvWriter = createObjectCsvWriter({
      path: reportPath,
      header: [
        { id: 'file', title: '文件路径' },
        { id: 'success', title: '处理状态' },
        { id: 'totalProcessed', title: '处理项数' },
        { id: 'totalReplaced', title: '替换项数' },
        { id: 'error', title: '错误信息' }
      ]
    });

    const records = results.map(r => ({
      file: r.file,
      success: r.success ? '成功' : '失败',
      totalProcessed: r.stats?.totalProcessed || 0,
      totalReplaced: r.stats?.totalReplaced || 0,
      error: r.error || ''
    }));

    await csvWriter.writeRecords(records);
    this.logger?.info(`报告已生成: ${reportPath}`);
  }

  /**
   * 生成摘要
   */
  generateSummary(results) {
    const total = results.length;
    const successful = results.filter(r => r.success).length;
    const failed = total - successful;

    const totalProcessed = results.reduce((sum, r) => sum + (r.stats?.totalProcessed || 0), 0);
    const totalReplaced = results.reduce((sum, r) => sum + (r.stats?.totalReplaced || 0), 0);

    return {
      totalFiles: total,
      successfulFiles: successful,
      failedFiles: failed,
      totalProcessed,
      totalReplaced,
      successRate: total > 0 ? (successful / total * 100).toFixed(2) + '%' : '0%'
    };
  }
}

module.exports = {
  ResourceMappingConfig,
  ResourceMappingHandler,
  HandlerChain,
  ResourceMappingUpdater
};