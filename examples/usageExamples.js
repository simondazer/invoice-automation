/**
 * 资源映射处理系统 - 使用示例
 * 展示如何集成和使用整个资源名替换系统
 */

const { ResourceMappingConfig, ResourceMappingHandler, ResourceMappingUpdater } = require('../src/resource-mapping/resourceMappingHandler');
const { CSVParser, ResourceMappingCSVParser } = require('../src/resource-mapping/csvParser');
const { HandlerChainManager, PredefinedChains, HandlerChainFactory } = require('../src/resource-mapping/handlerChain');
const { DryRunExecutor, ErrorHandler } = require('../src/resource-mapping/dryRunAndErrorHandling');
const { AttachmentIdempotencyManager } = require('../src/invoice/attachmentIdempotency');
const { InvoiceCityOrganizer } = require('../src/invoice/invoiceCityOrganizer');
const { InvoiceConfigManager } = require('../src/invoice/invoiceConfig');

/**
 * 示例1: 基本使用
 */
async function basicUsageExample() {
  console.log('=== 基本使用示例 ===');

  try {
    // 1. 创建配置
    const config = new ResourceMappingConfig(
      './default_mapping.csv',
      './special_mapping.csv'
    );

    // 2. 加载映射
    await config.loadMappings();

    // 3. 创建处理器
    const handler = new ResourceMappingHandler(config);

    // 4. 示例Schema数据
    const schemaData = {
      type: 'userSchema',
      resources: {
        oldResource1: 'value1',
        oldResource2: 'value2',
        nested: {
          oldResource3: 'value3'
        }
      },
      array: ['oldResource4', 'oldResource5']
    };

    // 5. 处理数据
    const result = await handler.processSchema(schemaData, {
      dryRun: false,
      schemaType: 'userSchema'
    });

    console.log('处理结果:', {
      success: result.success,
      stats: result.stats,
      data: result.data
    });

  } catch (error) {
    console.error('基本使用示例失败:', error.message);
  }
}

/**
 * 示例2: CSV解析和使用
 */
async function csvParsingExample() {
  console.log('=== CSV解析示例 ===');

  try {
    // 创建CSV解析器
    const csvParser = new ResourceMappingCSVParser({
      logger: console
    });

    // 创建示例CSV文件
    await createSampleCSVFiles();

    // 解析默认映射
    const defaultMappings = await csvParser.parseDefaultMapping('./default_mapping.csv');
    console.log('默认映射数量:', defaultMappings.size);

    // 解析特殊映射
    const specialMappings = await csvParser.parseSpecialMapping('./special_mapping.csv');
    console.log('特殊映射数量:', specialMappings.size);

    // 验证映射
    const validationResult = csvParser.validateMapping(defaultMappings, 'default');
    console.log('映射验证结果:', validationResult);

  } catch (error) {
    console.error('CSV解析示例失败:', error.message);
  }
}

/**
 * 示例3: Handler链使用
 */
async function handlerChainExample() {
  console.log('=== Handler链示例 ===');

  try {
    // 1. 创建映射配置
    const config = new ResourceMappingConfig(
      './default_mapping.csv',
      './special_mapping.csv'
    );
    await config.loadMappings();

    // 2. 创建处理器链管理器
    const chainManager = new HandlerChainManager({
      logger: console
    });

    // 3. 注册处理器
    const { ValidationHandler, BackupHandler, ResourceMappingHandler } = require('../src/resource-mapping/handlerChain');

    chainManager.registerHandler(new ValidationHandler({
      requiredFields: ['type', 'resources']
    }));

    chainManager.registerHandler(new BackupHandler({
      enabled: true,
      path: './backups'
    }));

    chainManager.registerHandler(new ResourceMappingHandler(config));

    // 4. 执行处理器链
    const context = {
      data: {
        type: 'userSchema',
        resources: {
          oldResource1: 'value1',
          oldResource2: 'value2'
        }
      },
      fileName: 'example-schema.json'
    };

    const result = await chainManager.executeChain(
      ['ValidationHandler', 'BackupHandler', 'ResourceMappingHandler'],
      context,
      { dryRun: false }
    );

    console.log('处理器链执行结果:', {
      success: result.success,
      executionTime: result.totalExecutionTime,
      results: result.executionResults
    });

  } catch (error) {
    console.error('Handler链示例失败:', error.message);
  }
}

/**
 * 示例4: Dry-run模式
 */
async function dryRunExample() {
  console.log('=== Dry-run示例 ===');

  try {
    // 1. 创建dry-run执行器
    const dryRunExecutor = new DryRunExecutor({
      enabled: true,
      outputPath: './dry-run-results',
      detailedReport: true,
      saveSnapshots: true,
      logger: console
    });

    // 2. 创建操作
    const operation = {
      name: 'resourceMapping',
      execute: async (context, options) => {
        // 模拟资源映射操作
        const data = { ...context.data };
        if (data.resources && data.resources.oldResource1) {
          data.resources.newResource1 = data.resources.oldResource1;
          delete data.resources.oldResource1;
        }
        return data;
      }
    };

    // 3. 执行dry-run
    const context = {
      data: {
        type: 'userSchema',
        resources: {
          oldResource1: 'value1',
          oldResource2: 'value2'
        }
      }
    };

    const result = await dryRunExecutor.execute(operation, context);

    console.log('Dry-run结果:', {
      operationName: result.operationName,
      changes: result.preview.totalChanges,
      executionTime: result.executionTime
    });

    // 4. 生成摘要
    const summary = dryRunExecutor.generateSummary();
    console.log('Dry-run摘要:', summary);

  } catch (error) {
    console.error('Dry-run示例失败:', error.message);
  }
}

/**
 * 示例5: 错误处理
 */
async function errorHandlingExample() {
  console.log('=== 错误处理示例 ===');

  try {
    // 1. 创建错误处理器
    const errorHandler = new ErrorHandler({
      logFile: './error.log',
      maxRetries: 3,
      retryDelay: 1000,
      logger: console
    });

    // 2. 模拟可能失败的操作
    const riskyOperation = async (context) => {
      if (Math.random() > 0.5) {
        throw new Error('网络连接失败');
      }
      return { success: true, data: '操作成功' };
    };

    // 3. 执行操作并处理错误
    try {
      const result = await errorHandler.retryOperation(
        riskyOperation,
        { network: true },
        (error, ctx) => errorHandler.handleError(error, ctx)
      );

      console.log('操作成功:', result);

    } catch (error) {
      console.log('操作最终失败:', error.message);

      // 获取错误统计
      const stats = errorHandler.getErrorStats();
      console.log('错误统计:', stats);
    }

  } catch (error) {
    console.error('错误处理示例失败:', error.message);
  }
}

/**
 * 示例6: 完整集成（updateRepo流程）
 */
async function completeIntegrationExample() {
  console.log('=== 完整集成示例 ===');

  try {
    // 1. 创建更新器
    const updater = new ResourceMappingUpdater({
      defaultMappingPath: './default_mapping.csv',
      specialMappingPath: './special_mapping.csv',
      logger: console
    });

    // 2. 创建示例仓库结构
    await createSampleRepo('./sample-repo');

    // 3. 执行更新（dry-run模式）
    console.log('执行dry-run更新...');
    const dryRunResult = await updater.updateRepo('./sample-repo', {
      dryRun: true,
      backup: true,
      schemaPattern: '**/*.schema.json',
      outputReport: true
    });

    console.log('Dry-run结果:', {
      success: dryRunResult.success,
      summary: dryRunResult.summary
    });

    // 4. 如果dry-run成功，执行实际更新
    if (dryRunResult.success) {
      console.log('执行实际更新...');
      const actualResult = await updater.updateRepo('./sample-repo', {
        dryRun: false,
        backup: true,
        schemaPattern: '**/*.schema.json',
        outputReport: true
      });

      console.log('实际更新结果:', {
        success: actualResult.success,
        summary: actualResult.summary
      });
    }

  } catch (error) {
    console.error('完整集成示例失败:', error.message);
  }
}

/**
 * 示例7: 自定义处理器链
 */
async function customHandlerChainExample() {
  console.log('=== 自定义处理器链示例 ===');

  try {
    // 使用工厂创建自定义链
    const chainManager = HandlerChainFactory.createCustomChain([
      {
        type: 'validation',
        rules: {
          requiredFields: ['type', 'version'],
          schemaValidation: true
        },
        options: { priority: 1 }
      },
      {
        type: 'backup',
        config: {
          enabled: true,
          path: './custom-backups',
          format: 'json'
        },
        options: { priority: 2 }
      },
      {
        type: 'resourceMapping',
        config: new ResourceMappingConfig('./default_mapping.csv'),
        options: { priority: 3 }
      }
    ]);

    // 执行自定义链
    const context = {
      data: {
        type: 'customSchema',
        version: '1.0',
        resources: {
          oldResource1: 'data1',
          oldResource2: 'data2'
        }
      }
    };

    const result = await chainManager.executeChain(
      ['ValidationHandler', 'BackupHandler', 'ResourceMappingHandler'],
      context,
      { dryRun: false }
    );

    console.log('自定义处理器链结果:', {
      success: result.success,
      executionTime: result.totalExecutionTime
    });

  } catch (error) {
    console.error('自定义处理器链示例失败:', error.message);
  }
}

/**
 * 示例8: 性能监控和统计
 */
async function performanceMonitoringExample() {
  console.log('=== 性能监控示例 ===');

  try {
    // 创建带有性能监控的处理器链
    const chainManager = new HandlerChainManager({
      logger: console
    });

    // 添加事件监听器进行性能监控
    chainManager.on('handlerStart', ({ handlerName }) => {
      console.time(`Handler: ${handlerName}`);
    });

    chainManager.on('handlerSuccess', ({ handlerName, executionTime }) => {
      console.timeEnd(`Handler: ${handlerName}`);
      console.log(`${handlerName} 执行时间: ${executionTime}ms`);
    });

    // 注册处理器并执行...
    // (这里可以添加实际的处理器和测试数据)

    // 获取执行统计
    const stats = chainManager.getExecutionStats();
    console.log('执行统计:', stats);

  } catch (error) {
    console.error('性能监控示例失败:', error.message);
  }
}

/**
 * 辅助函数：创建示例CSV文件
 */
async function createSampleCSVFiles() {
  const fs = require('fs').promises;
  const path = require('path');

  // 创建默认映射CSV
  const defaultCSV = `oldResourceName,newResourceName
oldResource1,newResource1
oldResource2,newResource2
oldResource3,newResource3
userResource,userResourceNew
productResource,productResourceNew`;

  await fs.writeFile('./default_mapping.csv', defaultCSV, 'utf8');

  // 创建特殊映射CSV
  const specialCSV = `oldResourceName,newResourceName,schemaPattern
specialResource1,newSpecialResource1,userSchema
specialResource2,newSpecialResource2,productSchema
adminResource,newAdminResource,adminSchema
commonResource,newCommonResource,`;

  await fs.writeFile('./special_mapping.csv', specialCSV, 'utf8');
}

/**
 * 辅助函数：创建示例仓库
 */
async function createSampleRepo(repoPath) {
  const fs = require('fs').promises;
  const path = require('path');

  // 创建目录结构
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(path.join(repoPath, 'schemas'), { recursive: true });
  await fs.mkdir(path.join(repoPath, 'configs'), { recursive: true });

  // 创建示例schema文件
  const schema1 = {
    type: 'userSchema',
    version: '1.0',
    resources: {
      oldResource1: 'value1',
      specialResource1: 'special1',
      userResource: 'userData'
    }
  };

  const schema2 = {
    type: 'productSchema',
    version: '2.0',
    resources: {
      oldResource2: 'value2',
      specialResource2: 'special2',
      productResource: 'productData'
    }
  };

  await fs.writeFile(
    path.join(repoPath, 'schemas', 'user.schema.json'),
    JSON.stringify(schema1, null, 2),
    'utf8'
  );

  await fs.writeFile(
    path.join(repoPath, 'schemas', 'product.schema.json'),
    JSON.stringify(schema2, null, 2),
    'utf8'
  );
}

/**
 * 示例9: 邮件附件幂等去重
 */
async function attachmentIdempotencyExample() {
  console.log('=== 邮件附件幂等去重示例 ===');

  try {
    const manager = new AttachmentIdempotencyManager({
      storePath: './data/processed-attachments.example.json',
      logger: console
    });

    const mail = {
      messageId: 'mail-20260606-001',
      date: '2026-06-06T10:00:00.000Z',
      from: 'sender@example.com',
      subject: '每日附件'
    };

    const attachments = [
      {
        attachmentId: 'attachment-001',
        filename: 'daily-report.csv',
        size: 128,
        contentType: 'text/csv',
        content: 'id,name\\n1,Alice'
      },
      {
        attachmentId: 'attachment-002',
        filename: 'summary.json',
        size: 64,
        contentType: 'application/json',
        content: '{"total":1}'
      }
    ];

    const firstRun = await manager.processAttachments(attachments, mail, async (attachment) => {
      console.log(`处理附件: ${attachment.filename}`);
      return { saved: true, filename: attachment.filename };
    });

    const secondRun = await manager.processAttachments(attachments, mail, async (attachment) => {
      console.log(`这行不会执行，因为附件已处理: ${attachment.filename}`);
      return { saved: true, filename: attachment.filename };
    });

    console.log('首次执行:', {
      processed: firstRun.processed,
      skipped: firstRun.skipped
    });
    console.log('重复执行:', {
      processed: secondRun.processed,
      skipped: secondRun.skipped
    });
    console.log('幂等记录状态:', manager.store.getStats());

  } catch (error) {
    console.error('邮件附件幂等去重示例失败:', error.message);
  }
}

/**
 * 示例10: 发票按城市分组归档
 */
async function invoiceCityOrganizerExample() {
  console.log('=== 发票按城市分组归档示例 ===');

  try {
    const fs = require('fs').promises;
    const path = require('path');
    const sampleDir = './sample-invoice-artifacts';

    await fs.mkdir(sampleDir, { recursive: true });
    await fs.writeFile(path.join(sampleDir, 'invoice-beijing.jpg'), 'fake image content', 'utf8');
    await fs.writeFile(path.join(sampleDir, 'invoice-beijing.pdf'), 'fake pdf content', 'utf8');
    await fs.writeFile(path.join(sampleDir, 'invoice-shanghai.jpg'), 'fake image content', 'utf8');
    await fs.writeFile(path.join(sampleDir, 'invoice-shanghai.pdf'), 'fake pdf content', 'utf8');

    const organizer = new InvoiceCityOrganizer({
      outputRoot: './invoice-output',
      backupRoot: './invoice-output-backup',
      logger: console
    });

    const result = organizer.organizeBatch([
      {
        invoice: {
          invoiceNo: '001',
          invoiceDate: '2026-06-06',
          taxBureau: '国家税务总局北京市朝阳区税务局',
          sellerAddress: '北京市朝阳区示例路1号'
        },
        artifacts: [
          path.join(sampleDir, 'invoice-beijing.jpg'),
          path.join(sampleDir, 'invoice-beijing.pdf')
        ]
      },
      {
        invoice: {
          invoiceNo: '002',
          invoiceDate: '2026年06月06日',
          ocrText: '上海市增值税电子普通发票 销售方地址：上海市浦东新区示例路2号'
        },
        artifacts: [
          path.join(sampleDir, 'invoice-shanghai.jpg'),
          path.join(sampleDir, 'invoice-shanghai.pdf')
        ]
      }
    ]);

    console.log('分组结果:', result.groups);

  } catch (error) {
    console.error('发票按城市分组归档示例失败:', error.message);
  }
}

/**
 * 示例11: 开票信息配置
 */
async function invoiceConfigExample() {
  console.log('=== 开票信息配置示例 ===');

  try {
    const manager = new InvoiceConfigManager({
      configPath: './config/invoice.config.example.json'
    });
    const config = manager.load();
    const validation = manager.validate(config, {
      requireMobile: true,
      requireEmail: false,
      requireTaxNo: false
    });

    console.log('配置:', {
      ...config,
      buyerMobile: config.buyerMobile ? `${config.buyerMobile.slice(0, 3)}****${config.buyerMobile.slice(-4)}` : null
    });
    console.log('校验结果:', validation);

    const amountCheck = manager.validateInvoiceAmount('47.21', config);
    console.log('金额校验:', amountCheck);

    if (validation.valid && amountCheck.allowed) {
      console.log('购买方 payload:', manager.toBuyerPayload(config, { requireMobile: true }));
    }

  } catch (error) {
    console.error('开票信息配置示例失败:', error.message);
  }
}

/**
 * 主函数：运行所有示例
 */
async function runAllExamples() {
  console.log('开始运行资源映射处理系统示例...\\n');

  const examples = [
    basicUsageExample,
    csvParsingExample,
    handlerChainExample,
    dryRunExample,
    errorHandlingExample,
    completeIntegrationExample,
    customHandlerChainExample,
    performanceMonitoringExample,
    attachmentIdempotencyExample,
    invoiceCityOrganizerExample,
    invoiceConfigExample
  ];

  for (const example of examples) {
    try {
      await example();
      console.log('\\n---\\n');
    } catch (error) {
      console.error(`示例失败: ${example.name}`, error.message);
      console.log('\\n---\\n');
    }
  }

  console.log('所有示例运行完成！');
}

// 如果直接运行此文件，执行所有示例
if (require.main === module) {
  runAllExamples().catch(error => {
    console.error('运行示例失败:', error);
    process.exit(1);
  });
}

module.exports = {
  basicUsageExample,
  csvParsingExample,
  handlerChainExample,
  dryRunExample,
  errorHandlingExample,
  completeIntegrationExample,
  customHandlerChainExample,
  performanceMonitoringExample,
  attachmentIdempotencyExample,
  invoiceCityOrganizerExample,
  invoiceConfigExample,
  runAllExamples
};